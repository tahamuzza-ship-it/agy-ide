(function () {
  'use strict';

  var root, csrf = '', password = '', rfb = null, timer = null, expiresAt = 0;
  var API = '/api/notebooklm/admin';

  function node(tag, attrs, text) {
    var item = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'className') item.className = attrs[key];
      else if (key.indexOf('on') === 0) item.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
      else item.setAttribute(key, attrs[key]);
    });
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function status(text, kind) {
    var box = root.querySelector('[data-cloud-status]');
    box.className = 'nlm-cloud-status ' + (kind || '');
    box.textContent = text;
  }
  function idePasswordHeader() {
    try {
      if (typeof window._getPwd === 'function') return window._getPwd() || '';
    } catch (_) {}
    try {
      var raw = localStorage.getItem('agyide_auth_v1') || '';
      return raw ? encodeURIComponent(raw) : '';
    } catch (_) { return ''; }
  }
  async function call(path, options) {
    var opts = Object.assign({ method: 'POST', credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (csrf) opts.headers['X-AGY-Admin-CSRF'] = csrf;
    var response = await fetch(API + path, opts);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  }
  function countdown() {
    var seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    root.querySelector('[data-cloud-ttl]').textContent = csrf
      ? 'Acceso temporal: ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
      : 'Sin sesión administrativa';
    if (!seconds && csrf) revoke(false);
  }
  async function routeChanged(event) {
    try {
      var idePassword = idePasswordHeader();
      if (!idePassword) throw new Error('Inicia sesión en AGY antes de cambiar la ruta.');
      var response = await fetch('/api/notebooklm/routing', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': idePassword },
        body: JSON.stringify({ route: event.target.value }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'No se pudo cambiar la ruta.');
      root.querySelector('[data-route-status]').textContent =
        data.status || data.message || data.actualRoute || data.route || 'Ruta actualizada.';
    } catch (error) {
      root.querySelector('[data-route-status]').textContent = error.message;
    }
  }
  async function loadRoutingStatus() {
    var box = root.querySelector('[data-route-status]');
    var idePassword = idePasswordHeader();
    if (!idePassword) { box.textContent = 'Inicia sesión en AGY para consultar la ruta.'; return; }
    try {
      var ready = await fetch(API + '/ready', {
        credentials: 'same-origin',
        headers: { 'x-agyide-pwd': idePassword },
      });
      var readyData = await ready.json().catch(function () { return {}; });
      if (!ready.ok) throw new Error(readyData.error || 'Cloud no configurado.');
      var response = await fetch('/api/notebooklm/routing', {
        credentials: 'same-origin',
        headers: { 'x-agyide-pwd': idePassword },
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la ruta.');
      var actual = data.actualRoute || data.route || data.preference;
      if (actual && /^(auto|cloud|pc2)$/.test(actual)) {
        root.querySelector('.nlm-cloud-routing select').value = actual;
      }
      box.textContent = data.status || data.message ||
        (actual ? 'Ruta actual: ' + actual : (data.ready ? 'Ruta lista.' : 'Sesión requerida.'));
    } catch (error) {
      box.textContent = error.message;
    }
  }
  async function launch(event) {
    event.preventDefault();
    password = root.querySelector('[data-admin-password]').value;
    if (!password) return status('Escribe tu contraseña AGY actual.', 'error');
    if (!root.querySelector('[data-human-confirm]').checked) {
      return status('Confirma que abrirás Google personalmente.', 'error');
    }
    status('Iniciando entorno aislado…');
    try {
      var data = await call('/session', {
        headers: { 'x-agyide-pwd': password },
        body: JSON.stringify({ confirmed: true }),
      });
      csrf = data.csrf;
      expiresAt = Date.now() + data.expires_in * 1000;
      root.querySelector('[data-admin-password]').value = '';
      password = '';
      root.querySelector('[data-login-form]').hidden = true;
      root.querySelector('[data-desktop-panel]').hidden = false;
      await connectDesktop();
      timer = window.setInterval(countdown, 1000);
      countdown();
    } catch (error) {
      password = '';
      status(error.message, 'error');
    }
  }
  async function connectDesktop() {
    await call('/desktop-access', { body: '{}' });
    var RFB = (await import('/notebooklm-novnc/core/rfb.js')).default;
    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var screen = root.querySelector('[data-vnc-screen]');
    screen.replaceChildren();
    rfb = new RFB(screen, scheme + '//' + location.host + API + '/desktop', {
      credentials: {},
      shared: false,
      repeaterID: '',
    });
    rfb.clipViewport = true;
    rfb.scaleViewport = true;
    rfb.viewOnly = false;
    rfb.addEventListener('connect', function () {
      status('Escritorio privado listo. Completa el acceso de Google manualmente.', 'ok');
    });
    rfb.addEventListener('disconnect', function (event) {
      if (csrf && !event.detail.clean) status('El escritorio remoto se desconectó.', 'error');
    });
  }
  async function revoke(closePanel) {
    if (timer) window.clearInterval(timer);
    timer = null;
    if (rfb) { try { rfb.disconnect(); } catch (_) {} }
    rfb = null;
    if (csrf) {
      try { await call('/revoke', { body: '{}' }); } catch (_) {}
    }
    csrf = ''; password = ''; expiresAt = 0;
    if (root) {
      root.querySelector('[data-login-form]').hidden = false;
      root.querySelector('[data-desktop-panel]').hidden = true;
      countdown();
      if (closePanel) root.hidden = true;
    }
  }
  async function finish() {
    status('Validando la sesión guardada en cloud…');
    try {
      var data = await call('/finish', { body: '{}' });
      csrf = '';
      await revoke(false);
      status(data.hub_ready
        ? 'Sesión de Google guardada en cloud. NotebookLM está listo.'
        : 'El acceso terminó, pero la sesión cloud aún requiere atención.',
      data.hub_ready ? 'ok' : 'error');
    } catch (error) {
      csrf = '';
      await revoke(false);
      status(error.message, 'error');
    }
  }
  function build() {
    root = node('section', { id: 'notebooklm-cloud-admin', className: 'nlm-cloud-admin', role: 'dialog', 'aria-modal': 'true', hidden: '' });
    var card = node('div', { className: 'nlm-cloud-card' });
    var close = node('button', { type: 'button', className: 'nlm-cloud-close', 'aria-label': 'Cerrar y revocar acceso', onclick: function () { revoke(true); } }, '×');
    card.append(close, node('p', { className: 'nlm-cloud-kicker' }, 'AGY · ACCESO ADMINISTRATIVO PRIVADO'),
      node('h2', {}, 'Conectar Google a NotebookLM cloud'),
      node('p', { className: 'nlm-cloud-privacy' }, 'Tú controlas este escritorio. AGY no registra la pantalla, las teclas ni tus credenciales. La sesión de Google se guarda cifrada en el entorno cloud aislado; no se copia desde PC2.'));
    var routing = node('div', { className: 'nlm-cloud-routing' });
    var select = node('select', { 'aria-label': 'Ruta NotebookLM', onchange: routeChanged });
    [['auto', 'Automática'], ['cloud', 'Cloud'], ['pc2', 'PC2']].forEach(function (entry) {
      select.appendChild(node('option', { value: entry[0] }, entry[1]));
    });
    routing.append(node('label', {}, 'Ruta de trabajo '), select, node('span', { 'data-route-status': '', role: 'status' }, 'Selecciona auto, cloud o PC2.'));
    card.appendChild(routing);
    var form = node('form', { 'data-login-form': '', className: 'nlm-cloud-form', onsubmit: launch });
    form.append(node('label', {}, 'Contraseña AGY actual'),
      node('input', { type: 'password', autocomplete: 'current-password', 'data-admin-password': '', required: '' }),
      node('label', { className: 'nlm-cloud-consent' }, ''),
      node('button', { type: 'submit' }, 'Abrir ventana privada de Google'));
    var consent = form.querySelector('.nlm-cloud-consent');
    consent.append(node('input', { type: 'checkbox', 'data-human-confirm': '', required: '' }),
      document.createTextNode(' Confirmo que iniciaré sesión personalmente y que el acceso dura como máximo 5 minutos.'));
    var desktop = node('div', { 'data-desktop-panel': '', hidden: '' });
    desktop.append(node('div', { 'data-vnc-screen': '', className: 'nlm-vnc-screen', 'aria-label': 'Escritorio remoto privado de Google' }),
      node('div', { className: 'nlm-cloud-actions' },
        ), node('p', {}, 'Cuando Google esté abierto y NotebookLM funcione, pulsa Terminar. Cerrar revoca el escritorio sin guardar cambios nuevos.'));
    var done = node('button', { type: 'button', onclick: finish }, '✓ Terminé · guardar sesión cloud');
    var cancel = node('button', { type: 'button', className: 'secondary', onclick: function () { revoke(false); } }, 'Cerrar y revocar');
    desktop.querySelector('.nlm-cloud-actions').append(done, cancel);
    card.append(form, desktop, node('div', { 'data-cloud-status': '', className: 'nlm-cloud-status', role: 'status', 'aria-live': 'polite' }, 'Esperando autorización.'),
      node('div', { 'data-cloud-ttl': '', className: 'nlm-cloud-ttl' }, 'Sin sesión administrativa'));
    root.appendChild(card);
    document.body.appendChild(root);
    window.addEventListener('pagehide', function () {
      if (csrf) navigator.sendBeacon(API + '/revoke', new Blob(['{}'], { type: 'application/json' }));
    });
  }
  function open() {
    if (!root) build();
    root.hidden = false;
    loadRoutingStatus();
    root.querySelector('[data-admin-password]').focus();
  }
  window.NotebookLMCloudAdmin = { open: open, close: function () { return revoke(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
}());