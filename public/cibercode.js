/**

 * cibercode.js

 * ============

 * Controlador de CIBERCODE 2.0 (Clon Antigravity IDE Soberano de 3 Divisiones).

 * Soporta Splitters Resizables duales, Activity Bar, Monaco Editor, Inferencia Qwen y Terminal Replit.

 */



let editor = null;

let currentFilePath = 'hola_soberano.py';

let currentSpeed = 'ultraligero'; // 'ultraligero' (1.5B) o 'profundo' (7B)

let currentVia = 'local';

let API_BASE = 'http://192.168.1.7:8888';



// ── 1. VISTAS DEL PANEL IZQUIERDO (ACTIVITY BAR) ──

function switchLeftView(view) {

  document.querySelectorAll('.activity-icon').forEach(icon => icon.classList.remove('active'));

  document.getElementById('leftBodyFiles').style.display = 'none';

  document.getElementById('leftBodyChats').style.display = 'none';

  document.getElementById('leftBodySettings').style.display = 'none';



  if (view === 'files') {

    document.getElementById('actIconFiles').classList.add('active');

    document.getElementById('leftBodyFiles').style.display = 'flex';

    cargarArbol();

  } else if (view === 'chats') {

    document.getElementById('actIconChats').classList.add('active');

    document.getElementById('leftBodyChats').style.display = 'flex';

  } else if (view === 'settings') {

    document.getElementById('actIconSettings').classList.add('active');

    document.getElementById('leftBodySettings').style.display = 'flex';

  }

}



// ── 2. CONMUTADOR DE VÍAS (LOCAL LAN / NUBE RAILWAY / CLOUDFLARE) ──

function cambiarVia(via) {

  currentVia = via;

  document.querySelectorAll('.btn-via').forEach(b => b.classList.remove('active'));

  const targetLabel = document.getElementById('target-label');



  if (via === 'local') {

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    API_BASE = isLocalhost ? 'http://127.0.0.1:8888' : 'http://192.168.1.7:8888';

    const b = document.getElementById('btnViaLocal');

    if (b) b.classList.add('active');

    if (targetLabel) targetLabel.textContent = `Supernodo PC4 i9 (${API_BASE.replace('http://', '')})`;

  } else if (via === 'cloud') {

    API_BASE = '/api/cibercode';

    const b = document.getElementById('btnViaCloud');

    if (b) b.classList.add('active');

    if (targetLabel) targetLabel.textContent = 'Conectado: Nube Railway (Relay PC4)';

  }



  cargarArbol();

}



// ── 3. INICIALIZAR MONACO EDITOR ──

require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

require(['vs/editor/editor.main'], function () {

  editor = monaco.editor.create(document.getElementById('monaco-container'), {

    value: '# CIBERCODE 2.0 Soberano — Clon Antigravity IDE (3 Divisiones)\n# Todo cambio se guarda con verificación criptográfica SHA-256 en PC4 i9.\n\ndef hola_soberano():\n    print("CIBERCODE 2.0 activo en los 24 núcleos de PC4")\n    print("Panel Izq: Explorador | Centro: Editor | Der: Agente Qwen & Terminal")\n',

    language: 'python',

    theme: 'vs-dark',

    fontSize: 13,

    fontFamily: "'Fira Code', monospace",

    automaticLayout: true,

    minimap: { enabled: true },

    scrollBeyondLastLine: false,

    renderLineHighlight: 'all',

    tabSize: 4

  });



  // Atajo Ctrl+S / Cmd+S para guardado rápido

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {

    guardarArchivoActual();

  });

});



// ── 4. SISTEMA DE RESIZE EN LAS 3 DIVISIONES ──

