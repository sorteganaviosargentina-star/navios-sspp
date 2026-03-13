/**
 * server/index.js
 * Servidor principal del sistema de gestión O260 - Navios Argentina
 */

const express       = require('express');
const session       = require('express-session');
const bcrypt        = require('bcryptjs');
const Database      = require('better-sqlite3');
const multer        = require('multer');
const XLSX          = require('xlsx');
const path          = require('path');
const fs            = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, '..', 'data', 'navios.db');

// ─── VERIFICAR DB ──────────────────────────────────────────────────────────────
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ No se encontró la base de datos. Ejecutá primero: npm run setup');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret: 'navios-sspp-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 horas
}));

const upload = multer({ storage: multer.memoryStorage() });

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const ESTADOS_VALIDOS = [
  'PENDIENTE DE COMPRA', 'EN PROCESO DE COTIZACION', 'COTIZANDO',
  'COMPRADO', 'PENDIENTE DE ENTREGA', 'ENTREGADO', 'CUMPLIDO',
  'CONSOLIDADO', 'COMPRA TECNICA', 'COMPRA OPERACIONES MARITIMAS',
  'PRODUCTO EN STOCK', 'NO EXISTE EL PRODUCTO', 'ANULADA',
  'SOLICITUD CANCELADA POR EL BARCO', 'SOLICITUD CANCELADA POR EL SUPERINTENDENTE'
];

// Mapeo de código de barco en numeroCaso → nombre de barco
const BARCO_MAP = {
  'ECO':'ENRICO H','ELE':'ELENA H','EST':'ESTEFANIA H','STV':'FERNI H',
  'MAK':'MAKENITA H','SSN':'SAN SAN H','RAP':'RAP','VAL':'VALENTINA H',
  'SAR':'SARA H','CER':'CERRI','OSF':'OFICINA MADERO BS AS','SIS':'IT SISTEMAS ARGENTINA'
};

function derivarBarco(numeroCaso) {
  // ST-ECO-26-00049-C → ECO
  const match = numeroCaso.match(/^ST-([A-Z]+)-/);
  if (match) return BARCO_MAP[match[1]] || match[1];
  // Caso directo como ST-RAP-...
  return '';
}

function derivarDepto(numeroCaso) {
  // sufijo -C = CUBIERTA, -M = MÁQUINAS
  if (numeroCaso.endsWith('-C')) return 'CUBIERTA';
  if (numeroCaso.endsWith('-M')) return 'MÁQUINAS';
  return '';
}

function getUserBarcos(userId) {
  return db.prepare('SELECT barco FROM usuario_barcos WHERE usuario_id = ?')
    .all(userId).map(r => r.barco);
}

function puedeVerBarco(user, barco) {
  if (user.rol === 'admin' || user.rol === 'supervisor') return true;
  return user.barcos.includes(barco);
}

function puedeEditarBarco(user, barco) {
  if (user.rol === 'admin' || user.rol === 'supervisor') return true;
  if (user.rol === 'superintendente') return false; // solo lectura
  return user.barcos.includes(barco);
}

