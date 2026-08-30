# MANUAL MAESTRO DEL ECOSISTEMA SGN / TAHASISTEM PRO
_Fuente única de verdad. Este mismo archivo se sube a: memoria del agente, Master Prompt de PC1, PC1, PC2, y a AGY para que lo lea en cada chat._

Última revisión: 2026-08-30

---

## 0. RESUMEN EN UNA FRASE
Roberto (o Camilo) dan una orden por **Telegram**, **AGY IDE** o **Yarbis** → el **Puente/Buzón oficial de Railway** la guarda en **Supabase** → los **ayudantes (listeners)** de **PC1 (Windows)** y **PC2 (Linux)** la recogen, ejecutan y devuelven el resultado. Las órdenes de Yarbis siempre requieren una propuesta visible y confirmación humana antes de entrar al Buzón.

---

## 1. LAS TRES APLICACIONES
1. **AGY IDE** — el editor con IA.
   - Repo GitHub: `tahamuzza-ship-it/agy-ide` → Railway: `agy-ide-production.up.railway.app`
   - Aquí viven Yarbis y las rutas `/api/ops/mailbox/*`.
   - Copia de desarrollo en este proyecto Replit: frontend React en `artifacts/agycibercode/src/`, backend en `artifacts/api-server/src/agy/legacy.cjs`
   - Espejo completo: repo `AgCyberCode-Manager`
2. **CIBERCODE** — el otro IDE.
   - Repo: `cibercode-ide` → Railway: `cibercode-ide-production.up.railway.app`
3. **Puente/Buzón oficial de Railway** — el cartero 24/7 que conecta todo.
   - Contrato activo: `workspaceapi-server-production-0f24.up.railway.app`
   - Aquí viven `/api/antigravity/*`, `/api/misiones/*` y `/api/ag/*`.
   - Código fuente documental entregado en repo: `tahamuzza-ship-it/agy-bridge`
   - Replit es desarrollo; no debe sustituir el dominio Railway en listeners o consumidores productivos.

---

## 2. LOS TRES BOTS FUNDAMENTALES DE TELEGRAM
| Bot | Para qué sirve | Ligado a |
|-----|----------------|----------|
| **@Muzzapresentaciones_bot** | Privado de Roberto. Canal personal del Lead Architect. | Webhook AGY (verificado con getMe) |
| **bot Tahamza (memoria)** | Agente de MEMORIA. App aparte + bot aparte. Registra y recuerda lo que hace el ecosistema. | App de memoria (pendiente de integrar) |
| **@Codearquitect_bot** | Comandos del ecosistema (mencionado en el Master Prompt del metagente). | CIBERCODE + AGY IDE |

> Nota: hay que confirmar qué token corresponde a cada bot antes de conectar el de memoria. Ver sección 9.

---

## 3. EL PUENTE POR DENTRO (endpoints reales)

Base productiva de esta sección: `https://workspaceapi-server-production-0f24.up.railway.app`.

### 3.1 Comandos directos a los PC — tabla `antigravity_commands`
| Método y ruta | Auth | Qué hace |
|---------------|------|----------|
| `POST /api/antigravity/send` | header `x-antigravity-key` | Encola un comando. Acepta `{instruction, target:"PC1"/"PC2", confirmed, goal_session_id, dispatch_token}`. |
| `POST /api/antigravity/send-architect` | header `x-lead-architect-key` | Igual pero privado del Lead Architect (apps externas). |
| `GET /api/antigravity/pending?pc=PC1` | header `x-antigravity-key` | El listener pide su comando. Filtra por prefijo `[PC1]`/`[PC2]`. Marca `processing`. |
| `POST /api/antigravity/result/:id` | header `x-antigravity-key` | El listener devuelve el resultado real. |
| `GET /api/antigravity/status/:id` | header `x-antigravity-key` | Consultar si ya se ejecutó. Resultado en `result`. |
| `GET /api/antigravity/queue` · `recent` | ninguna | Cola activa / historial de operaciones. |
| `POST /api/antigravity/clear-queue` · `cancel/:id` | ninguna | Limpiar/cancelar. |
| `GET/POST /api/antigravity/screen` | key en POST | Captura de pantalla de PC2 (in-memory, JPEG). |
| `GET /api/antigravity/heartbeat` | ninguna | Estado online/offline de PC1 y PC2 (online si <90s). |
| `POST /api/antigravity/terminal` | `x-antigravity-key` | PC1/PC2 sube las últimas líneas de terminal. |
| `GET /api/antigravity/terminal?pc=PC1` | ninguna | Consulta la terminal reciente de un PC. |
| `GET /api/antigravity/eye?pc=PC1` | ninguna | Estado combinado de ojo, captura y terminal. |
| `POST /api/antigravity/file-diff` | `x-antigravity-key` | Registra un cambio de archivo para revisión. |
| `GET /api/antigravity/file-diffs` | `X-SGN-Auth` | Lista diffs pendientes sin devolver originales completos. |
| `POST /api/antigravity/file-diff/:id/accept` | `X-SGN-Auth` | Acepta un diff pendiente. |
| `POST /api/antigravity/file-diff/:id/revert` | `X-SGN-Auth` | Solicita revertir un diff pendiente. |

