# 🎬 RECETAS DE PRIMER PLANO — Kit del Director (PC1)

> Para AGY actuando como Director. Regla de oro: TODO lo que hagas debe VERSE en pantalla.
> La cámara del ojo toma una foto cada ~12 segundos: cada acción visible debe durar al menos 12 segundos.

_Última revisión: 2026-08-16 (incorpora lecciones de tomas 1-6 en vivo)._

---

## ⚠️ LAS 5 REGLAS SAGRADAS

1. **VENTANA NUEVA SIEMPRE.** Nunca escribas en una ventana que ya estaba abierta: puede ser un documento real de Roberto. Abre el programa fresco. En Notepad moderno (Win11) NUNCA abras `notepad` a secas — abre un archivo .txt propio en TEMP (`notepad "$env:TEMP\escena.txt"`), así la pestaña nueva cae en TU hoja y no en la de Roberto.
2. **AL FRENTE ANTES DE CADA TECLA.** Primero fuerza la ventana al primer plano con Win32 SetForegroundWindow (ver Receta 5), espera 200ms, y solo entonces escribe. Un clic de Roberto o un popup (Antigravity, Windows Update) roba el foco en microsegundos: la regla aplica ANTES DE CADA TECLA, no solo al inicio.
3. **ÓRDENES CORTICAS.** Un paso = un comando. Sin esperas largas dentro de un solo prompt AGY (da ETIMEDOUT). Si la escena dura más de 30 segundos, lánzala como proceso aparte (ver Receta 6).
4. **PRE-AVISO.** Antes de automatizar teclado o ratón, narra en voz alta / anota qué vas a hacer (regla del Master Prompt). Si Roberto está usando el PC, ESPERA — filma solo cuando la máquina esté quieta.
5. **PORTA PAPELES > SENDKEYS PARA TEXTOS LARGOS.** Set-Clipboard + SendKeys('^v') copia el texto al portapapeles y lo pega en milisegundos; eso reduce la ventana de robo-de-foco de 40 segundos a casi cero. Usa SendKeys letra por letra solo para efectos de "escritura en vivo" cortos (<5 palabras).

---

## 📖 RECETA 1 — Abrir hoja PROPIA en Notepad y escribir visible (básica)

```powershell
# Crea un .txt tuyo — NUNCA "notepad" a secas en Win11 (abre pestaña sobre documentos del dueño)
$hoja = Join-Path $env:TEMP ("ESCENA_" + (Get-Date -Format 'HHmmss') + ".txt")
"" | Set-Content $hoja
$p = Start-Process notepad -ArgumentList "`"$hoja`"" -PassThru
Start-Sleep 3

# WScript para AppActivate y SendKeys
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($p.Id) | Out-Null; Start-Sleep 1

# Pegar via portapapeles (seguro y rápido)
Set-Clipboard -Value "AQUI VA TU TEXTO"
$ws.SendKeys("^v"); Start-Sleep 12
```
- En Win11 `Start-Process notepad -PassThru` puede devolver un PID fantasma (muere al instante). Si AppActivate falla, usa la Receta 5 (Win32) para encontrar el proceso real.
- SendKeys: evita `( ) { } + ^ % ~` en el texto (son teclas especiales). Solo letras, números, guiones, puntos. O usa el portapapeles.
- Para línea nueva: `$ws.SendKeys('{ENTER}')`.

---

## 📖 RECETA 2 — Abrir un enlace en el navegador en primer plano

```powershell
Start-Process 'https://EL-ENLACE-AQUI'; Start-Sleep 12
```
- El navegador se abre solo en primer plano. Los 12 segundos garantizan la foto del ojo.
- Si el navegador ya estaba abierto, la pestaña nueva igual queda al frente.

---

## 📖 RECETA 3 — Cambiar de escena (traer una ventana existente al frente)

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate('PARTE-DEL-TITULO-DE-LA-VENTANA') | Out-Null; Start-Sleep 12
```
- SOLO para MIRAR (cambiar la vista), NUNCA para escribir en ella.
- Ejemplos: `AppActivate('AGY-IDE')` para la sala de control, `AppActivate('Bloc')` para volver al Notepad. Mejor: guarda el PID de tu Notepad y usa `AppActivate($p.Id)`.

---

## 📖 RECETA 4 — Anotar un resultado en TU Notepad del plan

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($pidNotepadDelPlan) | Out-Null; Start-Sleep 1
Set-Clipboard -Value "LOGRADO - punto 1 - la pagina abrio bien"
$ws.SendKeys("{ENTER}"); $ws.SendKeys("^v"); Start-Sleep 12
```

---

## 📖 RECETA 5 — RECETA GANADORA (Win32 force-front) — proceso real + foco garantizado

Esta es la receta probada en toma 6. Funciona aunque AppActivate falle, aunque el Notepad moderno devuelva PID fantasma, y aunque haya popups activos.

```powershell
# 1. Añadir Win32 SetForegroundWindow una sola vez al inicio del script
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

# 2. Abrir TU hoja en TEMP
$hoja = Join-Path $env:TEMP ("ESCENA_" + (Get-Date -Format 'HHmmss') + ".txt")
"" | Set-Content $hoja
Start-Process notepad -ArgumentList "`"$hoja`""
Start-Sleep 3

# 3. Buscar el proceso REAL (el PID de Start-Process puede morir; busca por MainWindowHandle)
$np = Get-Process notepad | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $np.MainWindowHandle

# 4. Forzar al frente con Win32 (más fiable que AppActivate solo)
[Win32]::ShowWindow($h, 3)  # 3 = SW_MAXIMIZE o SW_RESTORE
[Win32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500

# 5. Escribir via portapapeles (evita 40s de SendKeys letra por letra)
$ws = New-Object -ComObject WScript.Shell
Set-Clipboard -Value "Linea 1 del texto"
$ws.SendKeys("^v")
Start-Sleep -Milliseconds 300

# Repetir forzado-de-foco antes de cada bloque de texto
[Win32]::SetForegroundWindow($h)
Set-Clipboard -Value "Linea 2 del texto"
$ws.SendKeys("{ENTER}"); $ws.SendKeys("^v")
Start-Sleep 12
```

