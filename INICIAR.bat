@echo off
chcp 65001 >nul 2>&1
title Navios SSPP - Sistema de Compras O260

set "BASE=%~dp0"
set "NODE_DIR=%BASE%node-portable"
set "NODE_EXE=%NODE_DIR%\node.exe"

echo.
echo  ================================================
echo   NAVIOS ARGENTINA - Sistema de Compras O260
echo  ================================================
echo.

:: ── VERIFICAR que no se este ejecutando desde ZIP o carpeta Temp ────────────
echo %BASE% | findstr /I "Temp" >nul
if not errorlevel 1 (
    echo.
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║                  ATENCION                        ║
    echo  ║                                                  ║
    echo  ║  Estas ejecutando el sistema desde una carpeta   ║
    echo  ║  temporal. Debes EXTRAER el ZIP primero.         ║
    echo  ║                                                  ║
    echo  ║  COMO HACERLO:                                   ║
    echo  ║  1. Cerrar esta ventana                          ║
    echo  ║  2. Click derecho en el ZIP                      ║
    echo  ║  3. "Extraer todo..." o "Extract All..."         ║
    echo  ║  4. Elegir destino: C:\navios-sistema            ║
    echo  ║  5. Abrir esa carpeta y hacer doble click        ║
    echo  ║     en INICIAR.bat                               ║
    echo  ╚══════════════════════════════════════════════════╝
    echo.
    pause
    exit /b 1
)

echo %BASE% | findstr /I ".zip" >nul
if not errorlevel 1 (
    echo  ERROR: Extraer el ZIP antes de ejecutar.
    pause
    exit /b 1
)

:: ── Node.js portable ─────────────────────────────────────────────────────────
if exist "%NODE_EXE%" goto :deps_check

echo  [1/4] Descargando Node.js portable...
echo        Por favor espere, son unos 30MB.
echo.

if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip'; $zip='%BASE%node.zip'; $tmp='%BASE%node-tmp'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Write-Host '  Descargando...'; (New-Object Net.WebClient).DownloadFile($url,$zip); Write-Host '  Extrayendo...'; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $src=Get-ChildItem $tmp | Select-Object -First 1; Get-ChildItem $src.FullName | Move-Item -Destination '%NODE_DIR%' -Force; Remove-Item $zip -Force; Remove-Item $tmp -Recurse -Force; Write-Host '  Node.js listo.'"

if not exist "%NODE_EXE%" (
    echo.
    echo  ERROR: No se pudo descargar Node.js.
    echo  Verifique su conexion a internet e intente de nuevo.
    pause
    exit /b 1
)
echo  [OK] Node.js descargado.
echo.

:deps_check
echo  [1/4] Node.js: OK

if exist "%BASE%node_modules\express\package.json" (
    echo  [2/4] Dependencias: OK
    goto :db_check
)

echo  [2/4] Instalando dependencias (solo la primera vez)...
cd /d "%BASE%"
"%NODE_EXE%" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund 2>&1

if not exist "%BASE%node_modules\express\package.json" (
    echo.
    echo  ERROR: Fallo la instalacion de dependencias.
    echo  Asegurese de haber extraido el ZIP correctamente.
    pause
    exit /b 1
)
echo  [OK] Dependencias instaladas.

:db_check
if exist "%BASE%data\navios.db" (
    echo  [3/4] Base de datos: OK
    goto :start_server
)

echo  [3/4] Creando base de datos...
cd /d "%BASE%"
"%NODE_EXE%" scripts\setup-db.js

if not exist "%BASE%data\navios.db" (
    echo.
    echo  ERROR: No se pudo crear la base de datos.
    pause
    exit /b 1
)
echo  [OK] Base de datos creada con 7046 registros.

:start_server
echo  [4/4] Iniciando servidor...
echo.

set "LOCAL_IP=desconocida"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R "IPv4"') do (
    set "RAW_IP=%%a"
    call set "LOCAL_IP=%%RAW_IP: =%%"
    goto :show_info
)

:show_info
echo  ================================================
echo   SERVIDOR INICIADO - OK
echo  ================================================
echo.
echo   Esta PC:       http://localhost:3000
echo   Otros equipos: http://%LOCAL_IP%:3000
echo.
echo   Usuarios y contrasenas:
echo     sortega / sortega123
echo     esantini / esantini123
echo     nacosta / nacosta123
echo     admin / admin123
echo.
echo   Para detener: cerrar esta ventana
echo  ================================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

cd /d "%BASE%"
"%NODE_EXE%" server\index.js

echo.
echo  El servidor se detuvo.
pause