function initSplitters() {

  const colLeft = document.getElementById('col-left');

  const resizerLeft = document.getElementById('resizer-left');

  const colRight = document.getElementById('col-right');

  const resizerRight = document.getElementById('resizer-right');

  const terminalSection = document.getElementById('terminal-section');

  const resizerTerminal = document.getElementById('resizer-terminal');



  // Estado de arrastre

  let dragMode = null; // 'left', 'right', 'terminal'

  let startX = 0;

  let startY = 0;

  let startW = 0;

  let startH = 0;



  // Splitter 1: Izquierda / Centro

  resizerLeft.addEventListener('mousedown', function (e) {

    dragMode = 'left';

    startX = e.clientX;

    startW = colLeft.getBoundingClientRect().width;

    resizerLeft.classList.add('dragging');

    document.body.style.cursor = 'col-resize';

    document.body.style.userSelect = 'none';

  });



  // Splitter 2: Centro / Derecha

  resizerRight.addEventListener('mousedown', function (e) {

    dragMode = 'right';

    startX = e.clientX;

    startW = colRight.getBoundingClientRect().width;

    resizerRight.classList.add('dragging');

    document.body.style.cursor = 'col-resize';

    document.body.style.userSelect = 'none';

  });



  // Splitter 3: Chat / Terminal (Horizontal en Columna Derecha)

  resizerTerminal.addEventListener('mousedown', function (e) {

    dragMode = 'terminal';

    startY = e.clientY;

    startH = terminalSection.getBoundingClientRect().height;

    resizerTerminal.classList.add('dragging');

    document.body.style.cursor = 'row-resize';

    document.body.style.userSelect = 'none';

  });



  window.addEventListener('mousemove', function (e) {

    if (!dragMode) return;



    if (dragMode === 'left') {

      const dx = e.clientX - startX;

      let newW = startW + dx;

      if (newW < 180) newW = 180;

      if (newW > 500) newW = 500;

      colLeft.style.width = newW + 'px';

    } else if (dragMode === 'right') {

      const dx = startX - e.clientX;

      let newW = startW + dx;

      if (newW < 280) newW = 280;

      if (newW > 700) newW = 700;

      colRight.style.width = newW + 'px';

    } else if (dragMode === 'terminal') {

      const dy = startY - e.clientY;

      let newH = startH + dy;

      if (newH < 90) newH = 90;

      if (newH > 500) newH = 500;

      terminalSection.style.height = newH + 'px';

    }



    if (editor) editor.layout();

  });



  window.addEventListener('mouseup', function () {

    if (dragMode) {

      dragMode = null;

      resizerLeft.classList.remove('dragging');

      resizerRight.classList.remove('dragging');

      resizerTerminal.classList.remove('dragging');

      document.body.style.cursor = 'default';

      document.body.style.userSelect = 'auto';

      if (editor) editor.layout();

    }

  });



  window.addEventListener('resize', function () {

    if (editor) editor.layout();

  });

}



// ── 5. VELOCIDAD QWEN BIMODAL ──

function setSpeed(speed) {

  currentSpeed = speed;

  const btnUltra = document.getElementById('btnSpeedUltra');

  const btnDeep = document.getElementById('btnSpeedDeep');



  if (speed === 'ultraligero') {

    btnUltra.className = 'btn-speed active-green';

    btnDeep.className = 'btn-speed';

  } else {

    btnUltra.className = 'btn-speed';

    btnDeep.className = 'btn-speed active-blue';

  }

}



// ── 6. EXPLORADOR DE ARCHIVOS ──

async function cargarArbol() {

  const container = document.getElementById('fileTree');

  if (!container) return;

  container.innerHTML = '<div style="color:var(--text-muted); padding:8px;">Consultando PC4...</div>';



  try {

    const res = await fetch(`${API_BASE}/api/fs/tree`, { cache: 'no-store' });

    const data = await res.json();



    if (data.status === 'success' && data.tree) {

      container.innerHTML = '';

      renderTreeItems(data.tree, container);

    } else {

      container.innerHTML = `<div style="color:var(--red); padding:8px;">Error: ${data.error || 'No se pudo leer el árbol'}</div>`;

    }

  } catch (err) {

    container.innerHTML = `

      <div style="color:var(--amber); padding:8px; font-size:0.73rem;">

        ⚠️ Standby PC4 (8888)...<br>

        <button class="btn btn-save" style="margin-top:6px; font-size:0.68rem; padding:2px 6px;" onclick="cargarArbol()">Reintentar</button>

      </div>`;

  }

}



