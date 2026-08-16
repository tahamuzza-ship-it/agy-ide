# MANUAL MAESTRO DEL ECOSISTEMA SGN / TAHASISTEM PRO
_Fuente única de verdad. Este mismo archivo se sube a: memoria del agente, Master Prompt de PC1, PC1, PC2, y a AGY para que lo lea en cada chat._

Última revisión: 2026-08-14

---

## 0. RESUMEN EN UNA FRASE
Roberto (o Camilo) dan una orden por **Telegram** o por el **Dashboard** → el **Puente** la guarda en **Supabase** → los **ayudantes (listeners)** de **PC1 (Windows)** y **PC2 (Linux)** la recogen cada pocos segundos, la ejecutan y devuelven el resultado → llega aviso por **Telegram** y se ve en el **Dashboard**.

---

## 1. LAS TRES APLICACIONES
1. **AGY IDE** — el editor con IA.
   - Repo GitHub: `tahamuzza-ship-it/agy-ide` → Railway: `agy-ide-production.up.railway.app`
   - Copia local en este proyecto Replit: frontend `artifacts/agycibercode/index.html`, backend `artifacts/api-server/src/agy/legacy.cjs`
   - Espejo completo: repo `AgCyberCode-Manager`
2. **CIBERCODE** — el otro IDE.
   - Repo: `cibercode-ide` → Railway: `cibercode-ide-production.up.railway.app`
3. **Puente "MetaAgente SGN"** — el cartero que conecta todo.
   - Hoy: `automate-make.replit.app` (mantenido por el "metagente")
   - Código fuente entregado en repo: `tahamuzza-ship-it/agy-bridge`
   - **Plan:** mudarlo al servidor AGY en Railway, apuntando a las MISMAS tablas de Supabase.

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

### 3.1 Comandos directos a los PC — tabla `antigravity_commands`
| Método y ruta | Auth | Qué hace |
|---------------|------|----------|
| `POST /api/antigravity/send` | ninguna* | Encola un comando. Acepta `{instruction, target:"PC1"/"PC2", confirmed, goal_session_id, dispatch_token}`. Quita doble prefijo `[PC1]`. |
| `POST /api/antigravity/send-architect` | header `x-lead-architect-key` | Igual pero privado del Lead Architect (apps externas). |
| `GET /api/antigravity/pending?pc=PC1` | header `x-antigravity-key` | El listener pide su comando. Filtra por prefijo `[PC1]`/`[PC2]`. Marca `processing`. |
| `POST /api/antigravity/result/:id` | header `x-antigravity-key` | El listener devuelve el resultado real. |
| `GET /api/antigravity/status/:id` | ninguna | Consultar si ya se ejecutó. Resultado en `result` (tope ~2000 chars). |
| `GET /api/antigravity/queue` · `recent` | ninguna | Cola activa / historial para el Dashboard. |
| `POST /api/antigravity/clear-queue` · `cancel/:id` | ninguna | Limpiar/cancelar. |
| `GET/POST /api/antigravity/screen` | key en POST | Captura de pantalla de PC2 (in-memory, JPEG). |
| `GET /api/antigravity/heartbeat` | ninguna | Estado online/offline de PC1 y PC2 (online si <90s). |

\* `send` no pide clave, pero si el comando es de riesgo ≥40 exige `confirmed:true` (ver sección 5).

### 3.2 Misiones con IA — tabla `misiones` (Centro de Operaciones)
| Método y ruta | Qué hace |
|---------------|----------|
| `POST /api/misiones` | Crea misión. `modo:"agyp"` = lenguaje natural que ejecuta AGY. `[PLAN_SOLO]` = solo plan sin ejecutar. Valida chat_id (solo LA o Comandante). Firma HMAC. |
| `GET /api/misiones/pending?agente=PC1` | El listener recoge su misión. **Claim atómico**: solo una máquina la toma. |
| `PATCH /api/misiones/:id` | El listener actualiza estado/resultado. Al terminar en PC2 avisa por Telegram. |
| `GET/POST /api/misiones/:id · cancel · cancel-pending · reset-stuck` | Consultar/cancelar/liberar atascadas. |
| Auto-reset | Cada 5 min libera misiones `en_proceso` con más de 30 min a `pendiente`. |

### 3.3 Descarga de listeners (auto-update)
| Ruta | Da |
|------|-----|
| `GET /api/ag/ver` | Versión actual del listener (hoy `v7-stable`). |
| `GET /api/ag/n` | Listener Node.js para **PC2 Linux**. |
| `GET /api/ag/w` | Listener Node.js para **PC1 Windows**. |
| `GET /api/ag/p` | Listener Python alterno para PC2. |
| `GET /api/ag/s` | Script de captura de pantalla PC2. |
| `GET /api/ag/t1` | Terminal web PC1 (puerto 7681). |
| `GET /api/ag/watchdog` | watchdog.ps1 que reinicia el listener de PC1 si se cae. |

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
| `AGY_VER` / `AGY_START` / `AGY_STOP` | Estado/último output de AGY | ✅ | ✅ |
| `INICIAR_SCREEN` / `DETENER_SCREEN` | Capturas de pantalla cada 3s | — | ✅ |
| comandos "seguros" (echo, dir, whoami, df, uptime...) | En PC1 se ejecutan directo sin IA | ✅ | — |

