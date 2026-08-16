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

## ❌ Lo que NO usar todavía

- `/goal` del IDE: apunta a la base equivocada (tarea #33 pendiente).
- Prompts AGY largos o con "espera X segundos": se caen por timeout.