function renderTreeItems(items, parentElement, depth = 0) {

  items.forEach(item => {

    const el = document.createElement('div');

    el.className = `tree-item ${item.type === 'directory' ? 'folder' : ''}`;

    el.style.paddingLeft = `${depth * 12 + 6}px`;



    const icon = item.type === 'directory' ? '📁' : '📄';

    el.innerHTML = `<span>${icon}</span> <span>${item.name}</span>`;



    if (item.type === 'file') {

      el.onclick = () => abrirArchivo(item.path, el);

    }

    parentElement.appendChild(el);



    if (item.children && item.children.length > 0) {

      renderTreeItems(item.children, parentElement, depth + 1);

    }

  });

}



async function abrirArchivo(filePath, clickedEl) {

  if (window.innerWidth <= 768 && typeof setMobileView === 'function') { setMobileView('editor'); }

  document.querySelectorAll('.tree-item').forEach(t => t.classList.remove('active'));

  if (clickedEl) clickedEl.classList.add('active');



  currentFilePath = filePath;

  const fileName = filePath.split(/[/\\]/).pop();



  const fileNameEl = document.getElementById('currentFileName');

  const tabFileNameEl = document.getElementById('tabFileName');

  const fileShaEl = document.getElementById('currentFileSha');



  if (fileNameEl) fileNameEl.textContent = fileName;

  if (tabFileNameEl) tabFileNameEl.textContent = fileName;

  if (fileShaEl) fileShaEl.textContent = 'Cargando SHA...';



  try {

    const res = await fetch(`${API_BASE}/api/fs/read?path=${encodeURIComponent(filePath)}`, { cache: 'no-store' });

    const data = await res.json();



    if (data.status === 'success') {

      if (editor) editor.setValue(data.content || '');

      if (fileShaEl) fileShaEl.textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 8) : 'OK'}`;



      const ext = filePath.split('.').pop().toLowerCase();

      const langMap = { py: 'python', js: 'javascript', html: 'html', css: 'css', json: 'json', md: 'markdown', ts: 'typescript' };

      if (editor) monaco.editor.setModelLanguage(editor.getModel(), langMap[ext] || 'plaintext');

    } else {

      alert(`Error al abrir archivo: ${data.error}`);

    }

  } catch (err) {

    alert(`Error de red al conectar con PC4: ${err.message}`);

  }

}



async function guardarArchivoActual() {

  if (!currentFilePath) {

    alert('Primero selecciona o abre un archivo.');

    return;

  }



  const btn = document.getElementById('btnGuardar');

  btn.textContent = '⏳ Guardando...';

  btn.disabled = true;



  try {

    const content = editor ? editor.getValue() : '';

    const res = await fetch(`${API_BASE}/api/fs/write`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ path: currentFilePath, content })

    });

    const data = await res.json();



    if (data.status === 'success') {

      const fileShaEl = document.getElementById('currentFileSha');

      if (fileShaEl) fileShaEl.textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 8) : 'OK'}`;

      btn.textContent = '✅ Guardado';

      setTimeout(() => { btn.textContent = '💾 Guardar en PC4'; btn.disabled = false; }, 1400);

    } else {

      alert(`Error al guardar: ${data.error}`);

      btn.textContent = '💾 Guardar en PC4';

      btn.disabled = false;

    }

  } catch (err) {

    alert(`Error al guardar: ${err.message}`);

    btn.textContent = '💾 Guardar en PC4';

    btn.disabled = false;

  }

}



// ── 7. CONSULTA AL AGENTE QWEN (ASÍNCRONO SOBERANO & ANTI-TIMEOUT) ──