> Contrato vivo verificado el 2026-08-28: tanto el envío como la consulta de estado se hacen con `x-antigravity-key`. Nunca escribir ni mostrar el valor de esa clave.

### 3.2 Misiones con IA — tabla `misiones` (Centro de Operaciones)
| Método y ruta | Qué hace |
|---------------|----------|
| `POST /api/misiones` | Crea misión. `modo:"agyp"` = lenguaje natural que ejecuta AGY. `[PLAN_SOLO]` = solo plan sin ejecutar. Valida chat_id (solo LA o Comandante). Firma HMAC. |
| `GET /api/misiones` | Lista misiones para consulta operativa. |
| `GET /api/misiones/pending?agente=PC1` | El listener recoge su misión. **Claim atómico**: solo una máquina la toma. |
| `PATCH /api/misiones/:id` | El listener actualiza estado/resultado. Al terminar en PC2 avisa por Telegram. |
| `GET /api/misiones/:id` | Consultar una misión. |
| `POST /api/misiones/cancel/:id` | Cancelar una misión concreta. |
| `POST /api/misiones/reset-stuck` | Liberar misiones atascadas. |
| `POST /api/misiones/:id` | Alias de actualización para clientes antiguos. |
| `POST /api/misiones/:id/resultado` | Alias para reportar resultado/estado. |
| `POST /api/misiones/:id/status` | Alias para reportar estado/resultado. |
| Auto-reset | Cada 5 min libera misiones `en_proceso` con más de 30 min a `pendiente`. |

### 3.3 Descarga de listeners (auto-update)
| Ruta | Da |
|------|-----|
| `GET /api/ag/ver` | Versión actual del listener (hoy `v7-stable`). |
| `GET /api/ag/n` | Listener Node.js para **PC2 Linux**. Requiere `x-antigravity-key`. |
| `GET /api/ag/w` | Listener Node.js para **PC1 Windows**. Requiere `x-antigravity-key`. |
| `GET /api/ag/p` | Listener alterno para PC2, sin curl ni sudo. Requiere key. |
| `GET /api/ag/s` | Script de captura de pantalla para PC2. Requiere key. |
| `GET /api/ag/t1` | Terminal web para PC1 (puerto 7681). Requiere key. |
| `GET /api/ag/bin/agy-url` | Binario auxiliar para actualizar la URL de AGY. |
| `GET /api/antigravity/pc2-listener.sh` | Script del listener de PC2. Requiere key. |
| `GET /api/ag/l` | Atajo Linux al listener PC2. Requiere key. |
| `GET /api/ag/watchdog` | Guardián PowerShell de PC1. Requiere key. |
| `GET /api/ag/s1` | Ojo remoto PowerShell de PC1. Requiere key. |
| `GET /api/ag/setup1` | Instalador de autoarranque PC1. Requiere key. |
| `GET /api/ag/setup2` | Instalador de autoarranque PC2. Requiere key. |
| `GET /api/ag/toggle1ps` · `/api/ag/toggle1` | Activa/desactiva el ojo de PC1. Requiere key. |
| `GET /api/ag/toggle2` | Activa/desactiva el ojo de PC2. Requiere key. |

