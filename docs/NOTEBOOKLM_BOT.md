# NotebookLM Bot independiente

`main.py` es un servicio independiente: no modifica los archivos del bot Node
ni sus workflows. Usa el mismo perfil local de NotebookLM que el comando
`notebooklm`, no una Google API key.

## Instalación y autenticación

```bash
python -m pip install -r requirements.txt
notebooklm login
```

La primera autenticación abre el navegador de Google y puede descargar Chromium.
Hazla en el equipo que ejecutará este servicio. No copies cookies ni contraseñas
en el chat: el perfil de NotebookLM debe permanecer privado en ese equipo.

Se ha validado `notebooklm-py==0.8.2`. Los comandos importantes son:

```text
notebooklm list --json
notebooklm create TITLE --json
notebooklm source add URL -n NOTEBOOK_ID --type url --json
notebooklm source add FILE -n NOTEBOOK_ID --type file --json
notebooklm source list -n NOTEBOOK_ID --json
notebooklm summary -n NOTEBOOK_ID --json
notebooklm ask QUESTION -n NOTEBOOK_ID --json
notebooklm generate audio -n NOTEBOOK_ID --wait --json
notebooklm download audio -n NOTEBOOK_ID --artifact ARTIFACT_ID OUTPUT.m4a
```

Cada operación que depende de un cuaderno lleva `-n NOTEBOOK_ID`; no se usa el
contexto global de CLI. El podcast se convierte realmente de M4A a MP3 con
`imageio-ffmpeg`, y no se cambia únicamente la extensión.
El botón Reporte usa `notebooklm summary` y entrega el texto y un archivo Markdown.

## Variables

Para iniciar el servicio en modo API (`python main.py --api-only`) son
obligatorias:

* `HUB_ENDPOINT_URL` (HTTPS público, sin redirecciones)
* `CONEXION_NOTEBOOK_PUENTE`: clave privada nueva que elige el usuario; no es un token de Telegram.
* `NOTEBOOKLM_REGISTRY_URL` (solo en el `hub-env.json` privado de PC2,
  opcional): URL HTTPS del registro AGY. Si se omite usa
  `https://agy-ide-production.up.railway.app/api/notebooklm/endpoint`.
* PC1 usa un registro independiente en
  `/api/notebooklm/pc1-endpoint`: `NOTEBOOKLM_PC1_REGISTRY_TOKEN` autentica
  únicamente la publicación del túnel y `NOTEBOOKLM_PC1_TOKEN` autentica las
  llamadas AGY al Hub. `NOTEBOOKLM_PC1_URL` solo es un respaldo estático
  explícito si no hay un registro PC1 válido; nunca se comparte con PC2.

`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHANNEL_ID` no son necesarios en modo API.
Para permitir noticias desde ese modo, configura opcionalmente
`NOTEBOOKLM_PUBLISHER_URL` con el **origen** HTTPS público de CiberCode/Railway
(sin ruta, credenciales, query ni fragment). Python llama al callback
autenticado con `CONEXION_NOTEBOOK_PUENTE`, pero nunca recibe un token de
Telegram. Si no se configura, aún se pueden crear vistas previas de noticias,
pero la publicación confirmada falla explícitamente sin reclamar ni enviar el
borrador; las demás funciones siguen disponibles.

El nombre anterior `SGN_SECRET_TOKEN` sigue aceptándose por compatibilidad,
pero las nuevas configuraciones deben usar `CONEXION_NOTEBOOK_PUENTE`.

`TELEGRAM_ALLOWED_USER_IDS` es opcional (IDs separados por comas). Sin esa
lista, el bot solo permite chats privados cuyo usuario sea
`administrator`/`creator` del canal configurado. Nunca se permite un grupo.

## Arranque

### Modo elegido: Notebook LM dentro de Code Arquitect

El equipo elegido para ejecutar el Hub es **PC2**. La instalación aislada vive en
`~/notebooklm-hub`: sus paquetes no sustituyen los de otras aplicaciones.
`tools/install_notebooklm_pc2.py` prepara dependencias y Cloudflare Tunnel,
verificando la descarga con SHA-256. No arranca el servicio ni inicia polling.
La cuenta de Google permanece en el perfil existente de NotebookLM en PC2.