function registrarHistorial(solicitudId, numeroCaso, linea, barco, campo, antes, despues, username) {
  if (String(antes || '') === String(despues || '')) return;
  db.prepare(`
    INSERT INTO historial (solicitud_id, numeroCaso, linea, barco, campo, valor_antes, valor_despues, usuario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(solicitudId, numeroCaso, linea, barco, campo, String(antes || ''), String(despues || ''), username);
}

// ─── RUTAS: AUTENTICACIÓN ──────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });

  const user = db.prepare('SELECT * FROM usuarios WHERE username = ? AND activo = 1').get(username.trim());
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const barcos = getUserBarcos(user.id);
  req.session.user = {
    id: user.id,
    username: user.username,
    nombre: user.nombre,
    rol: user.rol,
    barcos
  };

  res.json({
    ok: true,
    user: { username: user.username, nombre: user.nombre, rol: user.rol, barcos }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ─── RUTAS: SOLICITUDES ────────────────────────────────────────────────────────

// GET /api/solicitudes — con filtros y paginación
app.get('/api/solicitudes', requireAuth, (req, res) => {
  const user  = req.session.user;
  const { barco, estado, categoria, depto, rubro, q, page = 1, limit = 50, sortCol = 'fechaSSPP', sortDir = 'DESC' } = req.query;

  // Barcos accesibles para este usuario
  const barcosPermitidos = (user.rol === 'admin' || user.rol === 'supervisor')
    ? null  // null = todos
    : user.barcos;

  // Construir WHERE dinámico
  const conditions = [];
  const params     = [];

  if (barcosPermitidos) {
    conditions.push(`barco IN (${barcosPermitidos.map(() => '?').join(',')})`);
    params.push(...barcosPermitidos);
  }
  if (barco  && barco  !== 'Todos') { conditions.push('barco = ?');      params.push(barco); }
  if (estado && estado !== 'Todos') { conditions.push('estadoO260 = ?'); params.push(estado); }
  if (categoria && categoria !== 'Todos') { conditions.push('categoria = ?'); params.push(categoria); }
  if (depto  && depto  !== 'Todos') { conditions.push('depto = ?');      params.push(depto); }
  if (rubro  && rubro  !== 'Todos') { conditions.push('rubro = ?');      params.push(rubro); }
  if (q && q.trim()) {
    conditions.push(`(numeroCaso LIKE ? OR descripcion LIKE ? OR codigo LIKE ? OR comentarioCompras LIKE ? OR proveedor LIKE ?)`);
    const term = `%${q.trim()}%`;
    params.push(term, term, term, term, term);
  }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const validCols = ['numeroCaso','barco','linea','fechaSSPP','estadoO260','categoria','rubro','cant','proveedor'];
  const col    = validCols.includes(sortCol) ? sortCol : 'fechaSSPP';
  const dir    = sortDir === 'ASC' ? 'ASC' : 'DESC';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(`SELECT COUNT(*) as c FROM solicitudes ${where}`).get(...params).c;
  const rows  = db.prepare(`SELECT * FROM solicitudes ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`)
    .all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), rows });
});

// GET /api/solicitudes/:id — una sola línea
app.get('/api/solicitudes/:id', requireAuth, (req, res) => {
  const sol = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
  if (!sol) return res.status(404).json({ error: 'No encontrada' });
  if (!puedeVerBarco(req.session.user, sol.barco)) return res.status(403).json({ error: 'Sin acceso' });
  res.json(sol);
});

// PATCH /api/solicitudes/:id — editar campos de una línea
app.patch('/api/solicitudes/:id', requireAuth, (req, res) => {
  const user = req.session.user;
  const sol  = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
  if (!sol) return res.status(404).json({ error: 'No encontrada' });
  if (!puedeEditarBarco(user, sol.barco)) return res.status(403).json({ error: 'Sin permiso para editar' });

  const CAMPOS_EDITABLES = ['estadoO260','comentarioCompras','rubro','proveedor','precio','categoria'];
  const updates = [];
  const vals    = [];

  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] !== undefined) {
      // Validar estado
      if (campo === 'estadoO260' && !ESTADOS_VALIDOS.includes(req.body[campo])) {
        return res.status(400).json({ error: `Estado inválido: ${req.body[campo]}` });
      }
      updates.push(`${campo} = ?`);
      vals.push(req.body[campo]);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

  updates.push(`updated_at = datetime('now','localtime')`, `updated_by = ?`);
  vals.push(user.username);
  vals.push(sol.id);

  db.prepare(`UPDATE solicitudes SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  // Registrar historial
  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] !== undefined) {
      registrarHistorial(sol.id, sol.numeroCaso, sol.linea, sol.barco, campo, sol[campo], req.body[campo], user.username);
    }
  }

  const updated = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(sol.id);
  res.json(updated);
});

// GET /api/solicitudes/:id/historial
app.get('/api/solicitudes/:id/historial', requireAuth, (req, res) => {
  const sol = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
  if (!sol) return res.status(404).json({ error: 'No encontrada' });
  if (!puedeVerBarco(req.session.user, sol.barco)) return res.status(403).json({ error: 'Sin acceso' });

  const hist = db.prepare('SELECT * FROM historial WHERE solicitud_id = ? ORDER BY fecha DESC').all(sol.id);
  res.json(hist);
});