> **INCIDENTE CRÍTICO DETECTADO Y MITIGADO PARCIALMENTE EL 2026-08-30:** las 14 rutas de instalación/listener llegaron a responder 200 sin auth. El hotfix publicado en `tahamuzza-ship-it/Automate-Make` obliga `authGuard` durante el build y elimina los literales del artefacto compilado. Verificación viva: las 14 rutas devuelven 401 sin header y `/api/ag/w` devuelve 200 con una key válida. La credencial que pudo quedar expuesta todavía debe rotarse con transición automática de listeners, y el monolito Git debe limpiarse directamente cuando haya un canal de escritura para archivos grandes. Hasta completar ambos pasos, el incidente no está cerrado.

### 3.4 Registro de PCs

| Método y ruta | Qué hace |
|---|---|
| `POST /api/pc-registry` | Registra o actualiza un PC; la fuente exige autenticación del registro. |
| `GET /api/pc-registry` | Lista los PCs registrados. |
| `GET /api/pc-registry/:pc` | Consulta un PC concreto. |

---

## 4. COMANDOS QUE ENTIENDEN LOS AYUDANTES (listeners)
| Comando | Qué hace | PC1 | PC2 |
|---------|----------|-----|-----|
| `EJECUTAR <cmd>` | Shell directo, **sin IA, sin gastar cuota** | ✅ | ✅ |
| `LISTAR <ruta>` | Lista carpeta (`dir`/`ls -la`) | ✅ | ✅ |
| `LEER <ruta>` | Lee un archivo (tope ~2000 chars) | ✅ | — |
| `ABRIR <ruta/url>` | Abre archivo o programa | ✅ | — |
| `STATUS` | Diagnóstico: host, RAM, versión, si AGY está | ✅ | ✅ |
| `AGY <prompt>` | Manda a la IA AGY (modo `--print`, no interactivo) | ✅ | ✅ |
| `AGY_INSTALL` | Descarga e instala el binario de AGY | ✅ | ✅ |
| `AGY_START` / `AGY_STOP` | Arranca/detiene el proceso AGY | ✅ | ✅ |
| `AGY_VER` | Devuelve el último output capturado de AGY | ✅ | ✅ |
| `INICIAR_SCREEN` / `DETENER_SCREEN` | Capturas de pantalla cada 3s | — | ✅ |
| comandos "seguros" (echo, dir, whoami, df, uptime...) | En PC1 se ejecutan directo sin IA | ✅ | — |

**Regla de oro de costo:** para tareas mecánicas usa `EJECUTAR` (no gasta cuota de IA). Reserva `AGY <prompt>` solo cuando de verdad necesitas que la IA piense.

> Matriz verificada el 2026-08-30 contra la fuente desplegable `Automate-Make/artifacts/api-server/src/routes/antigravity.ts` (`v7-stable`) y contra los listeners servidos. La copia histórica `docs/agy-bridge-src/bridge__antigravity.ts` no implementa todas estas capacidades y no debe usarse para inferir comandos actuales.

### 4.1 Skills dinámicas — trucos nuevos sin tocar el código
AGY tiene un registro de skills en Supabase (tabla `cibercode_chats`, project `agyide-skills`). Instalar o borrar una skill NO requiere redeploy: el catálogo se lee en caliente y se inyecta automáticamente en los prompts de la IA (chat del IDE y planificador de `/goal`), así AGY decide sola cuándo usarlas.

Cada skill = `{ name, descripcion, comando, tipo, target, ejemplo }`:
- `tipo`: `EJECUTAR` (shell directo, sin cuota IA) o `AGY` (prompt a la IA del PC).
- `comando`: plantilla; `{{args}}` se sustituye por los argumentos al invocarla.
- `target`: `PC1`, `PC2` o `ANY`.

**API del IDE** (todas con contraseña `x-agyide-pwd`):
| Ruta | Qué hace |
|------|----------|
| `GET /api/skills` | Listar el catálogo |
| `POST /api/skills` | Instalar/actualizar: `{name, descripcion, comando, tipo?, target?, ejemplo?}` |
| `DELETE /api/skills/:name` | Desinstalar |
| `POST /api/skills/:name/run` | Usarla: `{args?, target?}` → ejecuta vía puente y devuelve el resultado |

**Telegram** (@Codearquitect_bot, solo Lead Architect): `/skills` lista el catálogo; `/skill <nombre> [args]` la ejecuta.

Ejemplo verificado (2026-08-16): skill `disco-pc2` (`df -h {{args}}` en PC2) instalada por API y ejecutada en ~4s devolviendo la tabla real del disco.
Idea de uso: empaquetar recetas del OKF bundle o de `docs/RECETAS_PRIMER_PLANO.md` como skills para que cualquier flujo (goal, chat, Telegram) las reutilice.

