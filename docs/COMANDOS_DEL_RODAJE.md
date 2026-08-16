# 🎬 COMANDOS DEL RODAJE — Arsenal probado (16-ago-2026)

Todos estos comandos fueron **probados en vivo** y funcionan. Son los que el Director
(o cualquier agente) necesita durante el rodaje y las tareas.

## Cómo se manda un comando (regla general)

Todo va por el puente: `POST https://automate-make.replit.app/api/antigravity/send`
con cuerpo `{"instruction": "...", "target": "PC1" o "PC2", "confirmed": true}`.
Luego se consulta `GET /api/antigravity/status/<id>` hasta que diga `done`.

- `[PC1] EJECUTAR <powershell>` → PC1 es **Windows** (PowerShell)
- `[PC2] EJECUTAR <bash>` → PC2 es **Linux** (bash)
- `[PC1] AGY <prompt corto>` → la IA responde directo con el texto
- `[PC2] AGY <prompt corto>` → ⚠️ PC2 solo confirma "OK:" que recibió; el resultado llega después (no esperar respuesta inmediata)
- ⚠️ Prompts AGY largos con esperas → `ETIMEDOUT`. Siempre corticos.

## 1. 📢 AVISO ANTES DE RODAR (probados ✅)

**PC1 (Windows)** — ventanita que se cierra sola a los 8 segundos:
```
[PC1] EJECUTAR (New-Object -ComObject WScript.Shell).Popup('SILENCIO EN EL SET: el rodaje comienza en 30 segundos',8,'AVISO DE RODAJE',64); Write-Host AVISO_OK
```

**PC2 (Linux)** — notificación de escritorio:
```
[PC2] EJECUTAR export DISPLAY=:1; notify-send -t 8000 'AVISO DE RODAJE' 'El rodaje comienza en 30 segundos' && echo AVISO_OK
```

## 2. 🎥 LA CÁMARA (el rodaje) — probados ✅

Base: `https://agy-ide-production.up.railway.app` · Header: `x-agyide-pwd: <clave del IDE>`

| Acción | Comando |
|---|---|
| Empezar a grabar | `POST /api/pelicula/start` |
| ¿Cómo va? | `GET /api/pelicula/status` (count/700, por PC) |
| Parar | `POST /api/pelicula/stop` |
| Listar fotos | `GET /api/pelicula/list` |
| Bajar una foto | `GET /api/pelicula/shot?name=<archivo>` |
| Borrar todo | `POST /api/pelicula/clear` (¡pregunta primero!) |

Ejemplo completo:
```bash
curl -s -X POST "$BASE/api/pelicula/start" -H "x-agyide-pwd: $CLAVE"
```

⚠️ **REGLA DE ORO: no subir código a GitHub mientras se filma** (Railway se reinicia y el rodaje vuelve a cero).

## 3. 👁️ EL OJO (ver las pantallas) — probados ✅

```
GET /api/equipos/screens                → estado de ambos ojos (hace cuántos segundos, terminal en vivo)
GET /api/equipos/screens/PC1/shot       → foto actual de PC1 (también PC2)
```
Mismo header `x-agyide-pwd`. (El header `x-equipos-key` NO sirve, da "No autorizado".)

## 4. 🤖 ANTIGRAVITY DURANTE EL RODAJE — probados ✅

Prueba de vida (responde "LISTO"):
```
[PC1] AGY Responde solo con la palabra: LISTO
```
Para actuar en pantalla: usar las recetas de `RECETAS_PRIMER_PLANO.md`
(ventana nueva siempre, `AppActivate` antes de CADA `SendKeys`, órdenes corticas).
⚠️ AGY con `--print` abre programas SIN ventana visible — para la película usar las recetas PowerShell, no pedirle a AGY que "abra" cosas.

## 5. 📦 LLEVAR ARCHIVOS A PC1 — probado ✅

Siempre por **URL de commit exacto** (el raw de `main` cachea versiones viejas):
```
[PC1] EJECUTAR Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/<COMMIT>/docs/<archivo>' -OutFile 'C:\Users\Roberto1\OneDrive\Desktop\GitHub\cibercode-ide\SGN_Master_Prompt\<archivo>' -UseBasicParsing; (Get-Item '<destino>').Length
```

## 6. 🎞️ MONTAJE FINAL — receta en RECETAS_PRIMER_PLANO.md

Un solo comando PowerShell en PC1: baja todas las fotos vía `/api/pelicula/shot` y arma `pelicula.mp4` en el Escritorio con ffmpeg (2 fotos por segundo).

### Escena narrada completa — RECETA GANADORA (toma 6, probada ✅)

El patrón que funciona de punta a punta (voz + hoja en blanco propia + escritura lenta visible + lectura final):

1. **Aviso por voz** y 10 segundos de espera (nadie toca el PC durante la escena).
2. **Hoja en blanco PROPIA**: crear un .txt nuevo en TEMP y abrir ESE archivo — nunca `notepad` a secas (el Notepad moderno abre pestaña sobre el documento del dueño):
   `$hoja = Join-Path $env:TEMP ('ESCENA_' + (Get-Date -Format 'HHmmss') + '.txt'); '' | Set-Content $hoja; Start-Process notepad -ArgumentList "`"$hoja`""`
3. **Buscar el proceso REAL**: `Start-Process notepad -PassThru` da un PID fantasma (muere al instante). Usar: `Get-Process notepad | Where-Object { $_.MainWindowHandle -ne 0 } | Select -First 1`
4. **Forzar al frente con Win32 antes de CADA tecla** (AppActivate solo no basta):
   `[Win32]::ShowWindow($h,3); [Win32]::SetForegroundWindow($h)` (Add-Type con user32.dll)
5. **Escritura lenta**: SendKeys letra por letra con `Start-Sleep -Milliseconds 100`, escapando `+^%~(){}[]` con llaves.
6. **Lectura final**: `$voz.Speak()` de cada renglón (Speak bloquea = sincroniza solo).
7. **Escenas >30 segundos**: SIEMPRE lanzarlas como proceso aparte (script por base64 → `$env:TEMP\escena.ps1` → `Start-Process powershell -WindowStyle Hidden -File ...`), porque el listener mata comandos largos (ETIMEDOUT).

El script completo de referencia queda en PC1: `$env:TEMP\escena6.ps1`.

## ❌ Lo que NO usar todavía

- `/goal` del IDE: apunta a la base equivocada (tarea #33 pendiente).
- Prompts AGY largos o con "espera X segundos": se caen por timeout.

## 7. 🎙️ EL NARRADOR (voz de PC1) — probado ✅

PC1 tiene la voz **Microsoft Sabina Desktop (es-MX)**. El Director puede narrar mientras actúa:

```
[PC1] EJECUTAR Add-Type -AssemblyName System.Speech; $voz=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voz.SelectVoice('Microsoft Sabina Desktop'); $voz.Rate=0; $voz.Speak('Texto a narrar aqui'); Write-Host VOZ_OK
```

Escena narrada completa (voz → abrir ventana al frente → narrar → escribir → narrar cierre):
usar el patrón de la prueba: `Speak(...)` antes y después de cada acción, y siempre
`$ws.AppActivate($p.Id)` antes de cada `SendKeys` (regla 5 del recetario).

- `$voz.Rate` = velocidad (-2 más lenta, 2 más rápida).
- `Speak()` bloquea hasta terminar de hablar — sirve para sincronizar voz y acción.
- Evitar tildes/ñ en el texto si el comando viaja por el puente (se pueden dañar en el camino).
