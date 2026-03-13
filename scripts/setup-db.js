/**
 * setup-db.js
 * Crea la base de datos SQLite con todas las tablas y carga los 7046 registros iniciales.
 * Ejecutar UNA sola vez: node scripts/setup-db.js
 */

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const DB_PATH   = path.join(__dirname, '..', 'data', 'navios.db');
const SEED_PATH = path.join(__dirname, '..', 'data', 'seed.json');

// Si ya existe la DB, preguntar antes de borrar
if (fs.existsSync(DB_PATH)) {
  console.log('⚠️  Ya existe una base de datos en data/navios.db');
  console.log('   Si querés re-inicializar, borrá el archivo manualmente y volvé a correr este script.');
  process.exit(0);
}

const db = new Database(DB_PATH);
console.log('✅ Base de datos creada en:', DB_PATH);

// ─── ESQUEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- USUARIOS
  CREATE TABLE usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password    TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    rol         TEXT NOT NULL CHECK(rol IN ('comprador','comprador_tecnico','superintendente','supervisor','admin')),
    activo      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- ASIGNACION USUARIO <-> BARCOS
  CREATE TABLE usuario_barcos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    barco      TEXT NOT NULL COLLATE NOCASE,
    UNIQUE(usuario_id, barco)
  );

  -- SOLICITUDES (todas las líneas del O260)
  CREATE TABLE solicitudes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    numeroCaso         TEXT NOT NULL,
    barco              TEXT NOT NULL,
    linea              TEXT NOT NULL,
    codigo             TEXT,
    fechaSSPP          TEXT,
    contadorDias       INTEGER DEFAULT 0,
    depto              TEXT,
    categoria          TEXT,
    rubro              TEXT,
    descripcion        TEXT,
    cant               REAL DEFAULT 0,
    estadoO260         TEXT,
    comentarioCompras  TEXT,
    proveedor          TEXT DEFAULT '',
    precio             TEXT DEFAULT '',
    updated_at         TEXT,
    updated_by         TEXT,
    UNIQUE(numeroCaso, linea)
  );

  CREATE INDEX idx_sol_barco  ON solicitudes(barco);
  CREATE INDEX idx_sol_caso   ON solicitudes(numeroCaso);
  CREATE INDEX idx_sol_estado ON solicitudes(estadoO260);

  -- HISTORIAL DE CAMBIOS (1 registro por campo modificado)
  CREATE TABLE historial (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    solicitud_id INTEGER NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    numeroCaso   TEXT NOT NULL,
    linea        TEXT NOT NULL,
    barco        TEXT NOT NULL,
    campo        TEXT NOT NULL,
    valor_antes  TEXT,
    valor_despues TEXT,
    usuario      TEXT NOT NULL,
    fecha        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX idx_hist_sol ON historial(solicitud_id);
  CREATE INDEX idx_hist_caso ON historial(numeroCaso);
`);

console.log('✅ Tablas creadas');

// ─── USUARIOS INICIALES ───────────────────────────────────────────────────────
const insertUser = db.prepare(`
  INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)
`);
const insertBarco = db.prepare(`
  INSERT INTO usuario_barcos (usuario_id, barco) VALUES (?, ?)
`);

const usuarios = [
  // username, password, nombre, rol, barcos[]
  { u:'sortega',      p:'sortega123',      n:'S. Ortega',      r:'comprador',
    b:['CERRI','ELENA H','IT SISTEMAS ARGENTINA','OFICINA MADERO BS AS'] },
  { u:'esantini',     p:'esantini123',     n:'E. Santini',     r:'comprador',
    b:['ENRICO H','ESTEFANIA H','SAN SAN H'] },
  { u:'nacosta',      p:'nacosta123',      n:'N. Acosta',      r:'comprador',
    b:['FERNI H','MAKENITA H','RAP','VALENTINA H'] },
  { u:'pmontemurro',  p:'pmontemurro123',  n:'P. Montemurro',  r:'comprador',
    b:['SARA H'] },
  { u:'ataddei',      p:'ataddei123',      n:'A. Taddei',      r:'superintendente',
    b:['ELENA H','MAKENITA H','ESTEFANIA H'] },
  { u:'jdiaz',        p:'jdiaz123',        n:'J. Díaz',        r:'superintendente',
    b:['RAP','ENRICO H','VALENTINA H'] },
  { u:'rgemini',      p:'rgemini123',      n:'R. Gemini',      r:'superintendente',
    b:['SAN SAN H','FERNI H'] },
  { u:'admin',        p:'admin123',        n:'Administrador',  r:'admin',
    b:[] },
];

const createUsers = db.transaction(() => {
  for (const u of usuarios) {
    const hash = bcrypt.hashSync(u.p, 10);
    const info = insertUser.run(u.u, hash, u.n, u.r);
    for (const barco of u.b) {
      insertBarco.run(info.lastInsertRowid, barco);
    }
  }
});
createUsers();
console.log(`✅ ${usuarios.length} usuarios creados`);

// ─── SEED DE SOLICITUDES ──────────────────────────────────────────────────────
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));

const insertSol = db.prepare(`
  INSERT OR IGNORE INTO solicitudes
    (numeroCaso, barco, linea, codigo, fechaSSPP, contadorDias, depto,
     categoria, rubro, descripcion, cant, estadoO260, comentarioCompras, proveedor, precio)
  VALUES
    (@numeroCaso, @barco, @linea, @codigo, @fechaSSPP, @contadorDias, @depto,
     @categoria, @rubro, @descripcion, @cant, @estadoO260, @comentarioCompras, @proveedor, @precio)
`);

const seedAll = db.transaction((rows) => {
  let inserted = 0;
  for (const r of rows) {
    const info = insertSol.run(r);
    if (info.changes) inserted++;
  }
  return inserted;
});

const count = seedAll(seed);
console.log(`✅ ${count} solicitudes importadas`);
console.log('\n🚀 Base de datos lista. Ahora podés correr: npm start');
console.log('\n📋 USUARIOS Y CONTRASEÑAS INICIALES:');
console.log('   sortega      / sortega123');
console.log('   esantini     / esantini123');
console.log('   nacosta      / nacosta123');
console.log('   pmontemurro  / pmontemurro123');
console.log('   ataddei      / ataddei123');
console.log('   jdiaz        / jdiaz123');
console.log('   rgemini      / rgemini123');
console.log('   admin        / admin123');
console.log('\n⚠️  Cambiá las contraseñas después del primer login.');

db.close();