### 4.2 Yarbis — enviar una instrucción a PC1
Yarbis no ejecuta órdenes directas ni accede a archivos internos de PC1. Para escribir hacia PC1 usa exclusivamente esta cadena:

**Yarbis → propuesta visible → confirmación del Comandante → Buzón oficial de Railway → Cartero → PC1**

Pasos desde AGY IDE:
1. Pulsar **`◉ MODO YARBIS`**.
2. Pulsar **`CONECTAR LIVE`**.
3. Usar **`ACTIVAR MICRÓFONO`** o el campo de texto.
4. Decir o escribir: **“Yarbis, envía a PC1 la instrucción: …”**.
5. Revisar la propuesta completa. Todavía no está ejecutada.
6. Pulsar **`CONFIRMAR BUZÓN`**. Si el texto no es exacto, pulsar **`CANCELAR`**.
7. Cartero recoge la misión y PC1 devuelve el resultado por el mismo canal.

Para consultar sin escribir, Yarbis usa `consultar_buzon_pc1`:
- **Salida:** misiones pendientes o en proceso hacia PC1/PC2.
- **Entrada:** resultados completados devueltos por Cartero.
- Es una herramienta de **solo lectura** mediada por Railway; no equivale a acceso directo a PC1.

#### Contrato HTTP de Buzón/Yarbis

Base productiva: `https://agy-ide-production.up.railway.app`. Estas rutas no viven en el dominio del puente `workspaceapi-server-production-0f24.up.railway.app`.

| Método y ruta | Auth | Qué hace |
|---|---|---|
| `POST /api/ops/mailbox/session` | contraseña validada; crea cookie HTTP-only | Abre una sesión de Buzón. |
| `POST /api/ops/mailbox/list` | sesión de Buzón vigente | Lista objetivos visibles. |
| `POST /api/ops/mailbox/clean-completed` | sesión vigente + mismo origen | Limpia objetivos completados. |
| `POST /api/ops/mailbox/voice/command` | sesión de voz autorizada | Interpreta la orden y devuelve una propuesta; todavía no envía. |
| `POST /api/ops/mailbox/voice/status` | sesión de voz autorizada | Consulta las misiones que Yarbis está siguiendo. |
| `POST /api/ops/mailbox/voice/confirm` | sesión de voz autorizada | Confirma explícitamente y crea/envía la misión propuesta. |

El seguimiento consulta cada **15 segundos** y procesa hasta **10 misiones por lote**. Los estados visibles son `PENDIENTE`, `EN_PROCESO`, `COMPLETADA` y `ERROR`. El ACK inicial solo confirma creación: Yarbis debe seguir hasta `COMPLETADA` o `ERROR`.

`POST /api/send` conserva una defensa para clientes antiguos: si detecta intención de Buzón, impide que el dictado termine como chat general.

### 4.3 Continuidad PC1 — Yarbis v19

`SINCRONIZADO` significa que Railway descargó, validó e inyectó el contexto. No significa que PC1 demostró tenerlo.

`PC1 VERIFICADO` exige simultáneamente:

1. SHA-256 completo de 64 caracteres reportado explícitamente por PC1.
2. Evidencia vigente.
3. Coincidencia exacta con el SHA-256 completo esperado.

La pantalla abrevia el sello como `primeros4…últimos4`. La voz pronuncia únicamente los últimos cuatro caracteres. El código corto es solo una ayuda humana: la comparación interna siempre usa los 64 caracteres.

`GET /api/antigravity/heartbeat` confirma presencia reciente de PC1/PC2, no continuidad criptográfica. Estar online, reportar un número aislado o repetir los cuatro caracteres finales no permite marcar PC1 como verificado.

Al revisar este manual, el listener Windows servido por `GET /api/ag/w` no contiene `continuity_hash` ni `pc1_continuity`. Por tanto, Yarbis puede mostrar o pronunciar su propio sello de contexto y permanecer correctamente en `NO VERIFICADO`.

Estas rutas se comprobaron contra producción y responden 404; son **NO ACTIVAS**:

- `POST /api/pc/heartbeat`
- `POST /api/sync/pc1`
- `POST /api/pc/status`

