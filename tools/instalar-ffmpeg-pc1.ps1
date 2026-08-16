# instalar-ffmpeg-pc1.ps1
# Instala ffmpeg en PC1 (Windows) via winget; si falla, descarga la version portable.
# Al terminar verifica que "ffmpeg -version" responde.

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n[FFMPEG-INSTALL] $msg" -ForegroundColor Cyan }

# ── 1. Comprobar si ya esta instalado ──────────────────────────────────────────
Write-Step "Comprobando si ffmpeg ya esta instalado..."
try {
    $ver = & ffmpeg -version 2>&1 | Select-Object -First 1
    Write-Host "  ffmpeg YA INSTALADO: $ver" -ForegroundColor Green
    Write-Host "FFMPEG_YA_LISTO"
    exit 0
} catch { Write-Host "  No encontrado. Procediendo a instalar..." }

# ── 2. Intentar con winget ─────────────────────────────────────────────────────
Write-Step "Intentando instalar via winget (Gyan.FFmpeg)..."
$wingetOK = $false
try {
    $result = winget install --id Gyan.FFmpeg --source winget --accept-package-agreements --accept-source-agreements 2>&1
    Write-Host $result
    # Recargar PATH de la sesion actual
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
    & ffmpeg -version | Out-Null
    $wingetOK = $true
} catch {
    Write-Host "  winget fallo o ffmpeg no quedo en PATH. Usando instalacion portable." -ForegroundColor Yellow
}

if ($wingetOK) {
    Write-Step "winget instalo ffmpeg correctamente."
    Write-Host "FFMPEG_INSTALADO_WINGET"
    exit 0
}

# ── 3. Fallback: descarga portable de GitHub (Gyan.dev builds) ─────────────────
Write-Step "Descargando ffmpeg portable desde GitHub..."

# Carpeta de destino en AppData (no requiere admin)
$destDir = Join-Path $env:LOCALAPPDATA "ffmpeg-portable\bin"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

# URL de la release "essentials" mas reciente de Gyan.dev (binario estatico, ~80 MB)
$releaseApi = "https://api.github.com/repos/GyanD/codexffmpeg/releases/latest"
Write-Host "  Consultando ultima version..."
$release = Invoke-RestMethod -Uri $releaseApi -UseBasicParsing
$asset = $release.assets | Where-Object { $_.name -like "*essentials_build.zip" } | Select-Object -First 1
if (-not $asset) {
    # Fallback manual si la API cambia de formato
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

# Los binarios quedan en una subcarpeta con el nombre de la version
$binSource = Get-ChildItem $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $binSource) { throw "No se encontro ffmpeg.exe en el ZIP." }

$ffmpegBinDir = $binSource.DirectoryName
Write-Host "  Binarios encontrados en: $ffmpegBinDir"

# Copiar los 3 ejecutables (ffmpeg, ffprobe, ffplay)
foreach ($exe in @("ffmpeg.exe","ffprobe.exe","ffplay.exe")) {
    $src = Join-Path $ffmpegBinDir $exe
    if (Test-Path $src) { Copy-Item $src -Destination $destDir -Force }
}

# ── 4. Agregar al PATH de usuario (permanente) ─────────────────────────────────
Write-Step "Agregando $destDir al PATH de usuario..."
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*$destDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$destDir", "User")
    Write-Host "  PATH actualizado."
} else {
    Write-Host "  Ya estaba en PATH."
}
$env:Path = $env:Path + ";$destDir"

# ── 5. Limpiar temporales ──────────────────────────────────────────────────────
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

# ── 6. Verificar ──────────────────────────────────────────────────────────────
Write-Step "Verificando instalacion..."
$check = & "$destDir\ffmpeg.exe" -version 2>&1 | Select-Object -First 1
Write-Host "  $check" -ForegroundColor Green
Write-Host ""
Write-Host "FFMPEG_INSTALADO_PORTABLE"
Write-Host ""
Write-Host "IMPORTANTE: Abre una terminal nueva para que el PATH quede activo en futuras sesiones."
Write-Host "En esta sesion ya funciona con la ruta completa: $destDir\ffmpeg.exe"