El lanzador `run-hub.py` espera un archivo privado `hub-env.json` en esa carpeta
y escucha solo en `127.0.0.1:8086`; el túnel se conecta a ese puerto.
No enviar claves en texto ni en base64 por la cola de comandos del puente:
la configuración privada debe introducirse localmente o transferirse cifrada.

El webhook existente de **Code Arquitect** sigue en CiberCode/Railway y conserva
las misiones de PC3. Su botón **Notebook LM** y `/panel` usan esta API como Hub.
Para esta integración, ejecuta Python **solo con `--api-only`**: no crea un
bot, no inicia un segundo polling ni borra el webhook actual. En este modo la
publicación de noticias se habilita únicamente mediante
`NOTEBOOKLM_PUBLISHER_URL` hacia el callback Railway, sin activar polling. El
modo bot independiente es exclusivamente para otro bot sin webhook activo; no
se debe usar con el token de Code Arquitect.

Configura `HUB_ENDPOINT_URL` y la misma `CONEXION_NOTEBOOK_PUENTE` en Python, AGY IDE
y el servicio CiberCode que atiende a Code Arquitect. La sesión Google se inicia
en el equipo del Hub. La publicación se hace solo por el callback Railway al
canal fijo autorizado; los tokens de los distintos bots del workspace no son
intercambiables.

La botonera y la ayuda se pueden abrir sin Hub configurado. La ingesta,
investigación y generación real requieren la conexión y la sesión Google.
Los resultados se devuelven únicamente al chat que los pidió. La selección
de cuaderno de cada chat y la del IDE son independientes, pero pueden elegir
el mismo cuaderno de la cuenta Google.

```bash
python main.py --api-only      # API para Code Arquitect; no requiere Telegram
python main.py                 # bot independiente; requiere token y canal
```

No se borra el webhook existente automáticamente. Si otro despliegue tiene el
webhook activo, hay que resolverlo explícitamente en Telegram antes de usar
polling.

## Panel y flujo

`/start` solo es una compatibilidad opcional: abre el panel automáticamente.
La guía principal es elegir cuaderno → añadir fuentes → generar. Cada botón
explica el dato requerido y el resultado:

* **➕ Añadir Fuente**: URL web/YouTube o PDF de hasta 4 MB.
* **🚀 Iniciar Investigación**: **🎙 Podcast** o **📑 Reporte**.
* **📊 Ver Fuentes**, **📂 Cuadernos**, **➕ Crear cuaderno** y selección segura.
* **📰 Publicar noticia**: en el modo API se crea primero un borrador usando
  exclusivamente las fuentes ya presentes en el cuaderno; la publicación es un
  paso separado y confirmado. El bot independiente no ofrece el antiguo flujo
  de URL para que no exista un atajo de publicación.
* **🗣 Preguntar por voz**: respuesta del cuaderno y MP3 neural en español.
* **🌐 Estado de nodos**, **❓ Ayuda**, **⬅ Volver** y **Cancelar**.

Las entradas pendientes se guardan por chat durante la sesión. Cancelar
siempre elimina el estado pendiente.

## API para AGY/UI

Todas las rutas requieren `X-SGN-Token` exactamente igual a
`CONEXION_NOTEBOOK_PUENTE` (comparación resistente al tiempo). Opcionalmente
`X-SGN-Actor` separa los cuadernos persistidos de la UI; tener un token válido
es lo que autoriza la petición.

Code Arquitect usa el actor `codearquitect:<chat_id>`; AGY utiliza `ide`.
Las consultas de trabajos y sus descargas comprueban también este actor:
un chat no puede leer resultados de otro chat ni del IDE.

Implementadas:

* `GET /api/notebooklm/status` →
  `{configured, authenticated, message}`
* `GET /api/notebooklm/notebooks` →
  `{notebooks:[{id,title}],activeNotebookId}`
* `POST /api/notebooklm/notebooks` `{title}`
* `PUT /api/notebooklm/active` `{notebookId}`
* `GET /api/notebooklm/sources?notebookId=`
* `GET /api/notebooklm/nodes` →
  `{online,status,message,url?}`
* `POST /api/notebooklm/jobs` con `action` en
  `source_url|source_pdf|podcast|report|voice|news_draft|news_publish`;
  devuelve `202` con `{id,status:"queued"}`.