---

## 📖 RECETA 6 — Escenas largas (>30 s) como proceso aparte

El spawnSync del listener mata comandos que tardan más de ~1-2 minutos (ETIMEDOUT).
Para escenas largas: escribir el script a un .ps1 y lanzarlo independiente.

```powershell
# Paso 1 (comando corto — enviado por el puente):
# Escribe el script completo en un .ps1 local, descargándolo de GitHub
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/<COMMIT>/tools/escena.ps1' -OutFile "$env:TEMP\escena.ps1" -UseBasicParsing; Write-Host SCRIPT_LISTO

# Paso 2 (comando corto — enviado por el puente):
# Lanzar como proceso aparte (WindowStyle Hidden para no crear ventana de PowerShell extra)
Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',"$env:TEMP\escena.ps1"; Write-Host ESCENA_LANZADA
```
- El script .ps1 corre independiente — el listener puede cerrarse sin matar la escena.
- Nunca usar `-RedirectStandardOutput/-RedirectStandardError` en el puente: da EPERM.
- El script escribe su propio log: `Start-Transcript "$env:TEMP\escena.log"`.

---

## 🎥 LA ESCENA DEL MAPA (guion aprobado por Roberto)

Con los enlaces del MAPA DE CONSULTA, el Director hace esto por cada punto:

1. **PLAN**: abre hoja nueva (Receta 1 o 5), escribe el plan con los enlaces del Mapa.
2. **ACCIÓN**: abre el enlace en el navegador en primer plano (Receta 2), 12 segundos.
3. **CAMBIO DE ESCENA**: trae al frente AGY IDE mostrando el panel MIS EQUIPOS con PC1 (Receta 3), 12 segundos.
4. **SEGUNDA ESCENA**: cambia a la vista de PC2 en el panel, 12 segundos.
5. **EJECUTA** la tarea del punto, todo en primer plano, y obtiene el resultado.
6. **ANOTA**: vuelve a su hoja del plan (Receta 4), escribe el resultado.
7. **SIGUIENTE**: pasa al próximo punto del plan.

Si un punto completo corona de principio a fin: 🏆 CORONAMOS — la película es viable.

---

## 🚫 ERRORES QUE YA COMETIMOS (no repetir)

| Error | Qué pasó | Cómo evitarlo |
|---|---|---|
| `notepad` a secas en Win11 | Abre pestaña sobre el documento real de Roberto | Crear .txt en TEMP y abrirlo explícitamente |
| AppActivate por título genérico | Cayó en una ventana del dueño | Activar siempre por PID o por `MainWindowHandle` |
| `Start-Process notepad -PassThru` | PID fantasma (muere al instante en Win11 empaquetado) | `Get-Process notepad | Where MainWindowHandle -ne 0` |
| SendKeys letra por letra durante 40s | Un clic de Roberto desvió TODAS las teclas a otra app | Usar portapapeles (Set-Clipboard + ^v) |
| AppActivate una sola vez al inicio | Popup robó el foco; texto siguió cayendo en otra ventana | Win32 SetForegroundWindow antes de CADA bloque de texto |
| Prompt AGY largo con esperas | `spawnSync agy.exe ETIMEDOUT` | Prompts cortos; escenas largas como .ps1 aparte |
| Script en base64 >8000 chars | `spawnSync cmd.exe EPERM` | Subir script a GitHub y bajarlo con Invoke-WebRequest |
| Filmar mientras Roberto usa el PC | SendKeys escribió en su chat/docs | Pre-aviso por voz, esperar PC quieto |

---

## 🎞️ MONTAJE — armar el video con un solo comando (en PC1)

Cuando el rodaje terminó (botón "Parar" en el panel), PC1 baja todas las fotos y arma el video.
Requiere ffmpeg instalado en PC1. Reemplaza `TU_CLAVE` por la clave del IDE.

```powershell
$B='https://agy-ide-production.up.railway.app'; $K='TU_CLAVE'
$dir="$env:TEMP\rodaje"; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $dir | Out-Null
$list = Invoke-RestMethod -Uri "$B/api/pelicula/list" -Headers @{'x-agyide-pwd'=$K}
$i=0
foreach($f in $list.files){ $i++; $out=Join-Path $dir ("{0:D4}.jpg" -f $i)
  Invoke-WebRequest -Uri "$B/api/pelicula/shot?name=$([uri]::EscapeDataString($f))" -Headers @{'x-agyide-pwd'=$K} -OutFile $out }
ffmpeg -y -framerate 2 -i "$dir\%04d.jpg" -vf "scale=1280:-2,format=yuv420p" -r 24 "$env:USERPROFILE\Desktop\pelicula.mp4"
Remove-Item $dir -Recurse -Force
Write-Host "Video listo en el Escritorio: pelicula.mp4"
```

- `-framerate 2` = 2 fotos por segundo (súbelo a 3-4 para un video más rápido).
- El video queda en el Escritorio como `pelicula.mp4`; las fotos temporales se borran solas.
- Después, borra las fotos de Supabase con el botón "🗑️ Borrar" del panel (o deja que el tope de 700 avise).
