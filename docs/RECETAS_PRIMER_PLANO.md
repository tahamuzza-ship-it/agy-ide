# 🎬 RECETAS DE PRIMER PLANO — Kit del Director (PC1)

> Para AGY actuando como Director. Regla de oro: TODO lo que hagas debe VERSE en pantalla.
> La cámara del ojo toma una foto cada ~12 segundos: cada acción visible debe durar al menos 12 segundos.

## ⚠️ LAS 4 REGLAS SAGRADAS

1. **VENTANA NUEVA SIEMPRE.** Nunca escribas en una ventana que ya estaba abierta: puede ser un documento real de Roberto. Abre el programa fresco y guarda su número de proceso (PID).
2. **AL FRENTE ANTES DE TOCAR.** Primero trae la ventana al primer plano, espera 1 segundo, y solo entonces escribe.
3. **ÓRDENES CORTICAS.** Un paso = un comando. Nada de tareas de 5 pasos con esperas largas en una sola orden (el motor se ahoga y da timeout).
4. **PRE-AVISO.** Antes de automatizar teclado o ratón, narra en voz alta / anota qué vas a hacer (regla del Master Prompt).
5. **REACTIVAR ANTES DE CADA ESCRITURA.** Los popups (Antigravity, notificaciones) roban el foco sin avisar. Llama `$ws.AppActivate($p.Id)` + `Start-Sleep 1` justo antes de CADA `SendKeys`, no solo al principio. Y filma solo cuando el PC esté quieto (sin Roberto usándolo).

## 📖 RECETA 1 — Abrir Notepad LIMPIO y escribir visible

```powershell
$p = Start-Process notepad -PassThru; Start-Sleep 3
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($p.Id) | Out-Null; Start-Sleep 1
$ws.SendKeys('AQUI VA TU TEXTO, SIN PARENTESIS NI SIMBOLOS RAROS'); Start-Sleep 12
```
- Activa SIEMPRE por `$p.Id` (el PID del que TÚ abriste), nunca por título.
- SendKeys: evita `( ) { } + ^ % ~` en el texto (son teclas especiales). Solo letras, números, guiones, puntos.
- Para línea nueva: `$ws.SendKeys('{ENTER}')`.

## 📖 RECETA 2 — Abrir un enlace en el navegador en primer plano

```powershell
Start-Process 'https://EL-ENLACE-AQUI'; Start-Sleep 12
```
- El navegador se abre solo en primer plano. Los 12 segundos garantizan la foto del ojo.
- Si el navegador ya estaba abierto, la pestaña nueva igual queda al frente.

## 📖 RECETA 3 — Cambiar de escena (traer una ventana existente al frente)

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate('PARTE-DEL-TITULO-DE-LA-VENTANA') | Out-Null; Start-Sleep 12
```
- SOLO para MIRAR (cambiar la vista), NUNCA para escribir en ella.
- Ejemplos de escena: `AppActivate('AGY-IDE')` para la sala de control, `AppActivate('Bloc')` para volver al Notepad del plan (mejor: guarda el PID de tu Notepad y usa `AppActivate($p.Id)`).

## 📖 RECETA 4 — Anotar un resultado en TU Notepad del plan

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($pidNotepadDelPlan) | Out-Null; Start-Sleep 1
$ws.SendKeys('{ENTER}'); $ws.SendKeys('LOGRADO - punto 1 - la pagina abrio bien'); Start-Sleep 12
```

## 🎥 LA ESCENA DEL MAPA (guion aprobado por Roberto)

Con los enlaces del MAPA DE CONSULTA, el Director hace esto por cada punto:

1. **PLAN**: abre Notepad nuevo (Receta 1), escribe el plan con los enlaces del Mapa y lo narra en voz alta.
2. **ACCIÓN**: abre el enlace en el navegador en primer plano (Receta 2) y se queda 12 segundos mirándolo.
3. **CAMBIO DE ESCENA**: trae al frente AGY IDE mostrando el panel MIS EQUIPOS con PC1 (Receta 3), 12 segundos.
4. **SEGUNDA ESCENA**: cambia a la vista de PC2 en el panel, 12 segundos.
5. **EJECUTA** la tarea del punto, todo en primer plano, y obtiene el resultado.
6. **ANOTA**: vuelve a su Notepad del plan (Receta 4), escribe el resultado, narra "punto terminado".
7. **SIGUIENTE**: pasa al próximo punto del plan.

