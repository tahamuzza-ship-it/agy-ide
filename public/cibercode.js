/**
 * cibercode.js
 * ============
 * Controlador del Frontend de CIBERCODE 2.0 (Clon Antigravity IDE Soberano).
 * Orquesta Monaco Editor, File Explorer, Inferencia Dual Qwen, Divisores Resizables y Bucle Self-Healing.
 */

let editor = null;
let currentFilePath = '';
let currentSpeed = 'ultraligero'; // 'ultraligero' (1.5B) o 'profundo' (7B)
let currentVia = 'local';
let API_BASE = 'http://192.168.1.7:8888';

// ── 1. NAVEGACIÓN Y PESTAÑAS LATERALES (ESTILO ANTIGRAVITY) ──
function switchLeftTab(tab) {
  const btnChat = document.getElementById('tabBtnChat');
  const btnFiles = document.getElementById('tabBtnFiles');
  const contentChat = document.getElementById('tabContentChat');
  const contentFiles = document.getElementById('tabContentFiles');

  if (tab === 'chat') {
    btnChat.classList.add('active');
    btnFiles.classList.remove('active');
    contentChat.style.display = 'flex';
    contentFiles.style.display = 'none';
  } else {
    btnChat.classList.remove('active');
    btnFiles.classList.add('active');
    contentChat.style.display = 'none';
    contentFiles.style.display = 'flex';
    cargarArbol();
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
    value: '# CIBERCODE 2.0 Soberano — Clon Antigravity IDE\n# Todo cambio se guarda con verificación criptográfica SHA-256 en PC4.\n\ndef hola_soberano():\n    print("CIBERCODE 2.0 activo en los 24 núcleos de PC4 i9")\n',
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

// ── 4. CONTROLADORES DE DIVISORES REDIMENSIONABLES (SPLITTERS) ──
function initSplitters() {
  const panelLeft = document.getElementById('panel-left');
  const resizerLeft = document.getElementById('resizer-left');
  const terminalSection = document.getElementById('terminal-section');
  const resizerBottom = document.getElementById('resizer-bottom');

  // Divisor Vertical (Panel Izquierdo)
  let isDraggingLeft = false;
  let startX = 0;
  let startWidth = 0;

  resizerLeft.addEventListener('mousedown', function (e) {
    isDraggingLeft = true;
    startX = e.clientX;
    startWidth = panelLeft.getBoundingClientRect().width;
    resizerLeft.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  // Divisor Horizontal (Terminal Inferior)
  let isDraggingBottom = false;
  let startY = 0;
  let startHeight = 0;

  resizerBottom.addEventListener('mousedown', function (e) {
    isDraggingBottom = true;
    startY = e.clientY;
    startHeight = terminalSection.getBoundingClientRect().height;
    resizerBottom.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', function (e) {
    if (isDraggingLeft) {
      const dx = e.clientX - startX;
      let newWidth = startWidth + dx;
      if (newWidth < 280) newWidth = 280;
      if (newWidth > 650) newWidth = 650;
      panelLeft.style.width = newWidth + 'px';
      if (editor) editor.layout();
    }
    if (isDraggingBottom) {
      const dy = e.clientY - startY;
      let newHeight = startHeight - dy;
      if (newHeight < 110) newHeight = 110;
      if (newHeight > 550) newHeight = 550;
      terminalSection.style.height = newHeight + 'px';
      if (editor) editor.layout();
    }
  });

  window.addEventListener('mouseup', function () {
    if (isDraggingLeft || isDraggingBottom) {
      isDraggingLeft = false;
      isDraggingBottom = false;
      resizerLeft.classList.remove('dragging');
      resizerBottom.classList.remove('dragging');
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      if (editor) editor.layout();
    }
  });

  window.addEventListener('resize', function () {
    if (editor) editor.layout();
  });
}

// ── 5. SELECTOR DE VELOCIDAD DE QWEN ──
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

// ── 6. EXPLORADOR DE ARCHIVOS (PANEL ARCHIVOS) ──
async function cargarArbol() {
  const container = document.getElementById('fileTree');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Consultando PC4...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/fs/tree`, { cache: 'no-store' });
    const data = await res.json();

    if (data.status === 'success' && data.tree) {
      container.innerHTML = '';
      renderTreeItems(data.tree, container);
    } else {
      container.innerHTML = `<div style="color:var(--red); padding:10px;">Error: ${data.error || 'No se pudo leer el árbol'}</div>`;
    }
  } catch (err) {
    container.innerHTML = `
      <div style="color:var(--amber); padding:10px; font-size:0.75rem;">
        ⚠️ Modo Standby: Conectando con PC4 bridge (8888)...<br>
        <button class="btn btn-save" style="margin-top:8px; font-size:0.7rem;" onclick="cargarArbol()">Reintentar</button>
      </div>`;
  }
}

function renderTreeItems(items, parentElement, depth = 0) {
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `tree-item ${item.type === 'directory' ? 'folder' : ''}`;
    el.style.paddingLeft = `${depth * 14 + 8}px`;

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
  document.querySelectorAll('.tree-item').forEach(t => t.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');

  currentFilePath = filePath;
  const fileNameEl = document.getElementById('currentFileName');
  const fileShaEl = document.getElementById('currentFileSha');
  if (fileNameEl) fileNameEl.textContent = filePath.split(/[/\\]/).pop();
  if (fileShaEl) fileShaEl.textContent = 'Cargando SHA...';

  try {
    const res = await fetch(`${API_BASE}/api/fs/read?path=${encodeURIComponent(filePath)}`, { cache: 'no-store' });
    const data = await res.json();

    if (data.status === 'success') {
      if (editor) editor.setValue(data.content || '');
      if (fileShaEl) fileShaEl.textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 10) : 'OK'}`;

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
    alert('Primero selecciona o abre un archivo en el explorador.');
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
      if (fileShaEl) fileShaEl.textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 10) : 'OK'}`;
      btn.textContent = '✅ Guardado';
      setTimeout(() => { btn.textContent = '💾 Guardar en PC4'; btn.disabled = false; }, 1500);
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

// ── 7. CONSULTA AGÉNTICA A QWEN (PESTAÑA CHAT) ──
async function enviarConsultaIA() {
  const promptInput = document.getElementById('promptText');
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  const chatContainer = document.getElementById('chatOutput');

  // Agregar mensaje del usuario
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-msg user';
  userMsg.innerHTML = `<strong>Tú:</strong> ${escapeHtml(prompt)}`;
  chatContainer.appendChild(userMsg);
  promptInput.value = '';

  // Mensaje de espera
  const waitMsg = document.createElement('div');
  waitMsg.className = 'chat-msg qwen';
  waitMsg.innerHTML = `<strong>Qwen (${currentSpeed}):</strong> ⏳ Pensando en los 24 núcleos de PC4...`;
  chatContainer.appendChild(waitMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const contextCode = editor ? editor.getValue() : '';

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
    const data = await res.json();

    if (data.status === 'success') {
      const responseText = data.response || data.text || '';
      waitMsg.innerHTML = `
        <strong>Qwen (${data.model || currentSpeed}):</strong><br>
        ${formatCodeBlocks(responseText)}
        <div style="margin-top:8px; font-size:0.68rem; color:var(--text-muted); border-top:1px solid #1e293b; padding-top:4px;">
          ⚡ ${data.tokens_evaluated || data.tokens || 0} tokens en ${data.latency_seconds || data.elapsed_seconds || 0}s | Auto-liberado en 15s
        </div>`;
    } else {
      waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error: ${escapeHtml(data.error || 'Fallo desconocido')}</span>`;
    }
  } catch (err) {
    waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error de conexión con PC4 (${escapeHtml(err.message)})</span>`;
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Atajo Enter / Ctrl+Enter en el área de texto de prompts
document.addEventListener('DOMContentLoaded', function () {
  const promptInput = document.getElementById('promptText');
  if (promptInput) {
    promptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        enviarConsultaIA();
      }
    });
  }
});

// ── 8. BUCLE REPLIT AGENT (AUTO-CORRECCIÓN EN TERMINAL INFERIOR) ──
async function dispararSelfHealing() {
  if (!currentFilePath) {
    alert('Primero selecciona o abre un script en el editor.');
    return;
  }

  const logBox = document.getElementById('replitLog');
  logBox.innerHTML = `
    <div class="log-line log-heal">⚡ [REPLIT SOBERANO] Iniciando ejecución de: ${escapeHtml(currentFilePath)}...</div>
    <div class="log-line">Modo: Auto-reparación determinista (Qwen 1.5B Ultraligero / 24 núcleos i9)</div>
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
        <div class="log-line log-success">✅ [EXIT CODE 0] Script ejecutado con éxito.</div>
        <div class="log-line">Reparaciones requeridas: ${data.iterations || 1} iteraciones</div>
        <div class="log-line log-heal">Salida de terminal:\n${escapeHtml(data.logs || data.stdout || 'Ejecución exitosa sin errores.')}</div>
      `;
      // Recargar archivo si fue modificado por el self-healing
      if (data.repaired) {
        abrirArchivo(currentFilePath);
      }
    } else {
      logBox.innerHTML += `
        <div class="log-line log-error">❌ [FALLO DE EJECUCIÓN]: ${escapeHtml(data.error || 'No se pudo resolver')}</div>
      `;
    }
  } catch (err) {
    logBox.innerHTML += `
      <div class="log-line log-error">❌ Error de conexión al ejecutar: ${escapeHtml(err.message)}</div>
    `;
  }
  logBox.scrollTop = logBox.scrollHeight;
}

// ── UTILIDADES DE FORMATO Y ESCAPADO ──
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
  // Reemplazar bloques de código ```...```
  return escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (match, lang, code) {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
}

// ── 9. INICIALIZACIÓN AL CARGAR EL DOM (FUERA DE cambiarVia) ──
document.addEventListener('DOMContentLoaded', function () {
  initSplitters();

  // Autodetección del entorno (Railway Cloud vs Red Local LAN)
  if (window.location.hostname.includes('railway.app')) {
    cambiarVia('cloud');
  } else {
    cambiarVia('local');
  }
});
