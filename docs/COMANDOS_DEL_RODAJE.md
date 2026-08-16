# 🎬 COMANDOS DEL RODAJE — Arsenal probado (16-ago-2026)

Los comandos de las secciones 1–5 y 8–9 fueron **probados en vivo** y funcionan; el montaje
(sección 6) está desplegado pero **pendiente de su primera corrida real en PC1** (falta
`SUPABASE_STORAGE_KEY` en Railway — ver tarea #121). Son los que el Director
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


## 6. 🎞️ MONTAJE FINAL — UN solo comando (construido en tarea #44) ✅

El IDE sirve el script ya armado en `GET /montaje/pc1.ps1?pwd=<CLAVE>` (igual que el ojo).
Un solo comando en PC1 lo baja y lo lanza como proceso aparte (a prueba de ETIMEDOUT):

```
[PC1] EJECUTAR powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://agy-ide-production.up.railway.app/montaje/pc1.ps1?pwd=<CLAVE>' -OutFile ($env:TEMP+'\montar.ps1') -UseBasicParsing; Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',($env:TEMP+'\montar.ps1'); Write-Host MONTAJE_LANZADO"
```
⚠️ El listener de PC1 ejecuta EJECUTAR con `cmd /c`: por eso el comando va envuelto en
`powershell -Command "..."` (sintaxis PS suelta como `$c='...'` falla en cmd). Para montar
una sesión concreta, añadir `,'-Id','rodaje-...'` a la ArgumentList.

Qué hace solo: baja TODAS las fotos del último rodaje (o `-Id rodaje-...` para una sesión
concreta), arma `pelicula-<sesión>-PC1.mp4` y `...-PC2.mp4` (~1.7 fps, fundidos por mezcla
de fotogramas, 720p), los manda a Telegram (claves del `.env` de cibercode-ide, nunca por
el puente), deja copia en el Escritorio y borra los temporales. Si ffmpeg no está, se lo
instala solo (una vez, a `%USERPROFILE%\ffmpeg`). Diario: `%USERPROFILE%\montaje.log`.
También está en el panel 📋 COMANDOS del IDE, categoría "🎞️ Montar la película".
⚠️ Las fotos NO se borran solas: tras confirmar los videos, usar el botón "Borrar rodaje".

### Paso previo: instalar ffmpeg en PC1 (solo la primera vez)

```
[PC1] EJECUTAR Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/main/tools/instalar-ffmpeg-pc1.ps1' -OutFile "$env:TEMP\instalar-ffmpeg.ps1" -UseBasicParsing; powershell -ExecutionPolicy Bypass -File "$env:TEMP\instalar-ffmpeg.ps1"
```

Respuestas posibles: `FFMPEG_YA_LISTO`, `FFMPEG_INSTALADO_WINGET`, o `FFMPEG_INSTALADO_PORTABLE`.
Verificar: `[PC1] EJECUTAR ffmpeg -version 2>&1 | Select-Object -First 1`

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

## 8. 🔌 PRENDER EL OJO (la cámara de cada PC)

**PC1 (Windows)** — el propio IDE regala el script del ojo; bajarlo y arrancarlo:
```
[PC1] EJECUTAR Invoke-WebRequest -Uri "https://agy-ide-production.up.railway.app/eye/pc1.ps1?pwd=<CLAVE>" -OutFile "$env:USERPROFILE\pc1-eye.ps1"; Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',"$env:USERPROFILE\pc1-eye.ps1"; Write-Host OJO_PC1_ON
```
- En PC1 también existe `pc1-eye-guard.vbs` (el guardián que lo revive).
- Comprobar que quedó vivo: `GET /api/equipos/screens` → PC1 con `seconds_ago` bajito.

**PC2 (Linux)** — su ojo corre en el propio PC2 y normalmente ya está andando.
Comprobar: `GET /api/equipos/screens` → PC2 con `seconds_ago` bajito.
(El comando de arranque vive en PC2; se documentará al arreglar la #37 pantalla negra.)

⚠️ La `<CLAVE>` es la del IDE (la misma del header `x-agyide-pwd`). Nunca escribirla en documentos.

## 9. 📹 PRENDER LA WEBCAM FÍSICA (el lente con la lucecita) — probados ✅

Enciende la cámara real que apunta al frente (distinto del "ojo" que captura la pantalla).

**PC1 (Windows)** — abre la app Cámara y se enciende el lente:
```
[PC1] EJECUTAR Start-Process 'microsoft.windows.camera:'; Write-Host CAM_PC1_ON
```

**PC2 (Linux)** — abre el lente `/dev/video0` con ffplay, usando el truco del DISPLAY:
```
[PC2] EJECUTAR eval "$(tr '\0' '\n' < /proc/$(pgrep -f -i telegram | head -1)/environ | grep -E '^DISPLAY=|^XAUTHORITY=' | sed 's/^/export /')"; nohup ffplay -loglevel quiet -f v4l2 -framerate 15 -video_size 640x480 -i /dev/video0 >/dev/null 2>&1 & echo CAM_PC2_ON
```

- El truco del DISPLAY en PC2 es CLAVE: sin él, ffplay no encuentra la pantalla (`XDG_RUNTIME_DIR is invalid`). Roba el DISPLAY/XAUTHORITY del proceso de Telegram, que sí está en la sesión gráfica.
- Verificar con el ojo: `GET /api/equipos/screens/PC2/shot` debe mostrar la ventana `/dev/video0` con la imagen del lente.
- Para APAGAR la webcam de PC2: `[PC2] EJECUTAR pkill ffplay; echo CAM_PC2_OFF`

## 10. 🤖 OPENCODE — la IA suplente (cuando Antigravity agota cuota) — probado ✅

OpenCode v1.18.18 instalado en PC2 (`/usr/local/bin/opencode`) y en PC1 (npm). Usa Gemini Flash de respaldo.

**PC2 (Linux) — hacerle una pregunta y que responda (modo directo, no abre ventana):**
```
[PC2] EJECUTAR opencode run 'tu pregunta o tarea aqui' 2>&1 | tail -5
```

**PC2 — abrir OpenCode en modo chat interactivo (ventana):**
```
[PC2] EJECUTAR eval "$(tr '\0' '\n' < /proc/$(pgrep -f -i telegram | head -1)/environ | grep -E '^DISPLAY=|^XAUTHORITY=' | sed 's/^/export /')"; nohup x-terminal-emulator -e opencode >/dev/null 2>&1 & echo OPENCODE_ABIERTO
```

**PC1 (Windows) — pregunta directa:**
```
[PC1] EJECUTAR opencode run 'tu pregunta aqui'
```

- `opencode run '...'` = una tarea y sale (ideal para el puente, no se queda colgado).
- Ver versión: `opencode --version`.
- Úsalo como PLAN B: lo que no pudo Antigravity, lo intenta OpenCode en terminal.
- ⚠️ Preguntas largas pueden tardar; para el puente, pedir respuestas corticas.

## 11. 🕵️ VIGILANCIA DEL CUARTO (detectar intrusos por webcam) — probado ✅

Detecta movimiento en la webcam de PC2 durante 1 hora; al detectar a alguien guarda foto y avisa a Telegram con fecha y hora. El script `~/vigilante.py` lee las claves de `~/.env` (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) — la clave NUNCA pasa por el puente.

**Lanzar (PC2):**
```
[PC2] EJECUTAR pkill ffplay 2>/dev/null; sleep 1; nohup python3 ~/vigilante.py > ~/vigilancia.log 2>&1 & echo VIGILANCIA_ON
```

**Detener antes de tiempo:**
```
[PC2] EJECUTAR pkill -f vigilante.py; echo VIGILANCIA_OFF
```

- Las fotos de intrusos quedan en `~/vigilancia/intruso_FECHA_HORA.jpg`.
- Ajustes dentro del script: `UMBRAL` (sensibilidad, más bajo = más sensible), `ENFRIA` (segundos entre alertas), `DURACION` (segundos totales).
- Requiere PIL en PC2 (`python3 -c 'import PIL'`) y libera la webcam matando ffplay primero.
- ⚠️ La webcam física (ffplay) y la vigilancia usan el MISMO lente `/dev/video0`: no pueden correr a la vez. La vigilancia toma una foto cada 3s.

## 12. 🕵️ VIGILANCIA EN PC1 (Windows, webcam cada 3s) — probado ✅

Igual que la vigilancia de PC2 pero en Windows. Usa `python + opencv` (instalar una vez: `python -m pip install opencv-python-headless`). El script `tools/vigilante_win.py` lee las claves del `.env` de cibercode-ide — la clave NUNCA pasa por el puente.

**Lanzar (PC1):**
```
[PC1] EJECUTAR Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/main/tools/vigilante_win.py' -OutFile "$env:TEMP\vigilante_win.py" -UseBasicParsing; Start-Process python -WindowStyle Hidden -ArgumentList "$env:TEMP\vigilante_win.py"; Write-Host VIGILANCIA_PC1_ON
```

**Detener:**
```
[PC1] EJECUTAR Get-Process python -EA SilentlyContinue | Stop-Process -Force; Write-Host VIGILANCIA_PC1_OFF
```

- Fotos de intrusos: `%USERPROFILE%\vigilancia_pc1\intruso_FECHA_HORA.jpg`.
- ⚠️ REGLA DE ORO DEL PUENTE (Windows): NO mandar scripts largos en base64 dentro del comando — Windows falla con `spawnSync cmd.exe EPERM` cuando la línea pasa el límite (~8000 chars). Subir el script a GitHub y que PC1 lo baje con Invoke-WebRequest. Comandos cortos siempre.
- ⚠️ `Start-Process` con `-RedirectStandardOutput/Error` también da EPERM en este puente: lanzar sin redirect.

## 13. 🔁 AUTOARRANQUE DE LA VIGILANCIA (instalar una sola vez)

Tras una caída o reinicio del PC, la vigilancia vuelve sola y avisa: **"Vigilancia RESTABLECIDA TRAS REINICIO"**.

### PC1 (Windows) — tarea programada de Windows

**Paso 1 — instalar la tarea (una sola vez vía puente):**
```
[PC1] EJECUTAR Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/main/tools/instalar_autostart_pc1.ps1' -OutFile "$env:TEMP\instalar_autostart_pc1.ps1" -UseBasicParsing; powershell -ExecutionPolicy Bypass -File "$env:TEMP\instalar_autostart_pc1.ps1"
```
Respuesta esperada: `AUTOSTART_PC1_INSTALADO: tarea 'AGY-Vigilante-PC1' registrada.`

**Qué hace:**
- Descarga `tools/autostart_pc1.ps1` al perfil del usuario.
- Registra la tarea `AGY-Vigilante-PC1` en el Programador de tareas: se dispara `AtLogOn`.
- Al arrancar: baja la última versión del vigilante desde GitHub y lo lanza con `--reinicio`.

**Verificar que la tarea existe:**
```
[PC1] EJECUTAR Get-ScheduledTask -TaskName 'AGY-Vigilante-PC1' | Select TaskName, State; Write-Host TAREA_OK
```

**Eliminar la tarea (si hace falta):**
```
[PC1] EJECUTAR Unregister-ScheduledTask -TaskName 'AGY-Vigilante-PC1' -Confirm:$false; Write-Host TAREA_ELIMINADA
```

---

### PC2 (Linux) — crontab @reboot

**Paso 1 — descargar el lanzador a PC2 (una sola vez vía puente):**
```
[PC2] EJECUTAR curl -fsSL 'https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/main/tools/autostart_pc2.sh' -o ~/agy-vigilante-autostart.sh && chmod +x ~/agy-vigilante-autostart.sh && echo SCRIPT_OK
```

**Paso 2 — añadir la entrada @reboot al crontab (una sola vez vía puente):**
```
[PC2] EJECUTAR (crontab -l 2>/dev/null | grep -v agy-vigilante-autostart; echo "@reboot bash $HOME/agy-vigilante-autostart.sh >> $HOME/vigilancia_autostart.log 2>&1") | crontab -; echo AUTOSTART_PC2_INSTALADO
```
Respuesta esperada: `AUTOSTART_PC2_INSTALADO`

**Qué hace:**
- Al @reboot: espera 30 s, envía "Vigilancia RESTABLECIDA TRAS REINICIO" a Telegram y lanza `~/vigilante.py`.

**Verificar que está en el crontab:**
```
[PC2] EJECUTAR crontab -l | grep vigilante; echo CRON_OK
```

**Eliminar la entrada (si hace falta):**
```
[PC2] EJECUTAR crontab -l 2>/dev/null | grep -v agy-vigilante-autostart | crontab -; echo CRON_ELIMINADO
```

---

### 13.1 🧪 PRUEBA DE CONFIRMACIÓN DEL AUTOARRANQUE (ejecutar tras la instalación)

**Antes de reiniciar — verificar que todo está instalado:**
```
[PC1] EJECUTAR Get-ScheduledTask -TaskName 'AGY-Vigilante-PC1' | Select TaskName, State; Write-Host TAREA_OK
```
```
[PC2] EJECUTAR crontab -l | grep agy-vigilante; echo CRON_OK
```
Si alguno falla, ejecutar primero los pasos de instalación del apartado anterior.

---

**Paso 1 — Reiniciar PC1 desde el puente:**
```
[PC1] EJECUTAR Restart-Computer -Force
```
⏳ Esperar hasta 2 minutos. La tarea `AGY-Vigilante-PC1` se dispara en el siguiente inicio de sesión (AtLogOn). Debe llegar a Telegram:
> `PC1: Vigilancia RESTABLECIDA TRAS REINICIO — YYYY-MM-DD HH:MM:SS`

**Paso 2 — Reiniciar PC2 desde el puente:**
```
[PC2] EJECUTAR sudo reboot
```
⏳ Esperar hasta 2 minutos (el script espera 30 s internamente para que la red esté lista). Debe llegar a Telegram:
> `PC2: Vigilancia RESTABLECIDA TRAS REINICIO — YYYY-MM-DD HH:MM:SS`

**Paso 3 — Confirmar que los procesos están vivos tras el reinicio:**
```
[PC1] EJECUTAR Get-Process python -EA SilentlyContinue | Select Id, CPU; Write-Host VIGILANTE_PC1_VIVO
```
```
[PC2] EJECUTAR pgrep -a python3 | grep vigilante; echo VIGILANTE_PC2_VIVO
```

**Paso 4 — Ver el log del autostart en PC2 (si algo falla):**
```
[PC2] EJECUTAR tail -30 ~/vigilancia_autostart.log
```

---

### 13.2 📋 RESULTADO DE LA PRUEBA PILOTO

| Campo | PC1 (Windows) | PC2 (Linux) |
|---|---|---|
| Tarea/cron instalado | ✅ / ❌ | ✅ / ❌ |
| Reinicio ejecutado | — | — |
| Mensaje Telegram recibido | — | — |
| Tiempo hasta el mensaje | — | — |
| Proceso vivo tras reinicio | — | — |
| Resultado final | PENDIENTE | PENDIENTE |

> ⚠️ **Completar esta tabla cuando se ejecute la prueba real.** Registrar aquí la fecha, hora y cualquier ajuste necesario.

**Ajustes habituales si falla:**
- **PC1 — la tarea no se dispara:** la tarea `AGY-Vigilante-PC1` usa `AtLogOn`, no `AtStartup`; asegurarse de que el usuario hace login (no solo arranque de máquina). Si PC1 arranca sin login automático, cambiar el trigger a `-AtStartup` y reinstalar.
- **PC2 — no llega Telegram:** revisar `~/vigilancia_autostart.log` y confirmar que `~/.env` tiene `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` con valores correctos.
- **PC2 — vigilante.py no arranca:** comprobar que `~/vigilante.py` existe y que `python3 -c "import cv2"` no da error.

---

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