**Regla de oro de costo:** para tareas mecánicas usa `EJECUTAR` (no gasta cuota de IA). Reserva `AGY <prompt>` solo cuando de verdad necesitas que la IA piense.

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
1. `POST https://automate-make.replit.app/api/antigravity/send`
   con `{"instruction":"[PC2] EJECUTAR <comando>","target":"PC2","confirmed":true}`
2. Sondear `GET /api/antigravity/status/<id>` cada 4s.
3. El resultado real llega en `result` (tope ~2000 chars → leer archivos por tramos con `Get-Content -TotalCount`/`-Skip`).

Para PC1 igual, cambiando a `[PC1]`. **Ruta oficial única de PC1: `C:\Users\Roberto1\OneDrive\Desktop`** (PROHIBIDO usar rutas con "Documentos").

---

## 7. AUTO-ACTUALIZACIÓN DE LOS AYUDANTES (¡importante!)
Cada listener compara su versión con `GET /api/ag/ver` **cada 5 min**. Si el servidor tiene una versión nueva, descarga el script nuevo a disco.
- **Consecuencia:** cualquier parche hecho a mano en `ag-listener.js` de PC1/PC2 **se pierde**. Los arreglos deben ir al **template dentro del puente** (hoy lo cambia el metagente).
- El template vive en `bridge/antigravity.ts` (rutas `/api/ag/n` y `/api/ag/w`).

---

## 8. TABLAS SUPABASE (el corazón compartido)
- `antigravity_commands` — comandos directos. Columnas: id, instruction, status (pending→processing→done/error), result, chat_id, created_at, updated_at.
- `misiones` — tareas con IA. Columnas: id, instruccion, titulo, asignado_a (PC1/PC2/TODOS), enviado_por, modo, estado, resultado, firma, created_at, updated_at.
- `agent_heartbeats` — última vez visto cada PC. Alerta a Telegram si un PC lleva >10 min sin aparecer. `PC1_alert`/`PC2_alert` evitan alertas duplicadas.
- `goal_sessions` — misiones autónomas multi-paso `/goal`. Tiene `dispatch_token` secreto. Protegida con RLS (solo `service_role`).

**Clave de la mudanza:** el puente nuevo usará estas MISMAS tablas → los PC no se enteran del cambio hasta que se les apunta la URL nueva. Cero downtime.

---

## 9. VARIABLES DE ENTORNO NECESARIAS (nombres, nunca valores)
Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.
Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LEAD_ARCHITECT_CHAT_ID`, `TELEGRAM_COMANDANTE_CHAT_ID`, `TELEGRAM_SUPERGRUPO_CHAT_ID`.
Auth interna: `ANTIGRAVITY_KEY` (listener → header `x-antigravity-key`; el listener trae fija `<ANTIGRAVITY_KEY>`), `SENTINEL_API_KEY`, `LEAD_ARCHITECT_AUTH_PHRASE`, `MISSION_SIGNING_KEY`.
Servidor: `APP_URL` (URL pública del puente — el listener la usa para todo), `PORT`.
Opcionales: `OPENAI_API_KEY` (demos), `SESSION_SECRET`.
Para la mudanza: cambiar `APP_URL`/variable `A` del listener a la URL nueva (o soportar `AG_BACKEND_URL`).

---

## 10. PLAN DE MUDANZA DEL PUENTE (por fases, sin apagar nada)
1. Montar el motor del puente en el servidor AGY (Railway), apuntando a las mismas tablas Supabase.
2. Dashboard nuevo y claro, integrado con el panel MIS EQUIPOS.
3. Probar en paralelo con el puente viejo (ambos leen las mismas tablas).
4. Apuntar los listeners a la casa nueva (`APP_URL`) y solo entonces apagar lo viejo.

---

## 11. FAILOVER Y CONTROL REMOTO
- Si Replit cae, Railway (`workspaceapi-server-production-0f24.up.railway.app`) puede tomar el webhook de Telegram.
- Existe además control de PC2 por `ssh` Tailscale + sesión **tmux "compartida"** (según Master Prompt).
- PC2 tiene IP local y dirección Tailscale conocidas por Roberto; consultarle directamente para SSH de emergencia.

---

## 13. BACKUP AUTOMÁTICO DE LA MEMORIA TAHAMZA

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
curl https://automate-make.replit.app/api/backup/tahamza

# Forzar backup
curl -X POST https://automate-make.replit.app/api/backup/tahamza/run \
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

## 12. PRINCIPIOS DEL ARQUITECTO (del SGN Master Prompt)
- NUNCA cambiar nada sin aprobación explícita del Arquitecto (Roberto).
- Pre-avisar (zenity/sonido) antes de automatizar teclado/ratón.
- Explicar "en humano", sin jerga.
- Marco ético con el Sagrado Corán como norte y tono de soberanía tecnológica.