async function enviarConsultaIA() {

  const promptInput = document.getElementById('promptText');

  const prompt = promptInput.value.trim();

  if (!prompt) return;



  const chatContainer = document.getElementById('chatOutput');



  // Mensaje de usuario

  const userMsg = document.createElement('div');

  userMsg.className = 'chat-msg user';

  userMsg.innerHTML = `<strong>Tú:</strong> ${escapeHtml(prompt)}`;

  chatContainer.appendChild(userMsg);

  promptInput.value = '';



  // Mensaje de espera con indicación de Pensamiento Profundo

  const waitMsg = document.createElement('div');

  waitMsg.className = 'chat-msg qwen';

  const isDeep = (currentSpeed === 'profundo' || currentSpeed === 'qwen-sgn:latest');

  const speedLabel = isDeep ? '🔵 7B Pensamiento Profundo' : '⚡ 1.5B Rápido';

  const speedHint = isDeep

    ? '⏳ Razonando en los 24 núcleos de PC4 (análisis profundo de código)... (0s)'

    : '⚡ Pensando en los 24 núcleos de PC4... (0s)';

  waitMsg.innerHTML = `<strong>Qwen (${speedLabel}):</strong> <span class="wait-text">${speedHint}</span>`;

  chatContainer.appendChild(waitMsg);

  chatContainer.scrollTop = chatContainer.scrollHeight;



  const contextCode = editor ? editor.getValue() : '';

  const startTime = Date.now();



  try {

    const res = await fetch(`${API_BASE}/api/ai/generate`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({

        prompt: prompt,

        mode: currentSpeed,

        context: contextCode.length < 15000 ? contextCode : ''

      })

    });



    // Validación segura de Content-Type anti-HTML (Evita error SyntaxError: Unexpected token '<')

    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {

      const rawHtml = await res.text();

      const statusText = res.status === 504 ? 'Gateway Timeout de Red' : (res.status === 502 ? 'Bad Gateway' : `HTTP ${res.status}`);

      throw new Error(`Servidor devolvió respuesta no-JSON (${statusText})`);

    }



    const data = await res.json();



    if (data.status === 'processing' && data.missionId) {

      // ── Bucle de Sondeo Asíncrono (Inmune a timeouts de proxy de Railway) ──

      const missionId = data.missionId;

      const pollIntervalMs = 2000;

      const maxWaitMs = 360000; // 6 min generosos para ambos modos (evita cortes si se pide codigo largo en ultraligero)

      const deadline = Date.now() + maxWaitMs;



      while (Date.now() < deadline) {

        await new Promise(r => setTimeout(r, pollIntervalMs));

        const elapsedSec = Math.round((Date.now() - startTime) / 1000);

        const waitTextEl = waitMsg.querySelector('.wait-text');

        if (waitTextEl) {

          waitTextEl.textContent = isDeep

            ? `⏳ Razonando en los 24 núcleos de PC4... (${elapsedSec}s transcurridos)`

            : `⚡ Pensando en los 24 núcleos de PC4... (${elapsedSec}s transcurridos)`;

        }



        let pollRes;

        try {

          pollRes = await fetch(`${API_BASE}/api/ai/status?missionId=${encodeURIComponent(missionId)}`);

        } catch (pollNetErr) {

          console.warn('[CIBERCODE POLL RETRY]:', pollNetErr.message);

          continue; // Reintento tolerante a micro-cortes WiFi de celular

        }



        const pollContentType = pollRes.headers.get('content-type') || '';

        if (!pollContentType.includes('application/json')) continue;



        let pollData;

        try {

          pollData = await pollRes.json();

        } catch (_) {

          continue;

        }



        if (pollData.status === 'completed') {

          const responseText = pollData.response || pollData.text || '';

          const totalElapsed = Math.round((Date.now() - startTime) / 1000);

          waitMsg.innerHTML = `

            <strong>Qwen (${pollData.model || currentSpeed}):</strong><br>

            ${formatCodeBlocks(responseText)}

            <div style="margin-top:6px; font-size:0.66rem; color:var(--text-muted); border-top:1px solid #1e293b; padding-top:4px;">

              ⚡ ${pollData.tokens_evaluated || pollData.tokens || Math.round(responseText.length / 3.8)} tokens en ${totalElapsed}s | Auto-liberado en 15s

            </div>`;

          chatContainer.scrollTop = chatContainer.scrollHeight;

          return;

        } else if (pollData.status === 'failed') {

          throw new Error(pollData.error || 'Fallo en la inferencia');

        }

      }

      throw new Error(`Tiempo de espera agotado (${Math.round(maxWaitMs / 1000)}s) en PC4.`);

    } else if (data.status === 'success') {

      // Fallback síncrono si el servidor resolvió de inmediato

      const responseText = data.response || data.text || '';

      waitMsg.innerHTML = `

        <strong>Qwen (${data.model || currentSpeed}):</strong><br>

        ${formatCodeBlocks(responseText)}

        <div style="margin-top:6px; font-size:0.66rem; color:var(--text-muted); border-top:1px solid #1e293b; padding-top:4px;">

          ⚡ ${data.tokens_evaluated || data.tokens || 0} tokens en ${data.latency_seconds || data.elapsed_seconds || 0}s | Auto-liberado en 15s

        </div>`;

    } else {

      waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error: ${escapeHtml(data.error || 'Fallo')}</span>`;

    }

  } catch (err) {

    waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error de conexión (${escapeHtml(err.message)})</span>`;

  }

  chatContainer.scrollTop = chatContainer.scrollHeight;

}