No deben usarse ni presentarse como productivas hasta que exista una implementación publicada y verificada.

### 4.4 API de AGY IDE

Base productiva: `https://agy-ide-production.up.railway.app`.

Salvo las rutas públicas de salud, callbacks internos y webhooks con su propia clave, la API del IDE usa sesión obtenida con `POST /api/auth` o `x-agyide-pwd` donde lo exige `requirePwd`. Nunca incluir el valor en documentos, URLs o ejemplos.

| Grupo | Métodos y rutas activas |
|---|---|
| Identidad y contexto | `POST /api/auth`; `GET /api/alma`; `GET /api/manual`; `GET /api/heartbeat` |
| Sincronización matutina | `POST /api/morning/sync`; `GET /api/morning/status`; `GET /api/morning/pending-missions` |
| Conversación y puente | `POST /api/send`; `POST /api/pc-command`; `GET /api/status/:id`; `GET /api/recent`; `POST /api/bridge/event` |
| Equipos | `GET /api/equipos`; `POST /api/equipos/report`; `POST /api/equipos/pause`; `GET /api/equipos/screens`; `GET /api/equipos/screens/:pc/shot` |
| Objetivos | `POST /api/goal`; `GET /api/goal/status/:id`; `POST /api/goal/cancel`; `POST /api/goal/confirm-destructive`; `POST /api/goal/:id/approve`; `POST /api/goal/:id/reject`; `GET /api/revert-pending` |
| Película | `POST /api/pelicula/start`; `POST /api/pelicula/stop`; `POST /api/pelicula/clear`; `GET /api/pelicula/status`; `GET /api/pelicula/list`; `GET /api/pelicula/shot`; `GET /api/pelicula/diag` |
| Skills | `GET /api/skills`; `POST /api/skills`; `POST /api/skills/:name/run`; `DELETE /api/skills/:name` |
| Reglas del show | `GET /api/show-rules`; `POST /api/show-rules`; `DELETE /api/show-rules/:name` |
| Chats, archivos y memoria | `GET/POST /api/chats`; `DELETE /api/chats/:id`; `GET/POST /api/files`; `DELETE /api/files/:filename`; `GET /api/memory/search`; `GET /api/memory/migrate`; `POST /api/memory/backfill` |
| IDE y objetivos externos | `POST /api/ide/chat`; `POST /api/ide/file`; `POST /api/webhook/objetivo`; `POST /api/report-diff` |
| Telegram | `POST /api/telegram-webhook`, solo registrado cuando está configurado su secreto de webhook |

### 4.5 Comandos Telegram exactos

**Codearquitect / AGY:**

- `/pc1 <comando>` y `/pc2 <comando>`: orden shell directa.
- `MISIONES PC1 <objetivo>` y `MISIONES PC2 <objetivo>`: orden en modo AGY.
- `/goal [target=PC1|PC2|ANY] [max=N] <objetivo>`.
- `/goal status <id>` y `/goal cancel <id>`.
- `/confirmar_destructivo <session_id:paso> [skip]`.
- `/skills` y `/skill <nombre> [argumentos]`.
- `/reglas`, `/regla <nombre> <texto>` y `/borrar-regla <nombre>`.
- `/ayuda`, `/help` y `/start`.

El modo webhook requiere secreto y chat autorizado. Webhook y long polling son mutuamente excluyentes para evitar respuestas duplicadas.

**Tahamza memoria:** en este motor está apagado salvo activación explícita. Si se activa, reconoce `/buscar <tema>`, `/q <tema>`, “qué sabemos de…”, `/migrate`, `/ayuda`, `/help` y `/start`. La app aparte de Tahamza sigue siendo la dueña normal de ese bot.

**Telegram opcional de PC2:** es un canal local separado y no debe confundirse con Codearquitect, Tahamza ni el puente productivo. Sus credenciales se introducen directamente en PC2, nunca por chat ni por el puente.

---

## 5. SISTEMA DE RIESGO (protección anti-desastre)
El puente puntúa cada comando antes de mandarlo:
- **ALTO (85)** — bloqueado salvo confirmación: `rm -rf`, `del /f`, `format`, `shutdown`, `mkfs`, `dd if=`, `fdisk`, `drop table`, fork bomb, `reg delete`, etc.
- **MEDIO (55)** — pide confirmación: instalar paquetes, mover/copiar/renombrar, matar procesos, `chmod`, servicios, descargas, tareas programadas, `/goal`.
- **BAJO (10)** — pasa directo: leer, estado, diagnóstico.

