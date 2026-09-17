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

Son obligatorias para iniciar el servicio:

* `TELEGRAM_BOT_TOKEN`
* `TELEGRAM_CHANNEL_ID`
* `HUB_ENDPOINT_URL` (HTTPS público, sin redirecciones)
* `SGN_SECRET_TOKEN`

`TELEGRAM_ALLOWED_USER_IDS` es opcional (IDs separados por comas). Sin esa
lista, el bot solo permite chats privados cuyo usuario sea
`administrator`/`creator` del canal configurado. Nunca se permite un grupo.

## Arranque

```bash
python main.py                 # API y polling del bot
python main.py --api-only      # solo API, útil para Cloudflare Tunnel
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
`SGN_SECRET_TOKEN` (comparación resistente al tiempo). Opcionalmente
`X-SGN-Actor` separa los cuadernos persistidos de la UI; tener un token válido
es lo que autoriza la petición.

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
`SGN_SECRET_TOKEN`; el proxy debe enviar `X-SGN-Token` a esta API. No pongas el
token en una URL ni en el frontend. La comprobación de nodos no sigue
redirecciones y no expone el token ni la salida cruda de la CLI.

## Pruebas

```bash
pytest -q tests/test_notebooklm_bot.py
```

Las pruebas usan una CLI falsa, una base SQLite temporal y el cliente Flask;
no hacen login, no usan un token real, no llaman a Telegram y no mutan una
cuenta NotebookLM.