// ─── RUTAS: STATS / RESUMEN ────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  const user = req.session.user;
  const barcosPermitidos = (user.rol === 'admin' || user.rol === 'supervisor') ? null : user.barcos;

  const whereClause = barcosPermitidos
    ? `WHERE barco IN (${barcosPermitidos.map(() => '?').join(',')})`
    : '';
  const params = barcosPermitidos || [];

  const total     = db.prepare(`SELECT COUNT(*) as c FROM solicitudes ${whereClause}`).get(...params).c;
  const porEstado = db.prepare(`SELECT estadoO260, COUNT(*) as c FROM solicitudes ${whereClause} GROUP BY estadoO260 ORDER BY c DESC`).all(...params);
  const porBarco  = db.prepare(`SELECT barco, COUNT(*) as c FROM solicitudes ${whereClause} GROUP BY barco ORDER BY c DESC`).all(...params);
  const porCat    = db.prepare(`SELECT categoria, COUNT(*) as c FROM solicitudes ${whereClause} GROUP BY categoria ORDER BY c DESC`).all(...params);
  const recientes = db.prepare(`SELECT * FROM historial ORDER BY fecha DESC LIMIT 20`).all();

  res.json({ total, porEstado, porBarco, porCat, recientes });
});

// ─── RUTAS: BULK UPDATE ───────────────────────────────────────────────────────
app.patch('/api/solicitudes/bulk', requireAuth, (req, res) => {
  const user = req.session.user;
  if (user.rol === 'superintendente') return res.status(403).json({ error: 'Sin permiso' });

  const { ids, campos } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids requeridos' });

  const CAMPOS_EDITABLES = ['estadoO260','comentarioCompras','rubro','proveedor','precio','categoria'];
  const updates = Object.entries(campos).filter(([k]) => CAMPOS_EDITABLES.includes(k) && campos[k] !== undefined && campos[k] !== '');

  if (!updates.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

  const now = new Date().toLocaleString('es-AR');
  const updateMany = db.transaction(() => {
    for (const id of ids) {
      const row = db.prepare('SELECT * FROM solicitudes WHERE id=?').get(id);
      if (!row) continue;
      for (const [campo, valor] of updates) {
        db.prepare(`UPDATE solicitudes SET ${campo}=?, updated_at=?, updated_by=? WHERE id=?`)
          .run(valor, now, user.username, id);
        db.prepare('INSERT INTO historial (solicitud_id,numeroCaso,linea,barco,campo,valor_antes,valor_despues,usuario,fecha) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, row.numeroCaso, row.linea, row.barco, campo, row[campo]||'', valor, user.username, now);
      }
    }
  });
  updateMany();
  res.json({ ok: true, updated: ids.length });
});

// ─── RUTAS: TABLERO PROVEEDORES ───────────────────────────────────────────────
app.get('/api/proveedores', requireAuth, (req, res) => {
  const user = req.session.user;
  const barcosPermitidos = (user.rol === 'admin' || user.rol === 'supervisor') ? null : user.barcos;
  const where = barcosPermitidos
    ? `WHERE proveedor != '' AND proveedor IS NOT NULL AND barco IN (${barcosPermitidos.map(()=>'?').join(',')})`
    : `WHERE proveedor != '' AND proveedor IS NOT NULL`;
  const params = barcosPermitidos || [];

  const rows = db.prepare(`
    SELECT id, numeroCaso, barco, linea, descripcion, cant, rubro, proveedor, precio, estadoO260, categoria, depto
    FROM solicitudes ${where}
    ORDER BY proveedor, barco, numeroCaso, linea
  `).all(...params);

  // Agrupar por proveedor
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.proveedor]) grouped[r.proveedor] = { proveedor: r.proveedor, lineas: [] };
    grouped[r.proveedor].lineas.push(r);
  }

  res.json(Object.values(grouped));
});