// ── 8. BUCLE REPLIT AGENT (TERMINAL INFERIOR) ──

async function dispararSelfHealing() {

  if (!currentFilePath) {

    alert('Primero selecciona o abre un script.');

    return;

  }



  const logBox = document.getElementById('replitLog');

  logBox.innerHTML = `

    <div class="log-line log-heal">⚡ [PC4 EXEC] Ejecutando: ${escapeHtml(currentFilePath)} en los 24 núcleos...</div>

  `;



  try {

    const res = await fetch(`${API_BASE}/api/exec/self-heal`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ path: currentFilePath, max_retries: 3 })

    });

    const data = await res.json();



    if (data.status === 'success') {

      logBox.innerHTML += `

        <div class="log-line log-success">✅ [EXIT CODE 0] Script verificado exitosamente.</div>

        <div class="log-line">Iteraciones: ${data.iterations || 1}</div>

        <div class="log-line log-heal">${escapeHtml(data.logs || data.stdout || 'Ejecución completada.')}</div>

      `;

      if (data.repaired) abrirArchivo(currentFilePath);

    } else {

      logBox.innerHTML += `

        <div class="log-line log-error">❌ [FALLO]: ${escapeHtml(data.error || 'Error al ejecutar')}</div>

      `;

    }

  } catch (err) {

    logBox.innerHTML += `

      <div class="log-line log-error">❌ Error: ${escapeHtml(err.message)}</div>

    `;

  }

  logBox.scrollTop = logBox.scrollHeight;

}



function limpiarTerminal() {

  const logBox = document.getElementById('replitLog');

  if (logBox) logBox.innerHTML = '<div class="log-line">Consola reiniciada.</div>';

}



function cargarProyectoDemo(tipo) {

  if (tipo === 'despacho_flores') {

    if (editor) {

      editor.setValue(`# Despacho Flores Miami — Cálculo Logístico

cajas = 150

precio_unitario = 18.50

subtotal = cajas * precio_unitario

flete_aereo = subtotal * 0.12

seguro = 45.00

total = subtotal + flete_aereo + seguro



print(f"Subtotal Cajas: \${subtotal:.2f}")

print(f"Flete Aéreo (12%): \${flete_aereo:.2f}")

print(f"Seguro: \${seguro:.2f}")

print(f"TOTAL DESPACHO: \${total:.2f}")

`);

    }

    const fn = document.getElementById('currentFileName');

    const tfn = document.getElementById('tabFileName');

    if (fn) fn.textContent = 'despacho_flores_miami.py';

    if (tfn) tfn.textContent = 'despacho_flores_miami.py';

  }

}



