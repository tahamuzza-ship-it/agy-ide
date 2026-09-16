(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof globalThis === 'object' ? globalThis : {});
  else root.PC2Terminal = factory(root);
})(typeof window === 'object' ? window : this, function (root) {
  'use strict';
  var MAX_MS = 90 * 1000;
  var INTERVAL_MS = 2000;
  var STORAGE_KEY = 'agyide.pc2.console.pending-id';
  var instances = typeof WeakMap === 'function' ? new WeakMap() : null;
  function documentFor(options, output) {
    return options.document || (output && output.ownerDocument) || (root && root.document);
  }
  function storageFor(options) {
    if (options && options.sessionStorage) return options.sessionStorage;
    try { return root && root.sessionStorage; } catch (_) { return null; }
  }
  function readPending(storage) {
    try {
      var id = storage && storage.getItem(STORAGE_KEY);
      return typeof id === 'string' && id.trim() ? id.trim() : '';
    } catch (_) { return ''; }
  }
  function savePending(storage, id) {
    try { if (storage) storage.setItem(STORAGE_KEY, id); } catch (_) {}
  }
  function removePending(storage) {
    try { if (storage) storage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  function now(options) {
    return options && typeof options.now === 'function' ? options.now() : Date.now();
  }
  function delayFor(options) {
    if (options && typeof options.delay === 'function') return options.delay;
    return function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  }
  function fetchFor(options) {
    if (options && typeof options.fetch === 'function') return options.fetch;
    if (root && typeof root.fetch === 'function') return root.fetch.bind(root);
    if (typeof fetch === 'function') return fetch;
    throw new Error('No hay una función fetch disponible para la consola PC2.');
  }
  function responseOK(response) {
    return !!response && (typeof response.ok === 'boolean'
      ? response.ok : response.status >= 200 && response.status < 300);
  }
  async function jsonFor(response) {
    try { return response && typeof response.json === 'function' ? await response.json() : {}; }
    catch (_) { return {}; }
  }
  function messageFor(data, fallback) {
    if (data && typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (data && typeof data.result === 'string' && data.result.trim()) return data.result.trim();
    return fallback;
  }
  function errorFor(response, data, operation) {
    var status = response && response.status ? ' (HTTP ' + response.status + ')' : '';
    if (response && response.status === 401) return new Error('No autorizado: la sesión de AGYIDE no es válida.');
    return new Error(operation + status + ': ' + messageFor(data, 'respuesta HTTP no válida'));
  }
  function makeNode(doc, tag, text, className) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function setDisplay(node, value) {
    if (node && node.style) node.style.display = value;
  }
  function installStyles(doc) {
    if (!doc || !doc.createElement || !doc.head || doc.__agyPc2Styles) return;
    var style = makeNode(doc, 'style');
    style.textContent =
      '.pc2-console{box-sizing:border-box;margin:12px 0;padding:16px;border:1px solid rgba(0,243,255,.35);border-radius:12px;background:rgba(7,12,26,.96);color:#e0e8ff;font:14px Inter,system-ui,sans-serif;max-width:760px;box-shadow:0 8px 28px rgba(0,0,0,.28)}' +
      '.pc2-console *{box-sizing:border-box}.pc2-console h2{margin:0;color:#00f3ff;font-size:1rem}.pc2-console p{margin:8px 0;color:#a9b8cc;line-height:1.45}.pc2-console-notice{padding:9px 10px;border-left:3px solid #00f3ff;background:rgba(0,243,255,.07)}' +
      '.pc2-console form,.pc2-console-actions,.pc2-console-shortcuts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.pc2-console input{min-width:0;flex:1 1 260px;padding:10px;border:1px solid #45617b;border-radius:7px;background:#0c1628;color:#fff;font:14px ui-monospace,monospace}.pc2-console button{padding:9px 12px;border:1px solid #3c6d85;border-radius:7px;background:#102d43;color:#e0f7ff;cursor:pointer;font-weight:600}.pc2-console button:hover{background:#164765}.pc2-console button:disabled{cursor:not-allowed;opacity:.5}.pc2-console-status,.pc2-console-log{display:block;min-height:1.4em;margin-top:12px;padding:10px;white-space:pre-wrap;overflow:auto;border-radius:7px;background:#050b14;color:#b9f6ff;font:13px/1.45 ui-monospace,SFMono-Regular,monospace}.pc2-console-log{max-height:230px;color:#d5ddeb}.pc2-console-close{margin-left:auto!important;background:transparent!important}.pc2-console-shortcuts button{font-size:.8rem}.pc2-console-help{font-size:.82rem!important}.pc2-console:focus-within{outline:2px solid rgba(0,243,255,.25);outline-offset:2px}@media(max-width:600px){.pc2-console{margin:8px 0;padding:12px}.pc2-console form>*{flex:1 1 100%}.pc2-console-actions button{flex:1 1 40%}}';
    doc.head.appendChild(style);
    doc.__agyPc2Styles = true;
  }
  function setBanner(record, text, kind) {
    record.status.textContent = text;
    record.status.className = 'pc2-console-status pc2-console-' + (kind || 'info');
  }
  function addLog(record, text) {
    if (!text) return;
    record.lines.push(String(text));
    record.log.textContent = record.lines.join('\n');
    if (typeof record.log.scrollHeight === 'number') record.log.scrollTop = record.log.scrollHeight;
  }
  function setControls(record) {
    var pending = !!readPending(record.storage) || (!!record.lastId && !record.terminal);
    record.input.disabled = pending || record.queryBusy;
    record.send.disabled = pending || record.queryBusy;
    record.check.disabled = !record.lastId || record.queryBusy;
    setDisplay(record.check, record.lastId ? 'inline-block' : 'none');
    if (record.queryBusy) record.send.textContent = 'Enviando…';
    else record.send.textContent = 'Enviar';
  }
  function focusInput(record) {
    if (record.input && typeof record.input.focus === 'function' && !record.input.disabled) record.input.focus();
  }
  function commandInput(record, command) {
    record.input.value = command;
    setBanner(record, 'Comando preparado. Pulsa Enviar para ejecutarlo en PC2.', 'info');
    focusInput(record);
  }
  function closeConsole(record) {
    if (record.panel && record.panel.parentNode) record.panel.parentNode.removeChild(record.panel);
    if (record.button && typeof record.button.focus === 'function') record.button.focus();
  }
  function clearConsole(record) {
    record.lines = [];
    record.log.textContent = '';
    setBanner(record, 'Salida limpiada.', 'info');
  }
  function showPending(record, id) {
    record.lastId = id || record.lastId;
    record.terminal = false;
    if (record.lastId) {
      setBanner(record, 'Hay una orden pendiente (' + record.lastId + '). Consultar estado no la vuelve a enviar.', 'pending');
      addLog(record, '⏳ Estado pendiente: ' + record.lastId);
    }
    setControls(record);
  }
  function terminalResult(record, id, data) {
    record.lastId = id;
    record.terminal = true;
    removePending(record.storage);
    setControls(record);
    if (String(data.status).toLowerCase() === 'done') {
      setBanner(record, '✅ Orden terminada.', 'success');
      addLog(record, data && data.result != null && String(data.result) ? String(data.result) : '(PC2 no devolvió salida de texto)');
    } else {
      setBanner(record, '❌ La orden terminó con error.', 'error');
      addLog(record, 'Error de ejecución en PC2: ' + messageFor(data, 'la orden terminó con error'));
    }
  }
  async function postCommand(record, command) {
    var response;
    try {
      response = await fetchFor(record.options)('/api/pc-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' },
        body: JSON.stringify({ text: '/pc2 ' + command })
      });
    } catch (error) {
      throw new Error('No fue posible enviar la orden a PC2: ' + (error && error.message || error));
    }
    var data = await jsonFor(response);
    if (!responseOK(response)) throw errorFor(response, data, 'No fue posible enviar la orden a PC2');
    if (data && data.ok === false) throw new Error('Error de ejecución en PC2: ' + messageFor(data, 'la orden fue rechazada'));
    if (!data || typeof data.id !== 'string' || !data.id.trim()) throw new Error('PC2 no devolvió un ID de tarea; la orden no se puede consultar.');
    return data.id.trim();
  }
  async function pollStatus(record, id) {
    var fetchFunction = fetchFor(record.options);
    var maxMs = Number.isFinite(record.options.maxMs) ? Math.min(MAX_MS, Math.max(0, record.options.maxMs)) : MAX_MS;
    var intervalMs = Number.isFinite(record.options.intervalMs) ? Math.max(0, record.options.intervalMs) : INTERVAL_MS, started = now(record.options), wait = delayFor(record.options);
    while (now(record.options) - started < maxMs) {
      var response;
      try {
        response = await fetchFunction('/api/status/' + encodeURIComponent(id) + '?target=PC2', {
          method: 'GET',
          headers: { 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' }
        });
      } catch (error) {
        throw new Error('No fue posible consultar el estado de PC2: ' + (error && error.message || error));
      }
      var data = await jsonFor(response);
      if (!responseOK(response) || (data && data.ok === false)) throw errorFor(response, data, 'No fue posible consultar el estado de PC2');
      if (now(record.options) - started >= maxMs) {
        throw new Error('Tiempo de espera agotado (' + Math.round(maxMs / 1000) + ' segundos). Puedes consultar estado de nuevo.');
      }
      var status = String(data && data.status || '').toLowerCase();
      addLog(record, 'Estado: ' + (status || 'desconocido'));
      if (status === 'done') return data;
      if (status === 'error' || status === 'failed' || status === 'cancelled') {
        var terminalError = new Error(messageFor(data, 'la orden terminó con error'));
        terminalError.terminal = true;
        terminalError.data = data;
        throw terminalError;
      }
      var remaining = maxMs - (now(record.options) - started);
      if (remaining <= 0) break;
      await wait(Math.min(intervalMs, remaining));
    }
    throw new Error('Tiempo de espera agotado (' + Math.round(maxMs / 1000) + ' segundos). Puedes consultar estado de nuevo.');
  }
  async function execute(record, command, existingId) {
    if (record.queryBusy) return;
    record.queryBusy = true;
    record.terminal = false;
    setControls(record);
    var id = existingId || '';
    try {
      if (!id) {
        id = await postCommand(record, command);
        record.lastId = id;
        savePending(record.storage, id);
        addLog(record, '📤 Orden enviada a PC2 (' + id + ')');
      } else {
        record.lastId = id;
        savePending(record.storage, id);
        setBanner(record, 'Consultando estado de ' + id + '…', 'pending');
      }
      var data = await pollStatus(record, id);
      terminalResult(record, id, data);
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      if (id) {
        record.lastId = id;
        if (error && error.terminal && error.data) terminalResult(record, id, error.data);
        else {
          savePending(record.storage, id);
          record.terminal = false;
          setBanner(record, '⚠️ ' + message + ' Pulsa «Consultar estado» para reintentar; no se enviará otra orden.', 'error');
          addLog(record, message);
          setControls(record);
        }
      } else {
        setBanner(record, '❌ ' + message, 'error');
        addLog(record, message);
        setControls(record);
      }
    } finally {
      record.queryBusy = false;
      setControls(record);
    }
  }
  function createConsole(options) {
    var output = options.output;
    var doc = documentFor(options, output);
    if (!doc || typeof doc.createElement !== 'function') return null;
    installStyles(doc);
    var record = { options: options, output: output, document: doc, storage: storageFor(options), lines: [], lastId: '', terminal: false, queryBusy: false };
    var panel = makeNode(doc, 'section', null, 'pc2-console');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'pc2-console-title');
    var heading = makeNode(doc, 'h2', 'Consola PC2 — Railway');
    heading.id = 'pc2-console-title';
    panel.appendChild(heading);
    var close = makeNode(doc, 'button', 'Cerrar', 'pc2-console-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar consola PC2');
    heading.appendChild(close);
    panel.appendChild(makeNode(doc, 'p', 'Consola de comandos no interactiva. Cada comando se ejecuta por separado; no hay PTY, stdin ni directorio de trabajo persistente.', 'pc2-console-notice'));
    panel.appendChild(makeNode(doc, 'p', 'Para cambiar de carpeta y ejecutar algo en la misma orden usa: cd ruta && comando. Cerrar esta vista no cancela una orden en PC2.', 'pc2-console-help'));
    var form = makeNode(doc, 'form');
    var input = makeNode(doc, 'input');
    input.type = 'text';
    input.name = 'pc2-command';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Escribe un comando de una sola línea…';
    input.setAttribute('aria-label', 'Comando para PC2');
    var send = makeNode(doc, 'button', 'Enviar');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(form);
    var shortcuts = makeNode(doc, 'div', null, 'pc2-console-shortcuts');
    shortcuts.setAttribute('aria-label', 'Atajos explícitos');
    [['pwd', 'pwd'], ['ls -la', 'ls -la'], ['hostname && uptime -p', 'hostname && uptime -p']].forEach(function (item) {
      var shortcut = makeNode(doc, 'button', item[0]);
      shortcut.type = 'button';
      shortcut.setAttribute('aria-label', 'Preparar ' + item[1]);
      shortcut.addEventListener('click', function () { commandInput(record, item[1]); });
      shortcuts.appendChild(shortcut);
    });
    panel.appendChild(shortcuts);
    var status = makeNode(doc, 'div', 'Listo: no se ejecuta nada al abrir.', 'pc2-console-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var log = makeNode(doc, 'pre', null, 'pc2-console-log');
    log.setAttribute('aria-label', 'Salida de la consola PC2');
    panel.appendChild(status);
    panel.appendChild(log);
    var actions = makeNode(doc, 'div', null, 'pc2-console-actions');
    var check = makeNode(doc, 'button', 'Consultar estado de nuevo');
    check.type = 'button';
    var clear = makeNode(doc, 'button', 'Limpiar salida');
    clear.type = 'button';
    actions.appendChild(check);
    actions.appendChild(clear);
    panel.appendChild(actions);
    record.panel = panel; record.form = form; record.input = input; record.send = send; record.check = check; record.clear = clear; record.status = status; record.log = log; record.button = options.button;
    close.addEventListener('click', function () { closeConsole(record); });
    clear.addEventListener('click', function () { clearConsole(record); });
    check.addEventListener('click', function () { return execute(record, '', record.lastId); });
    function submitCommand(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      var command = String(input.value || '');
      if (record.queryBusy || readPending(record.storage) || (record.lastId && !record.terminal)) return;
      if (!command.trim()) { setBanner(record, 'Escribe un comando antes de enviarlo.', 'error'); return; }
      if (/[\r\n]/.test(command)) { setBanner(record, 'Solo se permite una línea por comando.', 'error'); return; }
      input.value = command.trim();
      return execute(record, input.value, '');
    }
    form.addEventListener('submit', submitCommand);
    send.addEventListener('click', submitCommand);
    input.addEventListener('paste', function (event) {
      var text = event && event.clipboardData && event.clipboardData.getData ? event.clipboardData.getData('text') : '';
      if (/[\r\n]/.test(text)) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        setBanner(record, 'Pegado rechazado: solo se permite una línea por comando.', 'error');
      }
    });
    input.addEventListener('input', function () {
      if (/[\r\n]/.test(String(input.value || ''))) {
        input.value = String(input.value || '').replace(/[\r\n]/g, '');
        setBanner(record, 'Solo se permite una línea por comando.', 'error');
      }
    });
    input.addEventListener('keydown', function (event) {
      if (event && event.key === 'Enter') {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent && form.dispatchEvent({ type: 'submit', preventDefault: function () {} });
      }
    });
    return record;
  }
  function launch(options) {
    options = options || {};
    var output = options.output;
    var record = output && instances ? instances.get(output) : null;
    if (!record) {
      record = createConsole(options);
      if (output && instances && record) instances.set(output, record);
    } else {
      record.options = options;
      record.storage = storageFor(options);
      record.button = options.button;
    }
    if (!record) return Promise.resolve(null);
    var parent = record.output || (record.document && record.document.body);
    if (record.panel.parentNode !== parent && parent) parent.appendChild(record.panel);
    var pending = readPending(record.storage);
    if (pending) showPending(record, pending);
    else setControls(record);
    if (!pending) focusInput(record);
    return Promise.resolve(record);
  }
  return {
    launch: launch,
    DEFAULT_MAX_MS: MAX_MS,
    DEFAULT_INTERVAL_MS: INTERVAL_MS,
    STORAGE_KEY: STORAGE_KEY
  };
});