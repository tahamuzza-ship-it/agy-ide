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

`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHANNEL_ID` no son necesarios en modo API:
ese modo no crea un bot, nunca inicia polling y deja la publicación de noticias
sin configurar. En modo bot independiente (`python main.py`) sí son obligatorios.
Las peticiones de noticias en modo API devuelven un error explícito indicando
que no hay canal configurado; las demás funciones de la API siguen disponibles.

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
publicación de noticias queda deliberadamente sin configurar. Si se necesita
publicar, usa el modo bot independiente con las credenciales de Telegram
correspondientes.

Configura `HUB_ENDPOINT_URL` y la misma `CONEXION_NOTEBOOK_PUENTE` en Python, AGY IDE
y el servicio CiberCode que atiende a Code Arquitect. La sesión Google se inicia
en el equipo del Hub. Para publicar noticias en modo bot, el Hub necesita el
token correcto de Code Arquitect y un canal en el que ese bot pueda publicar.
El token de otro bot del workspace no es intercambiable.

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
* **📰 Publicar noticia**: indexa y resume una URL, pero siempre muestra una
  confirmación antes de publicar en el canal.
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
  `source_url|source_pdf|podcast|report|voice|news`; devuelve `202` con
  `{id,status:"queued"}`.
* `GET /api/notebooklm/jobs/:id`
* `GET /api/notebooklm/files/:id`

El estado de autenticación usa el contrato real de `notebooklm-py==0.8.2`:
ejecuta `notebooklm auth check --test --json` y considera autenticada la sesión
solo cuando la respuesta tiene `status: "ok"`. No se devuelven cookies, correos
ni el diagnóstico crudo de la CLI.

Los trabajos tienen como máximo dos ejecuciones simultáneas y 32 posiciones de
cola. Las tareas interrumpidas se marcan `failed` al reiniciar. El PDF debe
llevar base64 con firma `%PDF-` y no superar 4 MB decodificados; el body total
está limitado a 8 MB. `news` exige `confirmed:true`, además de ser una acción
externa.

## Cloudflare Tunnel

Ejemplo conceptual en la máquina que ejecuta Python:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Configura `HUB_ENDPOINT_URL=https://...` con el endpoint HTTPS público real del
hub. En el servicio Node/AGY configura el mismo `HUB_ENDPOINT_URL` y el mismo
`CONEXION_NOTEBOOK_PUENTE`; el proxy debe enviar `X-SGN-Token` a esta API. No pongas el
token en una URL ni en el frontend. La comprobación de nodos no sigue
redirecciones y no expone el token ni la salida cruda de la CLI.

## Pruebas

```bash
pytest -q tests/test_notebooklm_bot.py
```

Las pruebas usan una CLI falsa, una base SQLite temporal y el cliente Flask;
no hacen login, no usan un token real, no llaman a Telegram y no mutan una
cuenta NotebookLM.