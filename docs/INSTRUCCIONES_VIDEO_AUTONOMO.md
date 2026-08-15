# GUION MAESTRO — SUPER PRUEBA DE 1 HORA (PILOTO DEL VIDEO)
_Este documento se coloca en la carpeta **Master Prompt** de PC1 y se referencia en el `/goal`. El interlocutor único es **Antigravity en PC2** (el "Director"). Última revisión: 2026-08-15._

---

## REGLA DE ORO
Todo lo que hagas debe verse **en primer plano, lento y pausado**, para que un espectador humano pueda seguirlo y asimilarlo. Nada de ventanas ocultas ni comandos relámpago. La pantalla ES la película.

---

## FASE 0 — ENTERARSE (antes de tocar nada) · ~5 min
1. Entra a la carpeta **Master Prompt** y lee el `MANUAL_ECOSISTEMA_SGN.md` completo y el `MAPA_DE_CONSULTA_SGN.md` (la tarjeta rápida: enlaces, bots, workers, rutas — a dónde consultar y para qué).
2. Regla permanente: **siempre que necesites una ruta, un endpoint o un comando, consúltalo ahí**. No inventes rutas de memoria.
3. **Escena de inventario (en pantalla):** abre el mapa de consulta y analiza EN VOZ ALTA (vía AGY) qué herramientas del sistema puedes usar para el objetivo — "tengo el puente para mandar comandos, OpenCode para terminal, el navegador de PC1 para investigar...". El espectador ve al Director reconociendo su equipo.
4. Verifica que el ojo remoto está capturando (las pantallas de PC1 y PC2 llegan al panel MIS EQUIPOS cada ~12 segundos). Esas capturas serán los fotogramas del video final.

## FASE 1 — EL PLAN (visible, en Notepad/gedit) · ~10 min
1. Abre un editor de texto **en pantalla** (Notepad en PC1 vía puente, o gedit/nano en PC2) y redacta el plan escribiéndolo despacio, punto por punto.
2. El plan nace del **objetivo** que llegará en el `/goal`. Descomponlo en tareas ejecutables.
3. Cada paso del plan debe decir **tres cosas**:
   - QUÉ se hace
   - CON QUÉ AGENTE se hace (ver reparto abajo)
   - CUÁNTOS MINUTOS toma
4. **La suma de los minutos debe dar ~60** (la hora de la prueba). Ajusta pasos hasta que cuadre.
5. Guarda el plan como archivo (`plan-super-prueba.txt`) — quedará como evidencia.

## FASE 2 — AUDITORÍA DEL PLAN · ~5 min
1. Envía el plan a auditar con **Replit AGYCIBERCODE** (vía el bot o el puente).
2. Espera el visto bueno o incorpora las correcciones **visiblemente** en el editor.
3. Solo con el plan auditado se pasa a ejecución.

## FASE 3 — EJECUCIÓN (la película) · ~35 min
Reparto de agentes — cada paso del plan usa el ayudante correcto:
| Agente | Papel |
|---|---|
| **Antigravity (PC2)** | El Director: cursor, navegador, edición en primer plano |
| **Metagente (puente)** | Cartero: reparte comandos a PC1/PC2 y devuelve resultados |
| **Replit / AGY Manager** | Consultas de información y construcción (p. ej. sobre la app de video) |
| **Replit AGYCIBERCODE** | Auditor del plan y de los resultados |
| **OpenCode (PC2)** | Ejecución de comandos de terminal (suplente si Antigravity agota cuota) |
| **PC1 (navegador)** | Investigación profunda por web |
Reglas de escena:
- Movimientos de cursor lentos, pausa de 2-3 segundos después de cada acción importante (recuerda: la foto se toma cada 12 segundos — si vas muy rápido, la cámara no te alcanza).
- Narra en pantalla: antes de cada paso, escribe en el editor o en la terminal una línea diciendo qué vas a hacer.
- Ve marcando en el plan cada paso completado (✔) para que el avance se vea en el video.