Si riesgo ≥40 el puente responde `requiresConfirmation:true`. Para ejecutar hay que reenviar con `confirmed:true`. Las misiones autónomas `/goal` usan un `dispatch_token` secreto del servidor (nunca va al navegador) para no tener que confirmar paso a paso.

---

## 6. CÓMO CONTROLAR PC2 DESDE AFUERA (método que funciona hoy)
SSH directo de Replit a PC2 da timeout. Método probado:
1. `POST https://workspaceapi-server-production-0f24.up.railway.app/api/antigravity/send`
   con header `x-antigravity-key` y cuerpo `{"instruction":"[PC2] EJECUTAR <comando>","target":"PC2","confirmed":true}`
2. Sondear `GET /api/antigravity/status/<id>` cada 4s, también con `x-antigravity-key`.
3. El resultado real llega en `result` (tope ~2000 chars → leer archivos por tramos con `Get-Content -TotalCount`/`-Skip`).

Para PC1 igual, cambiando a `[PC1]`. **Ruta oficial única de PC1: `C:\Users\Roberto1\OneDrive\Desktop`** (PROHIBIDO usar rutas con "Documentos").

### 6.1 Orquestador seguro de pendientes en PC2
- Servicio de usuario: `orquestador-pendientes-pc2.service`.
- Escucha en el puerto `8090` y está habilitado con `Linger=yes`.
- Directorio operativo: `/home/roberto/PENDIENTES/`.
- Conserva siempre el pendiente original: no borra ni mueve automáticamente.
- Las escrituras exigen `X-SGN-Key`; la clave vive solamente en `.config/sgn/orquestador-pendientes.env`, con permiso `600`.
- Rechaza nombres inseguros, traversal, enlaces simbólicos, sobrescrituras y cuerpos mayores de 512 KiB.
- Telegram es opcional. Al 2026-08-28 permanece **desactivado**: no hay token ni chat configurados después de cancelar su reactivación. Una credencial nueva debe introducirse directamente en PC2, nunca por chat ni por el puente.

---

## 7. AUTO-ACTUALIZACIÓN DE LOS AYUDANTES (¡importante!)
El listener Windows servido actualmente hace su primer chequeo de versión 60 segundos después de arrancar y luego compara con `GET /api/ag/ver` **cada 5 min**. Si el servidor tiene una versión nueva, descarga el script nuevo a disco. Esto es distinto del sondeo de comandos (~5 s) y del sondeo de misiones (~10 s cuando no hay trabajo).
- **Consecuencia:** cualquier parche hecho a mano en `ag-listener.js` de PC1/PC2 **se pierde**. Los arreglos deben ir al **template dentro del puente** (hoy lo cambia el metagente).
- El template vive en `bridge/antigravity.ts` (rutas `/api/ag/n` y `/api/ag/w`).

---

## 8. TABLAS SUPABASE (el corazón compartido)
- `antigravity_commands` — comandos directos. Columnas: id, instruction, status (pending→processing→done/error), result, chat_id, created_at, updated_at.
- `misiones` — tareas con IA. Columnas: id, instruccion, titulo, asignado_a (PC1/PC2/TODOS), enviado_por, modo, estado, resultado, firma, created_at, updated_at.
- `agent_heartbeats` — última vez visto cada PC. Alerta a Telegram si un PC lleva >10 min sin aparecer. `PC1_alert`/`PC2_alert` evitan alertas duplicadas. **Solo prueba presencia; no contiene ni demuestra continuidad SHA-256.**
- `goal_sessions` — misiones autónomas multi-paso `/goal`. Tiene `dispatch_token` secreto. Protegida con RLS (solo `service_role`).

**Contrato vigente:** Railway y los listeners usan estas mismas tablas compartidas. Cambiar el dominio del puente exige actualizar `APP_URL`/configuración de consumidores y comprobar el listener servido.

---