Si un punto completo corona de principio a fin: 🏆 CORONAMOS — la película es viable.

## 🚫 ERRORES QUE YA COMETIMOS (no repetir)

- Abrir notepad "por debajo de la mesa" (proceso sin ventana) y decir OK: el ojo no vio nada.
- SendKeys a ciegas: el texto cayó en un documento real abierto de Roberto.
- Una orden larga con esperas de 15+20 segundos adentro: timeout del motor (ETIMEDOUT).

## 🛠️ INSTALAR FFMPEG EN PC1 (solo la primera vez)

Antes de poder montar el video, PC1 necesita tener ffmpeg instalado.
Ejecutar este comando en el puente — se descarga y corre el instalador automático:

```
[PC1] EJECUTAR Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/main/tools/instalar-ffmpeg-pc1.ps1' -OutFile "$env:TEMP\instalar-ffmpeg.ps1" -UseBasicParsing; powershell -ExecutionPolicy Bypass -File "$env:TEMP\instalar-ffmpeg.ps1"
```

El instalador:
1. Si ffmpeg ya está → sale con `FFMPEG_YA_LISTO` (no hace nada más).
2. Intenta instalar via **winget** (Gyan.FFmpeg) — método preferido, queda en PATH global.
3. Si winget falla → descarga la **versión portable** desde GitHub (Gyan.dev) en `%LOCALAPPDATA%\ffmpeg-portable\bin` y la agrega al PATH de usuario permanentemente.
4. Al final imprime `FFMPEG_INSTALADO_WINGET` o `FFMPEG_INSTALADO_PORTABLE`.

**Verificar que quedó bien** (mismo comando del puente — usa ruta explícita para no depender del PATH del listener):
```
[PC1] EJECUTAR $p=(Get-Command ffmpeg -EA SilentlyContinue)?.Source; if(-not $p){$p="$env:LOCALAPPDATA\ffmpeg-portable\bin\ffmpeg.exe"}; & $p -version 2>&1 | Select-Object -First 1
```
Debe responder algo como `ffmpeg version 7.x.x ...`.

---

## 🎞️ MONTAJE — armar el video con un solo comando (en PC1)

Cuando el rodaje terminó (botón "Parar" en el panel), PC1 baja todas las fotos y arma el video.
Requiere ffmpeg instalado en PC1 (ver sección anterior). Reemplaza `TU_CLAVE` por la clave del IDE.

```powershell
$B='https://agy-ide-production.up.railway.app'; $K='TU_CLAVE'
# Auto-detectar ffmpeg (PATH del listener puede no incluirlo tras instalacion portable)
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue)?.Source
if (-not $ffmpeg) { $ffmpeg = "$env:LOCALAPPDATA\ffmpeg-portable\bin\ffmpeg.exe" }
if (-not (Test-Path $ffmpeg)) { Write-Host "ERROR: ffmpeg no encontrado. Ejecuta primero el instalador."; exit 1 }
Write-Host "Usando ffmpeg: $ffmpeg"
$dir="$env:TEMP\rodaje"; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $dir | Out-Null
$list = Invoke-RestMethod -Uri "$B/api/pelicula/list" -Headers @{'x-agyide-pwd'=$K}
$i=0
foreach($f in $list.files){ $i++; $out=Join-Path $dir ("{0:D4}.jpg" -f $i)
  Invoke-WebRequest -Uri "$B/api/pelicula/shot?name=$([uri]::EscapeDataString($f))" -Headers @{'x-agyide-pwd'=$K} -OutFile $out }
& $ffmpeg -y -framerate 2 -i "$dir\%04d.jpg" -vf "scale=1280:-2,format=yuv420p" -r 24 "$env:USERPROFILE\Desktop\pelicula.mp4"
Remove-Item $dir -Recurse -Force
Write-Host "Video listo en el Escritorio: pelicula.mp4"
```

- `-framerate 2` = 2 fotos por segundo (súbelo a 3-4 para un video más rápido).
- El video queda en el Escritorio como `pelicula.mp4`; las fotos temporales se borran solas.
- Después, borra las fotos de Supabase con el botón "🗑️ Borrar" del panel (o deja que el tope de 700 avise).