### EL BUCLE DEL DIRECTOR (la coreografía oficial — se repite por CADA paso)
1. **Notepad:** con el mapa ya leído, abre Notepad y escribe el OBJETIVO.
2. **Descomposición:** debajo, descompone el objetivo en pasos. Cada paso dice QUÉ HERRAMIENTA va a usar y EN QUÉ PASO la usa. Todo anotado visible en Notepad.
3. **Orden:** manda la orden del paso a AGY o a CIBERCODE y espera.
4. **Voz:** CIBERCODE/AGY la lee EN VOZ ALTA antes de ejecutar.
5. **Ejecución visible:** ejecuta — por ejemplo va al Dashboard a mirar misiones, navega... y se queda **mínimo 12 segundos** en cada pantalla (para que la cámara la capture).
6. **Cambio de pantalla según quién trabaja:** si está ejecutando PC1 → cambia a la pantalla de AGY IDE donde se ve PC1; si está ejecutando PC2 → va a la vista donde se ve PC2. La cámara siempre sigue al que actúa.
7. **Anotar el logro:** al terminar el paso, vuelve a Notepad y anota el logro (✔ + una línea).
8. **Releer y repetir:** relee la descomposición y arranca el siguiente paso. Así hasta cumplir el objetivo.

### Ritmo de la película: MOVIDA, pero legible
- La película debe ser **movida**: cambia de acción y de escena con frecuencia — nunca más de 3-4 minutos en la misma ventana.
- Fórmula de cada escena: **1) AGY narra en voz alta lo que se va a hacer → 2) se muestra haciéndolo en pantalla → 3) se marca el paso ✔ → cambio de escena.**
- Cuando uses el Dashboard (puente o AGY IDE): que se vea **cómo lo abres, cómo navegas página por página** (cola de comandos, historial, MIS EQUIPOS...) y cómo ejecutas cada comando en primer plano — nada por debajo de la mesa.

### Puesta en escena "SALA DE CONTROL" (la toma estrella)
- Deja abierta **en primer plano** la ventana de AGY IDE con el panel MIS EQUIPOS, donde se ven los dos recuadros de PC1 y PC2 en vivo. Esa es la pantalla protagonista de la película.
- **Antes de cada paso, mándale el texto a AGY para que lo lea en VOZ ALTA** (AGY ya tiene voz natural). La narración manda: primero AGY anuncia el paso, luego se ve la acción ocurrir en el recuadro del PC correspondiente.
- Los recuadros de PC1 y PC2 van cambiando de imagen solos según la narración — el espectador ve la sala de control completa: la voz de AGY dirigiendo y las dos máquinas obedeciendo.

### Escena de vigilancia (la cámara del cuarto)
- En algún punto del plan, prende la **cámara de PC2** para monitorear el cuarto: el comando está guardado en el panel 📋 COMANDOS del IDE, categoría "📷 Cámara de PC2" (aparece a pantalla completa en el recuadro de PC2).
- Sirve como escena de "vigilancia en vivo" dentro del video y demuestra que el sistema también ve el mundo real, no solo pantallas. Se apaga con `pkill -f ffplay` o Ctrl+C.

## FASE 4 — SI ALGO FALLA (protocolo de emergencia)
1. **Reintenta una vez** el paso, más despacio.
2. Si vuelve a fallar, **cambia de agente**: lo que no pudo Antigravity lo intenta OpenCode (terminal) o se pide al metagente que lo mande a PC1.
3. Si nadie puede, escribe en el plan "PASO X OMITIDO — motivo" y **sigue con el siguiente**. La prueba no se detiene: un tropiezo también es parte del registro real.
4. Si el sistema entero se cae, avisa por Telegram al Lead Architect y deja el plan guardado donde quedó.

## FASE 5 — CIERRE E INFORME · ~5 min
1. Escribe en pantalla el resumen final: objetivo, pasos cumplidos, pasos omitidos, tiempo real.
2. Avisa por Telegram que la misión terminó.
3. Las ~300 capturas por PC guardadas durante la hora se ensamblan con **un solo comando** (ffmpeg, montaje en PC1) en el video-informe final de ~3 minutos: el registro real, sin edición, con música.

---

## LO QUE ESTE GUION NO CUBRE (lo construye Replit — tarea #44)
- Guardado histórico de capturas en Supabase (hoy cada foto pisa la anterior).
- El comando único de ensamblaje del video.
- Aviso automático por Telegram con el video listo.
El guion se activa SOLO cuando la tarea #44 esté construida y probada.