## 9. VARIABLES DE ENTORNO NECESARIAS (nombres, nunca valores)
Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LEAD_ARCHITECT_CHAT_ID`, `TELEGRAM_COMANDANTE_CHAT_ID`, `TELEGRAM_SUPERGRUPO_CHAT_ID`.
Auth interna: `ANTIGRAVITY_KEY` (listener → header `x-antigravity-key`; valor en el secret de Railway, nunca en texto claro), `SENTINEL_API_KEY`, `LEAD_ARCHITECT_AUTH_PHRASE`, `MISSION_SIGNING_KEY`.
Servidor: `APP_URL` (URL pública del puente — el listener la usa para todo), `PORT`.
Opcionales: `OPENAI_API_KEY` (demos), `SESSION_SECRET`.
Si cambia Railway: cambiar `APP_URL`/variable `A` del listener a la URL nueva (o soportar `AG_BACKEND_URL`) y sincronizar todos los consumidores.

---
## 10. DESPLIEGUE DEL PUENTE
1. Railway es el primario obligatorio y 24/7 para Buzón → PC1.
2. Replit es el entorno de desarrollo.
3. Los cambios de este canal deben sincronizarse al repositorio/servicio Railway y verificarse allí; no dependen de publicar manualmente Replit.
4. Los consumidores deben apuntar al dominio Railway y a las mismas tablas Supabase.

---

## 11. FAILOVER Y CONTROL REMOTO
- Si Replit cae, Railway (`workspaceapi-server-production-0f24.up.railway.app`) mantiene el contrato productivo de Buzón.
- Existe además control de PC2 por `ssh` Tailscale + sesión **tmux "compartida"** (según Master Prompt).
- PC2 tiene IP local y dirección Tailscale conocidas por Roberto; consultarle directamente para SSH de emergencia.

---

## 12. BACKUP AUTOMÁTICO DE LA MEMORIA TAHAMZA

### Qué se respalda
Las 5 tablas de Supabase 2 (`lxlcivzuevowckbcxczc`):
`chats` · `messages` · `files` · `memory_index` · `cibercode_chats`

### Dónde y cuándo
- **Cada día a las 02:00 UTC** el servidor AGY exporta todas las filas a JSON.
- Los archivos se guardan en el workspace de Replit: `backups/tahamza/YYYY-MM-DD/`
  (un archivo `.json` por tabla + `_meta.json` con resumen de filas y errores).
- Se conservan los **últimos 7 días**; las copias más antiguas se borran solas.

### Aviso de fallo
Si alguna tabla falla, el bot Tahamza (o Codearquitect) envía un mensaje de Telegram al Lead Architect con el detalle del error.

### API para uso manual
| Método | Ruta | Auth | Qué hace |
|--------|------|------|----------|
| `GET` | `/api/backup/tahamza` | ninguna | Estado del último backup (fecha, resultado, tablas, error) |
| `POST` | `/api/backup/tahamza/run` | `x-agyide-pwd` | Dispara un backup manual en background |

Ejemplo:
```bash
# Ver estado
curl "$AGY_IDE_URL/api/backup/tahamza"

# Forzar backup
curl -X POST "$AGY_IDE_URL/api/backup/tahamza/run" \
  -H "x-agyide-pwd: TU_CONTRASEÑA"