// ── UTILIDADES DE ESCAPADO Y FORMATO ──

function escapeHtml(text) {

  if (!text) return '';

  return String(text)

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;')

    .replace(/'/g, '&#039;');

}



function formatCodeBlocks(text) {

  if (!text) return '';

  const escaped = escapeHtml(text);

  return escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (match, lang, code) {

    return `<pre><code>${code.trim()}</code></pre>`;

  });

}



// ── 9. INICIALIZACIÓN AL CARGAR EL DOM ──

document.addEventListener('DOMContentLoaded', function () {

  initSplitters();



  const promptInput = document.getElementById('promptText');

  if (promptInput) {

    promptInput.addEventListener('keydown', function (e) {

      if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {

        e.preventDefault();

        enviarConsultaIA();

      }

    });

  }



  // Autodetección de entorno

  if (window.location.hostname.includes('railway.app')) {

    cambiarVia('cloud');

  } else {

    cambiarVia('local');

  }

});



// ── 10. GESTOR DE PAQUETES & ZIPS SGN (Skill: gestion-enlaces-descargables-y-web-sgn) ──

let selectedZipFile = null;

let selectedZipBase64 = null;

let selectedZipSha256 = null;



function abrirModalZips() {

  const modal = document.getElementById('modalZips');

  if (!modal) return;

  modal.style.display = 'flex';



  const editorLabel = document.getElementById('zipEditorFileLabel');

  if (editorLabel) {

    const fileName = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : 'script.py';

    editorLabel.textContent = `Archivo activo: ${fileName}`;

  }



  cargarListaZipsServidor();

}



function cerrarModalZips() {

  const modal = document.getElementById('modalZips');

  if (modal) modal.style.display = 'none';

  selectedZipFile = null;

  selectedZipBase64 = null;

  selectedZipSha256 = null;

  const preview = document.getElementById('zipUploadPreview');

  if (preview) preview.style.display = 'none';

  const statusMsg = document.getElementById('uploadStatusMsg');

  if (statusMsg) statusMsg.style.display = 'none';

}



function cerrarModalZipsSiFondo(e) {

  if (e.target.id === 'modalZips') cerrarModalZips();

}



async function descargarCodigoComoZip() {

  if (!editor) {

    alert('Monaco Editor aún no está listo.');

    return;

  }

  const content = editor.getValue();

  const rawName = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : 'script.py';

  const baseName = rawName.replace(/\.[^/.]+$/, "");



  if (typeof JSZip !== 'undefined') {

    const zip = new JSZip();

    zip.file(rawName, content);

    zip.file("LEAME_SGN.txt", `CIBERCODE 2.0 — Antigravity IDE Soberano\nArchivo: ${rawName}\nFecha: ${new Date().toISOString()}\nGenerado bajo la Constitución SGN.\n`);

    const blob = await zip.generateAsync({ type: 'blob' });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = `${baseName}_SGN.zip`;

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

  } else {

    // Fallback descarga directa del archivo con attachment

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = rawName;

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

  }

}



function handleZipDragOver(e) {

  e.preventDefault();

  const dz = document.getElementById('zipDropzone');

  if (dz) dz.classList.add('dragover');

}



function handleZipDragLeave(e) {

  e.preventDefault();

  const dz = document.getElementById('zipDropzone');

  if (dz) dz.classList.remove('dragover');

}



function handleZipDrop(e) {

  e.preventDefault();

  const dz = document.getElementById('zipDropzone');

  if (dz) dz.classList.remove('dragover');

  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {

    procesarArchivoSeleccionado(e.dataTransfer.files[0]);

  }

}



function handleZipFileSelected(e) {

  if (e.target.files && e.target.files.length > 0) {

    procesarArchivoSeleccionado(e.target.files[0]);

  }

}