* `GET /api/notebooklm/jobs/:id`
* `GET /api/notebooklm/files/:id`

El estado de autenticación usa el contrato real de `notebooklm-py==0.8.2`:
ejecuta `notebooklm auth check --test --json` y considera autenticada la sesión
solo cuando la respuesta tiene `status: "ok"`. No se devuelven cookies, correos
ni el diagnóstico crudo de la CLI.

Los trabajos tienen como máximo dos ejecuciones simultáneas y 32 posiciones de
cola. Las tareas interrumpidas se marcan `failed` al reiniciar. El PDF debe
llevar base64 con firma `%PDF-` y no superar 4 MB decodificados; el body total
está limitado a 8 MB.

### Noticias: vista previa y publicación explícita

No hay una ruta `/news`: se usa la cola existente.

1. `POST /api/notebooklm/jobs` con
   `{"action":"news_draft","notebookId":"..."}` crea una vista previa. No
   requiere `confirmed:true`, no añade URLs/fuentes y no llama al publicador.
   Lee las fuentes existentes del cuaderno; un cuaderno vacío falla de forma
   explícita. Al completarse, el resultado es `{text,draftId,notebookId}`.
2. Muestra `text` al usuario y solo después envía
   `{"action":"news_publish","notebookId":"...","draftId":"...","confirmed":true}`.
   No se aceptan `text` ni `destination` aportados por el cliente. Al
   completarse devuelve `{text,published:true}` con el texto exacto del
   borrador durable.

El resumen le pide a NotebookLM español, datos y contexto y un máximo de
**3500 unidades UTF-16** (Telegram cuenta un emoji fuera del BMP como dos
unidades; `len()` de Python no sirve para este límite). Se comprueba el
resultado y, solo si lo supera, se hace una única petición explícita para
acortarlo. Si aún supera el límite, falla: nunca se corta ni se envía un mensaje
largo.

Los borradores viven 30 minutos en SQLite y pertenecen simultáneamente al actor
y al cuaderno. Antes de enviar, SQLite los reclama de forma atómica y no
repetible. El reclamo se conserva tras reiniciar; un timeout o resultado
incierto nunca se reintenta automáticamente. La acción antigua `news` se
rechaza explícitamente y no puede publicar.

## Callback de publicación Railway

El servicio CiberCode expone `GET /api/notebooklm/publication-status` (solo
lectura) y `POST /api/notebooklm/publish`. Ambos requieren `X-SGN-Token` y
comparan la clave en tiempo constante. La publicación acepta únicamente
`{text, requestId, confirmed:true}`; no acepta destino aportado por el
solicitante. Railway conserva el token del bot y publica solo en
`TELEGRAM_CHANNEL_ID`, que es obligatorio en Railway y puede ser un ID numérico
o un `@username` de canal. Si falta, el estado y la publicación fallan
explícitamente; nunca hay un canal de reserva.

Antes de cada envío verifica con Telegram que la identidad sea exactamente
`Codearquitect_bot`, que el destino sea un canal y que el bot sea `creator` o
tenga `can_post_messages:true`. El estado GET no expone tokens ni otros
secretos. El callback recibe el mismo `draftId` durable como `requestId`: un
duplicado ya confirmado no vuelve a enviar, y un timeout/error de envío queda
incierto y no se reintenta automáticamente ni se redirige a otro canal.

## Cloudflare Tunnel

El supervisor de PC2 se instala como servicio de usuario `notebooklm-hub`.
Ejecuta la API solo en loopback y mantiene las credenciales en un archivo
privado con permisos 0600. El estado público se guarda en
`~/notebooklm-hub/runtime-status.json`.

El supervisor espera la resolución DNS, inicia la API y verifica
`GET /api/notebooklm/status` con `configured:true` y `authenticated:true`
primero en loopback y luego
por HTTPS. Solo después publica el origen en el registro durable de AGY:

```text
POST https://agy-ide-production.up.railway.app/api/notebooklm/endpoint
X-SGN-Token: CONEXION_NOTEBOOK_PUENTE
{"endpoint":"https://<túnel>.trycloudflare.com","generation":<unix-ms>}
```

