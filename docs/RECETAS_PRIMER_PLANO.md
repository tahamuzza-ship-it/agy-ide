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