// ─── RUTAS: IMPORTAR TEMPLATE ──────────────────────────────────────────────────
app.post('/api/importar', requireAuth, upload.single('archivo'), (req, res) => {
  const user = req.session.user;
  if (user.rol === 'superintendente') return res.status(403).json({ error: 'Sin permiso' });

  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  try {
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const raw  = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const insertSol = db.prepare(`
      INSERT OR IGNORE INTO solicitudes
        (numeroCaso, barco, linea, codigo, fechaSSPP, depto, categoria, descripcion, cant, estadoO260, rubro, comentarioCompras, proveedor, precio)
      VALUES
        (@numeroCaso, @barco, @linea, @codigo, @fechaSSPP, @depto, @categoria, @descripcion, @cant, @estadoO260, @rubro, @comentarioCompras, @proveedor, @precio)
    `);

    let importadas = 0, duplicadas = 0, errores = [];

    const doImport = db.transaction(() => {
      for (const row of raw) {
        const numeroCaso = String(row.CASE || row.numeroCaso || '').trim();
        if (!numeroCaso) continue;

        const barco = derivarBarco(numeroCaso) || String(row.barco || '').trim();
        if (!barco) { errores.push(`Sin barco: ${numeroCaso}`); continue; }

        // Verificar que el usuario tiene acceso a ese barco
        if (!puedeEditarBarco(user, barco)) {
          errores.push(`Sin permiso para barco ${barco}: ${numeroCaso}`);
          continue;
        }

        let fecha = row.FECHA || row.fechaSSPP || '';
        if (fecha instanceof Date) {
          fecha = fecha.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
        } else {
          fecha = String(fecha).trim();
        }

        const r = {
          numeroCaso,
          barco,
          linea:             String(row.ITEM || row.linea || '1').trim(),
          codigo:            String(row.CODIGO || row.codigo || '').trim(),
          fechaSSPP:         fecha,
          depto:             derivarDepto(numeroCaso),
          categoria:         String(row.PRIORIDAD || row.categoria || 'Normal').trim(),
          descripcion:       String(row.DESCRIPCION || row.descripcion || '').trim().replace(/\n/g,' '),
          cant:              parseFloat(row.CANTIDAD || row.cant || 0) || 0,
          estadoO260:        'PENDIENTE DE COMPRA',
          rubro:             'Rubro no asignado.',
          comentarioCompras: '',
          proveedor:         '',
          precio:            ''
        };

        const info = insertSol.run(r);
        if (info.changes) importadas++;
        else duplicadas++;
      }
    });

    doImport();
    res.json({ ok: true, importadas, duplicadas, errores });
  } catch (e) {
    console.error('Error importando:', e);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + e.message });
  }
});

// ─── RUTAS: ADMIN DE USUARIOS ──────────────────────────────────────────────────
app.get('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, nombre, rol, activo, created_at FROM usuarios').all();
  const withBarcos = users.map(u => ({
    ...u,
    barcos: getUserBarcos(u.id)
  }));
  res.json(withBarcos);
});

app.post('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  const { username, password, nombre, rol, barcos = [] } = req.body;
  if (!username || !password || !nombre || !rol) return res.status(400).json({ error: 'Campos incompletos' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO usuarios (username, password, nombre, rol) VALUES (?,?,?,?)').run(username, hash, nombre, rol);
  for (const b of barcos) db.prepare('INSERT INTO usuario_barcos (usuario_id, barco) VALUES (?,?)').run(info.lastInsertRowid, b);

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  const { nombre, rol, activo, barcos, password } = req.body;
  const id = req.params.id;
  if (nombre !== undefined) db.prepare('UPDATE usuarios SET nombre=? WHERE id=?').run(nombre, id);
  if (rol    !== undefined) db.prepare('UPDATE usuarios SET rol=? WHERE id=?').run(rol, id);
  if (activo !== undefined) db.prepare('UPDATE usuarios SET activo=? WHERE id=?').run(activo ? 1 : 0, id);
  if (password) db.prepare('UPDATE usuarios SET password=? WHERE id=?').run(bcrypt.hashSync(password, 10), id);
  if (barcos !== undefined) {
    db.prepare('DELETE FROM usuario_barcos WHERE usuario_id=?').run(id);
    for (const b of barcos) db.prepare('INSERT INTO usuario_barcos (usuario_id, barco) VALUES (?,?)').run(id, b);
  }
  res.json({ ok: true });
});

// ─── CATCH-ALL → index.html ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚢 Navios SSPP corriendo en http://localhost:${PORT}`);
  console.log(`   En la red: http://[TU-IP]:${PORT}`);
  console.log(`   Para ver tu IP en Windows: ejecutá "ipconfig" en la consola\n`);
});

module.exports = app;
