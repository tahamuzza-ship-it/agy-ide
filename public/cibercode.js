/**
 * cibercode.js
 * ============
 * Controlador del Frontend de CIBERCODE 2.0 (Replit Agent Soberano SGN).
 * Orquesta Monaco Editor, File Explorer, Inferencia Dual Qwen y Bucle Self-Healing.
 */

let editor = null;
let currentFilePath = '';
let currentSpeed = 'ultraligero'; // 'ultraligero' (1.5B) o 'profundo' (7B)

// Detección dinámica de Endpoint API (Directo LAN PC4 o Proxy Web)
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8888'
  : (window.location.protocol === 'file:' ? 'http://192.168.1.7:8888' : '/api/cibercode');

// Inicializar Monaco Editor
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('monaco-container'), {
    value: '# CIBERCODE 2.0 Soberano — Selecciona un archivo del explorador a la izquierda\n# Todo cambio se guarda con verificación SHA-256 en PC4.\n\ndef hola_soberano():\n    print("CIBERCODE 2.0 activo en los 24 núcleos de PC4")\n',
    language: 'python',
    theme: 'vs-dark',
    fontSize: 13,
    fontFamily: "'Fira Code', monospace",
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all'
  });

  // Cargar árbol de archivos tras inicializar Monaco
  cargarArbol();
});

// Selector de Velocidad (Panel 3)
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

// PANEL 1: Cargar Árbol de Archivos
async function cargarArbol() {
  const container = document.getElementById('fileTree');
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

// PANEL 2: Abrir y Guardar Archivo
async function abrirArchivo(filePath, domElement = null) {
  if (domElement) {
    document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
    domElement.classList.add('active');
  }

  currentFilePath = filePath;
  document.getElementById('currentFileName').textContent = filePath.split(/[/\\]/).pop();
  document.getElementById('currentFileSha').textContent = 'Cargando SHA...';

  try {
    const res = await fetch(`${API_BASE}/api/fs/read?path=${encodeURIComponent(filePath)}`, { cache: 'no-store' });
    const data = await res.json();

    if (data.status === 'success') {
      editor.setValue(data.content || '');
      document.getElementById('currentFileSha').textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 10) : 'OK'}`;
      
      // Ajustar lenguaje en Monaco
      const ext = filePath.split('.').pop().toLowerCase();
      const langMap = { py: 'python', js: 'javascript', html: 'html', css: 'css', json: 'json', md: 'markdown' };
      monaco.editor.setModelLanguage(editor.getModel(), langMap[ext] || 'plaintext');
    } else {
      alert(`Error al abrir archivo: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red al conectar con PC4: ${err.message}`);
  }
}

async function guardarArchivoActual() {
  if (!currentFilePath) {
    alert('Primero selecciona un archivo en el explorador.');
    return;
  }

  const btn = document.getElementById('btnGuardar');
  btn.textContent = '⏳ Guardando...';
  btn.disabled = true;

  try {
    const content = editor.getValue();
    const res = await fetch(`${API_BASE}/api/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentFilePath, content })
    });
    const data = await res.json();

    if (data.status === 'success') {
      document.getElementById('currentFileSha').textContent = `SHA: ${data.sha256 ? data.sha256.substring(0, 10) : 'OK'}`;
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

// PANEL 3: Consulta Agéntica Dual a Qwen
async function enviarConsultaIA() {
  const promptInput = document.getElementById('promptText');
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  const chatContainer = document.getElementById('chatOutput');
  
  // Agregar mensaje de usuario
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-msg user';
  userMsg.innerHTML = `<strong>Tú:</strong> ${prompt}`;
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
      waitMsg.innerHTML = `
        <strong>Qwen (${data.model || currentSpeed}):</strong><br>
        ${escapeHtml(data.response || data.text || '')}
        <div style="margin-top:8px; font-size:0.7rem; color:var(--text-muted);">
          ⚡ ${data.tokens_evaluated || 0} tokens en ${data.latency_seconds || 0}s | Auto-liberado en 15s
        </div>`;
    } else {
      waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error: ${data.error}</span>`;
    }
  } catch (err) {
    waitMsg.innerHTML = `<strong>Qwen:</strong> <span style="color:var(--red);">Error de conexión con PC4 (${err.message})</span>`;
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// PANEL 4: Bucle Replit Agent (Self-Healing)
async function dispararSelfHealing() {
  if (!currentFilePath) {
    alert('Primero selecciona o abre un script en el editor.');
    return;
  }

  const logBox = document.getElementById('replitLog');
  logBox.innerHTML = `
    <div class="log-line log-heal">🚀 Iniciando Bucle Replit Agent sobre: ${currentFilePath}</div>
    <div class="log-line">Enviando orden de ejecución y auto-corrección a PC4...</div>
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
        <div class="log-line log-success">✅ ¡ÉXITO! Script reparado y certificado con exit_code: 0</div>
        <div class="log-line">Intentos requeridos: ${data.attempts || 1}</div>
        <div class="log-line">Salida final:</div>
        <pre style="color:#4ade80; margin-top:4px;">${data.final_stdout || 'Sin salida'}</pre>
      `;
      // Refrescar editor con el código nuevo auto-corregido
      abrirArchivo(currentFilePath);
    } else {
      logBox.innerHTML += `
        <div class="log-line log-error">❌ No se pudo auto-reparar tras varios intentos.</div>
        <div class="log-line log-error">${data.error || ''}</div>
        <pre style="color:#f87171; margin-top:4px;">${data.stderr || ''}</pre>
      `;
    }
  } catch (err) {
    logBox.innerHTML += `
      <div class="log-line log-error">Error al disparar el bucle: ${err.message}</div>
    `;
  }
  logBox.scrollTop = logBox.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