```

### Cómo restaurar
1. **Localizar la copia**: en Replit → carpeta `backups/tahamza/YYYY-MM-DD/`.
2. **Abrir el JSON** de la tabla que se quiere restaurar (p. ej. `memory_index.json`).
3. **Insertar las filas** en Supabase con el editor SQL o vía REST:
   ```sql
   -- Ejemplo en Supabase SQL Editor
   INSERT INTO memory_index (id, content, created_at, ...)
   SELECT * FROM json_populate_recordset(NULL::memory_index, '[ ...JSON... ]');
   ```
   O con upsert para no duplicar filas que ya existen:
   ```sql
   INSERT INTO memory_index SELECT * FROM json_populate_recordset(...)
   ON CONFLICT (id) DO NOTHING;
   ```
4. **Verificar**: `SELECT count(*) FROM memory_index;` debe coincidir con el número en `_meta.json`.
5. Si la tabla estaba corrupta, borrarla primero con `TRUNCATE memory_index;` antes del INSERT.

> **Nota de seguridad**: los archivos JSON contienen toda la memoria del ecosistema. No exponerlos públicamente ni subirlos a repos públicos.

---

## 13. RECETA DEL SHOW TEATRAL EN PC1 (orden oficial del Comandante — NO cambiar sin su permiso)

Cuando una misión de objetivo (bot → Make → motor /goal) se aprueba con ✅, PC1 ejecuta SIEMPRE este show, en este orden exacto:

1. **Apertura**: pitidos de arranque → voz "Comandante, suelte el mouse y el teclado. La función comienza en diez segundos" → espera de 10 segundos.
2. **Plan completo en Notepad**: se abre el Bloc de notas y se escribe el plan entero — el objetivo y cada tarea diciendo CON QUÉ HERRAMIENTA se hace y CÓMO. Ahí termina la fase de presentación.
3. **Por cada tarea**: se abre Notepad y se anuncia "VOY A EMPEZAR LA TAREA X de Y" con su herramienta y su cómo (voz + escritura) → se ejecuta la tarea (si necesita ventana, la abre ella misma).
4. **Vista del AGY IDE**: tras ejecutar, se abre el IDE en el navegador, muestra PC1 durante 12 segundos, baja para mostrar PC2 otros 12 segundos y cierra la pestaña.
5. **Reporte en Notepad**: FINALIZADA CORRECTAMENTE, o NO SE PUDO + razón + intentos (máx 3 con auto-reparador). Luego pasa a la siguiente tarea hasta terminar.

Reglas de oro del show:
- JAMÁS escribir con SendKeys sin antes abrir y enfocar una ventana PROPIA (nunca sobre ventanas del usuario).
- SHOW VISIBLE: si la tarea abre una página o investiga algo, el navegador se abre VISIBLE, al frente, mínimo 12 segundos, para que el Comandante VEA el trabajo (nada de trabajo web oculto).
- La ventana del AGY IDE no se cierra entre tareas: se reutiliza (PC1 12 s → PC2 12 s).
- Si la misión se cancela a mitad, la cámara (INICIAR_SCREEN) se apaga sola (limpieza automática).
- Cierre típico de rodaje: DETENER_SCREEN → MONTAR_PELICULA → video MP4 en la carpeta Videos de PC1 → aviso por Telegram.

## 14. PLANTILLA SGN_EVENT PARA EL BOT DE OBJETIVOS (EXACTA — no quitar campos)

El bot @Objetivodtaha_bot → Make exige TODOS los campos (los de calendario incluidos); si falta uno, Make devuelve todo vacío y el objetivo no llega. OJO: la palabra OBJETIVO debe ir SIEMPRE (TIPO=OBJETIVO y el campo OBJETIVO= con texto) porque los filtros de Make enrutan por ella. Para un objetivo nuevo se cambian SOLO: ID_EVENTO, TASK_ID, TASK_ID_ASOCIADOS, OBJETIVO, RESUMEN, ENTREGABLE, TEXT y las fechas. Lo demás se deja igual.

```
[SGN_EVENT]
ID_EVENTO=SGN_OBJ_YYYYMMDD_NOMBRE_NN
TASK_ID=SGN_OBJ_YYYYMMDD_NOMBRE_NN
TIPO=OBJETIVO
ORIGEN=HUMANO
PRIORIDAD=MEDIA
ACCION_SOLICITADA=SI
RUTA_OBJETIVO=planner
ESTADO=ACTIVO
AGENT_NAME=PC1
OBJETIVO=(texto del objetivo)
RESUMEN=(resumen corto)
ENTREGABLE=
- (lista de entregables)
TEXT=(resumen + "Task_ID: SGN_OBJ_YYYYMMDD_NOMBRE_NN")
CATEGORY=OPERATIVO
SECURITY_LEVEL=INTERNAL
TASK_ID_ASOCIADOS=SGN_OBJ_YYYYMMDD_NOMBRE_NN
START_AT=YYYY-MM-DDT08:00:00-05:00
END_AT=YYYY-MM-DDT23:59:59-05:00
TIMESTAMP=YYYY-MM-DDT08:30:00-05:00
CALENDARIZABLE=false
HAS_BLOCKER=false
FECHA_PROGRAMADA=YYYY-MM-DD
ESTADO_ENVIO=PENDIENTE
FECHA_ENVIO=
[/SGN_EVENT]
```

## 15. PRINCIPIOS DEL ARQUITECTO (del SGN Master Prompt)
- NUNCA cambiar nada sin aprobación explícita del Arquitecto (Roberto).
- Pre-avisar (zenity/sonido) antes de automatizar teclado/ratón.
- Explicar "en humano", sin jerga.
- Marco ético con el Sagrado Corán como norte y tono de soberanía tecnológica.