/**
 * Parche para public/cibercode.js en CIBERCODE 2.0
 * Reemplaza la subida en Base64 por transmisión binaria de alta velocidad con barra de progreso en vivo.
 */

// 1. Selector de archivo sin bloqueo de memoria
function procesarArchivoSeleccionado(file) {
  selectedZipFile = file;

  const preview = document.getElementById('zipUploadPreview');
  const nameEl = document.getElementById('uploadFileName');
  const sizeEl = document.getElementById('uploadFileSize');
  const hashEl = document.getElementById('uploadFileHash');
  const statusMsg = document.getElementById('uploadStatusMsg');
  const btn = document.getElementById('btnConfirmUpload');

  if (preview) preview.style.display = 'block';
  if (statusMsg) statusMsg.style.display = 'none';

  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) {
    const gb = (file.size / (1024 * 1024 * 1024)).toFixed(2);
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    const kb = (file.size / 1024).toFixed(1);
    if (file.size >= 1073741824) {
      sizeEl.textContent = `${gb} GB`;
    } else if (file.size >= 1048576) {
      sizeEl.textContent = `${mb} MB`;
    } else {
      sizeEl.textContent = `${kb} KB`;
    }
  }

  if (hashEl) hashEl.textContent = 'Certificación SHA-256 se calculará al vuelo durante la transmisión.';
  if (btn) {
    btn.disabled = false;
    btn.textContent = '🚀 Subir y Certificar por Stream';
  }
}

// 2. Subida por Streaming con barra de progreso real (Soporta Gigabytes)
async function ejecutarSubidaZip() {
  if (!selectedZipFile) {
    alert('Primero selecciona un archivo válido.');
    return;
  }

  const btn = document.getElementById('btnConfirmUpload');
  const statusMsg = document.getElementById('uploadStatusMsg');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Transfiriendo...'; }
  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.style.color = '#38bdf8';
    statusMsg.textContent = 'Iniciando transmisión por streaming de alta velocidad...';
  }

  const xhr = new XMLHttpRequest();
  const url = `/api/cibercode/upload-zip-stream?filename=${encodeURIComponent(selectedZipFile.name)}`;

  xhr.upload.onprogress = (evt) => {
    if (evt.lengthComputable && statusMsg) {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      const isGB = evt.total >= 1073741824;
      const loadedStr = isGB ? (evt.loaded / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : (evt.loaded / (1024 * 1024)).toFixed(1) + ' MB';
      const totalStr = isGB ? (evt.total / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : (evt.total / (1024 * 1024)).toFixed(1) + ' MB';
      statusMsg.innerHTML = `⏳ Transfiriendo por Stream: <strong>${pct}%</strong> (${loadedStr} de ${totalStr})...`;
    }
  };

  xhr.onload = () => {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Subir y Certificar por Stream'; }
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status === 200 && data.status === 'success') {
        if (statusMsg) {
          statusMsg.style.color = '#4ade80';
          statusMsg.innerHTML = `✅ <strong>${escapeHtml(data.filename)}</strong> subido y certificado exitosamente.<br>
          <span style="font-family:'Fira Code', monospace; font-size:0.67rem; color:#a7f3d0;">SHA-256 Servidor: ${data.sha256}</span> •
          <a href="${data.downloadUrl}" download style="color:#00f3ff; text-decoration:underline;">Descargar directo</a>`;
        }
        cargarListaZipsServidor();
      } else {
        if (statusMsg) {
          statusMsg.style.color = '#f87171';
          statusMsg.textContent = `❌ Error del servidor: ${data.error || 'Fallo desconocido'}`;
        }
      }
    } catch (e) {
      if (statusMsg) {
        statusMsg.style.color = '#f87171';
        statusMsg.textContent = `❌ Error procesando respuesta: ${xhr.statusText}`;
      }
    }
  };

  xhr.onerror = () => {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Subir y Certificar por Stream'; }
    if (statusMsg) {
      statusMsg.style.color = '#f87171';
      statusMsg.textContent = '❌ Error de red durante la transmisión.';
    }
  };

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.send(selectedZipFile);
}