El registro persiste en el almacenamiento durable de Supabase. `generation` es
un número positivo de milisegundos persistido en
`tunnel-generation.json`; permanece igual durante todos los reintentos de un
túnel y avanza al reiniciar. Una misma pareja `endpoint` + `generation` es
idempotente y una generación anterior recibe `409`. El supervisor conserva el
mismo Hub y túnel durante una caída del registro: usa backoff acotado y vuelve
a registrar cada 60 segundos cuando está sano. `runtime-status.json` distingue
`registered:true` de `state:"registry_retry_failure"` sin incluir el secreto.
No se siguen redirecciones en ninguna comprobación.

Este mecanismo elimina la actualización manual de `HUB_ENDPOINT_URL` en AGY y
Code Arquitect cada vez que PC2 reinicia. El origen HTTPS sigue siendo igual en
los tres entornos; los adaptadores añaden `/api/notebooklm` al llamar a la API.
El registro es solo de transporte: no transfiere cookies, cuentas Google,
contraseñas ni secretos por la cola de comandos.

PC1 conserva el mismo contrato de salud y CAS, pero con otra fila, proyecto y
token. AGY resuelve automáticamente en este orden exacto: PC2, PC1 y cloud.
El registro PC1 solo acepta orígenes HTTPS estrictos de `trycloudflare.com`,
verifica `/api/notebooklm/status` antes de guardar y nunca modifica la fila de
PC2.

Ejemplo conceptual en la máquina que ejecuta Python:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Configura `HUB_ENDPOINT_URL=https://...` con el endpoint HTTPS público real del
hub solo como valor inicial/compatibilidad. En el servicio Node/AGY configura
el mismo `CONEXION_NOTEBOOK_PUENTE`; el proxy debe enviar `X-SGN-Token` a esta
API. No pongas el token en una URL ni en el frontend. La comprobación de nodos
no sigue redirecciones y no expone el token ni la salida cruda de la CLI.

Para instalar o actualizar sin reinstalar dependencias existentes:

```bash
python tools/install_notebooklm_pc2.py --install-service
```

La opción escribe únicamente `~/.config/systemd/user/notebooklm-hub.service`,
hace `daemon-reload`, habilita y arranca esa unidad. Detecta el estado de
`loginctl` (linger) pero no lo modifica ni toca servicios de PC1, PC3 u otras
aplicaciones. La cuenta Google y el `hub-env.json` privado permanecen en PC2.

## Pruebas

Verificación en producción del 17 de septiembre de 2026:

* Ambos repositorios (`agy-ide` y `cibercode-ide`) desplegaron el registro
  persistente y la resolución dinámica en Railway.
* Tras reiniciar únicamente `notebooklm-hub.service`, PC2 publicó una generación
  nueva sin cambiar variables de Railway manualmente. AGY y el transporte con
  actor Code Arquitect devolvieron los mismos 28 cuadernos; la sesión Google
  permaneció autenticada.
* El servicio de usuario está habilitado, con reinicio automático y `Linger=yes`.
  No se reinició PC2 completo ni se modificaron servicios de PC3. La prueba de
  reinicio completo sigue requiriendo autorización.
* Las comprobaciones no crean trabajos ni cuadernos ni inyectan mensajes al
  webhook de Telegram. Validan las consultas reales de la API y la copia del
  adaptador que fue desplegada, no un recorrido manual por la botonera.

Las herramientas de mantenimiento en `tools/` usan solo cabeceras HTTPS para
autenticación. `upgrade_notebooklm_pc2.py` verifica la revisión y SHA-256 de las
fuentes públicas antes de actualizar exclusivamente el supervisor.
`restart_check_notebooklm_pc2.py` separa la solicitud de reinicio (`start_restart`)
de la lectura de resultados (`check`): esperar dentro del comando puede superar
el tiempo límite del puente aunque NotebookLM se recupere correctamente.

```bash
node --test scripts/notebooklm-endpoint.test.cjs scripts/notebooklm-proxy.test.cjs
node --test deploy/railway/cibercode-ide/scripts/notebooklm-telegram.test.cjs
pytest -q tests/test_notebooklm_pc2.py
pytest -q tests/test_notebooklm_bot.py
```

Las pruebas usan una CLI falsa, una base SQLite temporal y el cliente Flask;
no hacen login, no usan un token real, no llaman a Telegram y no mutan una
cuenta NotebookLM.