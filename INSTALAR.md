# 🚢 Navios SSPP — Guía de Instalación (Windows)

## ¿Qué es esto?
Un sistema web que corre en la red interna de la oficina. Una PC actúa de servidor, y todos los demás acceden desde su navegador.

---

## PASO 1 — Instalar Node.js (una sola vez)

1. Ir a: https://nodejs.org
2. Descargar la versión **LTS** (la de la izquierda)
3. Instalar con todas las opciones por defecto
4. Verificar: abrir **PowerShell** y escribir:
   ```
   node --version
   ```
   Debería mostrar algo como `v20.x.x`

---

## PASO 2 — Preparar el sistema

1. Copiar la carpeta `navios-sistema` en la PC servidor (por ejemplo en `C:\navios-sistema`)
2. Abrir **PowerShell** en esa carpeta:
   - Click derecho en la carpeta → "Abrir en Terminal" o "Abrir PowerShell aquí"
3. Instalar las dependencias:
   ```
   npm install
   ```
   (Esto descarga los módulos necesarios, tarda 1-2 minutos)

---

## PASO 3 — Crear la base de datos (una sola vez)

```
npm run setup
```

Esto crea el archivo `data/navios.db` con los 7.046 registros y todos los usuarios.

---

## PASO 4 — Iniciar el servidor

```
npm start
```

Deberías ver:
```
🚢 Navios SSPP corriendo en http://localhost:3000
   En la red: http://[TU-IP]:3000
```

---

## PASO 5 — Conocer tu IP para compartir con los demás

En PowerShell:
```
ipconfig
```
Buscar `Dirección IPv4` (algo como `192.168.1.105`)

**Todos los usuarios** abren en su navegador: `http://192.168.1.105:3000`

---

## PASO 6 — Iniciar automáticamente con Windows (opcional)

Para que el servidor arranque solo cuando prenda la PC:

1. Abrir el Administrador de tareas → Inicio
2. O instalar pm2:
   ```
   npm install -g pm2
   pm2 start server/index.js --name navios
   pm2 startup
   pm2 save
   ```

---

## 🔑 USUARIOS Y CONTRASEÑAS INICIALES

| Usuario       | Contraseña       | Rol              | Barcos                          |
|---------------|------------------|------------------|---------------------------------|
| sortega       | sortega123       | Comprador        | CERRI, ELENA H, OFICINA MADERO  |
| esantini      | esantini123      | Comprador        | ENRICO H, ESTEFANIA H, SAN SAN H|
| nacosta       | nacosta123       | Comprador        | FERNI H, MAKENITA H, RAP, VAL   |
| pmontemurro   | pmontemurro123   | Comprador        | SARA H                          |
| ataddei       | ataddei123       | Superintendente  | ELENA H, MAKENITA H, ESTEFANIA H|
| jdiaz         | jdiaz123         | Superintendente  | RAP, ENRICO H, VALENTINA H      |
| rgemini       | rgemini123       | Superintendente  | SAN SAN H, FERNI H              |
| admin         | admin123         | Admin            | Todos                           |

⚠️ **Cambiá las contraseñas después del primer login** (Panel Admin).

---

## 🔄 Actualizar con nuevo reporte Excel

1. Ingresar como comprador
2. Click en **"📥 Importar"**
3. Arrastrar el archivo `.xlsx` del template SSPP
4. El sistema detecta automáticamente barco y departamento del código de caso
5. Solo importa líneas **nuevas** — no pisa los cambios ya hechos

---

## 🗂️ Estructura de archivos

```
navios-sistema/
├── server/
│   └── index.js          ← Servidor principal
├── public/
│   └── index.html        ← Toda la interfaz web
├── scripts/
│   └── setup-db.js       ← Crea la base de datos
├── data/
│   ├── seed.json         ← Datos iniciales (7046 registros)
│   └── navios.db         ← Base de datos SQLite (se crea con npm run setup)
├── package.json
└── INSTALAR.md           ← Esta guía
```

---

## ❓ Problemas frecuentes

**"Cannot find module 'better-sqlite3'"**
→ Correr `npm install` de nuevo.

**"No se encontró la base de datos"**
→ Correr `npm run setup` primero.

**Los demás no pueden acceder**
→ Verificar que el Firewall de Windows permite el puerto 3000:
  Panel de control → Windows Defender Firewall → Reglas de entrada → Nueva regla → Puerto → TCP 3000

**La sesión se cierra sola**
→ Normal, expira a las 8 horas. Volver a iniciar sesión.