async function cargarListaZipsServidor() {

  const container = document.getElementById('serverZipsList');

  if (!container) return;



  try {

    const res = await fetch('/api/cibercode/zips', { cache: 'no-store' });

    const data = await res.json();



    if (data.status === 'success' && Array.isArray(data.zips) && data.zips.length > 0) {

      container.innerHTML = '';

      data.zips.forEach(z => {

        const item = document.createElement('div');

        item.style.cssText = 'background:#020617; border:1px solid #1e293b; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px;';

        

        const kb = (z.size / 1024).toFixed(1);

        const mb = (z.size / (1024 * 1024)).toFixed(2);

        const sizeStr = z.size > 1048576 ? `${mb} MB` : `${kb} KB`;

        const badgeColor = z.tipo.includes('Oficial') ? '#4ade80' : '#38bdf8';



        item.innerHTML = `

          <div style="flex:1; overflow:hidden;">

            <div style="display:flex; align-items:center; gap:6px;">

              <strong style="font-size:0.77rem; color:#f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(z.filename)}</strong>

              <span style="font-size:0.62rem; background:#0f172a; color:${badgeColor}; border:1px solid #1e293b; padding:1px 5px; border-radius:4px;">${escapeHtml(z.tipo)}</span>

              <span style="font-size:0.68rem; color:#94a3b8;">(${sizeStr})</span>

            </div>

            <div style="font-family:'Fira Code', monospace; font-size:0.63rem; color:#64748b; margin-top:2px;">

              SHA-256: ${z.sha256}

            </div>

          </div>

          <a href="${z.downloadUrl}" download="${escapeHtml(z.filename)}" class="btn-zip-dl" style="padding:4px 9px; font-size:0.68rem; flex-shrink:0;">

            ⬇️ Descargar

          </a>

        `;

        container.appendChild(item);

      });

    } else {

      container.innerHTML = '<div style="font-size:0.72rem; color:#94a3b8; padding:8px; text-align:center;">No hay paquetes adicionales en el servidor.</div>';

    }

  } catch (err) {

    container.innerHTML = `<div style="font-size:0.72rem; color:#f59e0b; padding:8px; text-align:center;">No se pudo consultar el servidor: ${err.message}</div>`;

  }

}





// ── GESTIÓN DE VISTAS EN DISPOSITIVOS MÓVILES (SGN MOBILE) ──

function setMobileView(viewName) {

  document.body.classList.remove('mobile-view-files', 'mobile-view-editor', 'mobile-view-chat', 'mobile-view-terminal');

  document.body.classList.add('mobile-view-' + viewName);



  document.querySelectorAll('.mobile-tab-btn').forEach(btn => btn.classList.remove('active'));

  const activeBtn = document.getElementById('mTab' + viewName.charAt(0).toUpperCase() + viewName.slice(1));

  if (activeBtn) activeBtn.classList.add('active');



  if (viewName === 'editor' && typeof editor !== 'undefined' && editor) {

    setTimeout(() => editor.layout(), 120);

  }

}



// ── GESTIÓN DE VISTAS EN DISPOSITIVOS MÓVILES (SGN MOBILE) ──

function setMobileView(viewName) {

  document.body.classList.remove('mobile-view-files', 'mobile-view-editor', 'mobile-view-chat', 'mobile-view-terminal');

  document.body.classList.add('mobile-view-' + viewName);



  document.querySelectorAll('.mobile-tab-btn, .m-pill').forEach(btn => btn.classList.remove('active'));



  const capName = viewName.charAt(0).toUpperCase() + viewName.slice(1);

  const activeTab = document.getElementById('mTab' + capName);

  const activeTop = document.getElementById('mTop' + capName);

  if (activeTab) activeTab.classList.add('active');

  if (activeTop) activeTop.classList.add('active');



  if (viewName === 'editor' && typeof editor !== 'undefined' && editor) {

    setTimeout(() => editor.layout(), 120);

  }

}