# instalar-ffmpeg-pc1.ps1
# Instala ffmpeg en PC1 (Windows) via winget; si falla, descarga la version portable.
# Al terminar imprime FFMPEG_PATH=<ruta> para que el comando siguiente lo use sin depender del PATH.

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "[FFMPEG-INSTALL] $msg" -ForegroundColor Cyan }

# ── 1. Comprobar si ya esta instalado en PATH ──────────────────────────────────
Write-Step "Comprobando si ffmpeg ya esta en PATH..."
$inPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($inPath) {
    $v = & ffmpeg -version 2>&1 | Select-Object -First 1
    Write-Host "  ffmpeg encontrado en PATH: $($inPath.Source)" -ForegroundColor Green
    Write-Host "  $v"
    Write-Host "FFMPEG_YA_LISTO"
    Write-Host "FFMPEG_PATH=$($inPath.Source)"
    exit 0
}

# Comprobar si ya esta en la ruta portable conocida (instalado antes, pero PATH no propagado)
$portableExe = Join-Path $env:LOCALAPPDATA "ffmpeg-portable\bin\ffmpeg.exe"
if (Test-Path $portableExe) {
    $v = & $portableExe -version 2>&1 | Select-Object -First 1
    Write-Host "  ffmpeg portable ya instalado: $portableExe" -ForegroundColor Green
    Write-Host "  $v"
    Write-Host "FFMPEG_YA_LISTO"
    Write-Host "FFMPEG_PATH=$portableExe"
    exit 0
}

# ── 2. Intentar con winget ─────────────────────────────────────────────────────
Write-Step "Intentando instalar via winget (Gyan.FFmpeg)..."
$wingetExe = $null
try {
    winget install --id Gyan.FFmpeg --source winget --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    # Recargar PATH en esta sesion
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
    $found = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($found) { $wingetExe = $found.Source }
} catch {
    Write-Host "  winget fallo. Usando instalacion portable." -ForegroundColor Yellow
}

if ($wingetExe) {
    $v = & $wingetExe -version 2>&1 | Select-Object -First 1
    Write-Host "  $v" -ForegroundColor Green
    Write-Host "FFMPEG_INSTALADO_WINGET"
    Write-Host "FFMPEG_PATH=$wingetExe"
    exit 0
}

# ── 3. Fallback: descarga portable de GitHub (Gyan.dev builds) ─────────────────
Write-Step "Descargando ffmpeg portable desde GitHub..."

$destDir = Join-Path $env:LOCALAPPDATA "ffmpeg-portable\bin"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$releaseApi = "https://api.github.com/repos/GyanD/codexffmpeg/releases/latest"
Write-Host "  Consultando ultima version..."
$release = Invoke-RestMethod -Uri $releaseApi -UseBasicParsing
$asset = $release.assets | Where-Object { $_.name -like "*essentials_build.zip" } | Select-Object -First 1
if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
}
$zipUrl  = $asset.browser_download_url
$zipName = $asset.name
$zipPath = Join-Path $env:TEMP $zipName

Write-Host "  Descargando $zipName ..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
Write-Host "  Descarga completada."

Write-Step "Descomprimiendo..."
$extractDir = Join-Path $env:TEMP "ffmpeg-extract"
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$binSource = Get-ChildItem $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $binSource) { throw "No se encontro ffmpeg.exe en el ZIP." }
$ffmpegBinDir = $binSource.DirectoryName

foreach ($exe in @("ffmpeg.exe","ffprobe.exe","ffplay.exe")) {
    $src = Join-Path $ffmpegBinDir $exe
    if (Test-Path $src) { Copy-Item $src -Destination $destDir -Force }
}

# Agregar al PATH de usuario (permanente, para proximas sesiones)
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*ffmpeg-portable*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$destDir", "User")
}
# Agregar al PATH de esta sesion
$env:Path = $env:Path + ";$destDir"

# Limpiar temporales
Remove-Item $zipPath  -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

# Verificar con ruta explicita
$portableExe = Join-Path $destDir "ffmpeg.exe"
$v = & $portableExe -version 2>&1 | Select-Object -First 1
Write-Host "  $v" -ForegroundColor Green
Write-Host "FFMPEG_INSTALADO_PORTABLE"
Write-Host "FFMPEG_PATH=$portableExe"
Write-Host "(Nota: abre una terminal nueva para usar 'ffmpeg' sin ruta completa en futuras sesiones)"
