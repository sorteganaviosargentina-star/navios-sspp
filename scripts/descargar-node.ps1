# descargar-node.ps1
# Descarga Node.js portable y lo extrae en la carpeta indicada

param(
    [string]$BaseDir,
    [string]$NodeDir
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url    = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
$zipPath = Join-Path $BaseDir "node-portable.zip"
$tmpPath = Join-Path $BaseDir "node-tmp"

try {
    Write-Host "  Conectando con nodejs.org..."
    $client = New-Object System.Net.WebClient
    $client.DownloadFile($url, $zipPath)
    Write-Host "  Descarga completa. Extrayendo..."

    if (Test-Path $tmpPath) { Remove-Item $tmpPath -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $tmpPath -Force

    $extracted = Get-ChildItem $tmpPath | Select-Object -First 1
    Get-ChildItem $extracted.FullName | Move-Item -Destination $NodeDir -Force

    Write-Host "  Limpiando archivos temporales..."
    Remove-Item $zipPath -Force
    Remove-Item $tmpPath -Recurse -Force

    Write-Host "  Node.js listo en: $NodeDir"
}
catch {
    Write-Host "  ERROR al descargar: $_"
    exit 1
}
