(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof globalThis === 'object' ? globalThis : {});
  else root.PC2Terminal = factory(root);
})(typeof window === 'object' ? window : this, function (root) {
  'use strict';
  var MAX_MS = 90 * 1000;
  var INTERVAL_MS = 2000;
  var TARGETS = {
    PC2: {
      key: 'PC2',
      storageKey: 'agyide.pc2.console.pending-id',
      title: 'Consola PC2 — Railway',
      titleId: 'pc2-console-title',
      commandName: 'pc2-command',
      endpoint: '/api/pc-command',
      statusText: 'Listo: no se ejecuta nada al abrir.',
      description: 'Consola de comandos no interactiva. Cada comando se ejecuta por separado; no hay PTY, stdin ni directorio de trabajo persistente.',
      help: 'Para cambiar de carpeta y ejecutar algo en la misma orden usa: cd ruta && comando.',
      shortcuts: [['pwd', 'pwd'], ['ls -la', 'ls -la'], ['hostname && uptime -p', 'hostname && uptime -p']]
    },
    PC3: {
      key: 'PC3',
      storageKey: 'agyide.pc3.console.pending-id',
      title: 'Consola PC3 Miami — Windows',
      titleId: 'pc3-console-title',
      commandName: 'pc3-command',
      endpoint: '/api/pc3-console/commands',
      statusText: 'Comprobando estado de PC3…',
      description: 'Consola de comandos no interactiva de Windows. Cada comando se ejecuta por separado; no hay PTY, stdin ni directorio de trabajo persistente.',
      help: 'Para cambiar de carpeta y ejecutar algo en la misma orden usa: cd ruta && comando.',
      shortcuts: [['hostname', 'hostname'], ['dir', 'dir'], ['ver', 'ver']]
    }
  };
  var STORAGE_KEY = TARGETS.PC2.storageKey;
  var PC3_STORAGE_KEY = TARGETS.PC3.storageKey;
  var instances = typeof WeakMap === 'function' ? new WeakMap() : null;
  function targetFor(options) {
    var requested = options && options.target != null ? String(options.target).toUpperCase() : 'PC2';
    return TARGETS[requested] || TARGETS.PC2;
  }
  function documentFor(options, output) {
    return options.document || (output && output.ownerDocument) || (root && root.document);
  }
  function storageFor(options) {
    if (options && options.sessionStorage) return options.sessionStorage;
    try { return root && root.sessionStorage; } catch (_) { return null; }
  }
  function readPending(storage, key) {
    try {
      var id = storage && storage.getItem(key || STORAGE_KEY);
      return typeof id === 'string' && id.trim() ? id.trim() : '';
    } catch (_) { return ''; }
  }
  function savePending(storage, key, id) {
    try { if (storage) storage.setItem(key || STORAGE_KEY, id); } catch (_) {}
  }
  function removePending(storage, key) {
    try { if (storage) storage.removeItem(key || STORAGE_KEY); } catch (_) {}
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
    var pending = !!readPending(record.storage, record.config.storageKey) || (!!record.lastId && !record.terminal);
    var offline = record.config.key === 'PC3' && (!record.statusKnown || record.offline);
    record.input.disabled = pending || record.queryBusy || offline;
    record.send.disabled = pending || record.queryBusy || offline;
    record.check.disabled = !record.lastId || record.queryBusy;
    setDisplay(record.check, record.lastId ? 'inline-block' : 'none');
    if (record.refresh) {
      record.refresh.disabled = !!record.statusBusy;
      setDisplay(record.refresh, 'inline-block');
    }
    if (record.queryBusy) record.send.textContent = 'Enviando…';
    else record.send.textContent = 'Enviar';
  }
  function focusInput(record) {
    if (record.input && typeof record.input.focus === 'function' && !record.input.disabled) record.input.focus();
  }
  function commandInput(record, command) {
    record.input.value = command;
    setBanner(record, 'Comando preparado. Pulsa Enviar para ejecutarlo en ' + record.config.key + '.', 'info');
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
    removePending(record.storage, record.config.storageKey);
    setControls(record);
    if (String(data.status).toLowerCase() === 'done') {
      setBanner(record, '✅ Orden terminada.', 'success');
      addLog(record, data && data.result != null && String(data.result) ? String(data.result) : '(' + record.config.key + ' no devolvió salida de texto)');
    } else {
      setBanner(record, '❌ La orden terminó con error.', 'error');
      addLog(record, 'Error de ejecución en ' + record.config.key + ': ' + messageFor(data, 'la orden terminó con error'));
    }
  }
  async function postCommand(record, command) {
    var config = record.config;
    var response;
    try {
      if (config.key === 'PC3') {
        response = await fetchFor(record.options)(config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' },
          body: JSON.stringify({ command: command })
        });
      } else {
        response = await fetchFor(record.options)('/api/pc-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' },
          body: JSON.stringify({ text: '/pc2 ' + command })
        });
      }
    } catch (error) {
      throw new Error('No fue posible enviar la orden a ' + config.key + ': ' + (error && error.message || error));
    }
    var data = await jsonFor(response);
    if (response && response.status === 503 && config.key === 'PC3') {
      record.statusKnown = true;
      record.offline = true;
      setControls(record);
      throw new Error('PC3 disconnected: ' + messageFor(data, 'el equipo está offline'));
    }
    if (!responseOK(response)) throw errorFor(response, data, 'No fue posible enviar la orden a ' + config.key);
    if (data && data.ok === false) throw new Error('Error de ejecución en ' + config.key + ': ' + messageFor(data, 'la orden fue rechazada'));
    if (!data || typeof data.id !== 'string' || !data.id.trim()) throw new Error(config.key + ' no devolvió un ID de tarea; la orden no se puede consultar.');
    return data.id.trim();
  }
  async function pollStatus(record, id) {
    var config = record.config;
    var fetchFunction = fetchFor(record.options);
    var maxMs = Number.isFinite(record.options.maxMs) ? Math.min(MAX_MS, Math.max(0, record.options.maxMs)) : MAX_MS;
    var intervalMs = Number.isFinite(record.options.intervalMs) ? Math.max(0, record.options.intervalMs) : INTERVAL_MS, started = now(record.options), wait = delayFor(record.options);
    while (now(record.options) - started < maxMs) {
      var response;
      try {
        var url = config.key === 'PC3'
          ? config.endpoint + '/' + encodeURIComponent(id)
          : '/api/status/' + encodeURIComponent(id) + '?target=PC2';
        response = await fetchFunction(url, {
          method: 'GET',
          headers: { 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' }
        });
      } catch (error) {
        throw new Error('No fue posible consultar el estado de ' + config.key + ': ' + (error && error.message || error));
      }
      var data = await jsonFor(response);
      if (!responseOK(response) || (data && data.ok === false)) throw errorFor(response, data, 'No fue posible consultar el estado de ' + config.key);
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
        savePending(record.storage, record.config.storageKey, id);
        addLog(record, '📤 Orden enviada a ' + record.config.key + ' (' + id + ')');
      } else {
        record.lastId = id;
        savePending(record.storage, record.config.storageKey, id);
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
          savePending(record.storage, record.config.storageKey, id);
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
  async function refreshStatus(record) {
    if (record.config.key !== 'PC3' || record.statusBusy) return !record.offline;
    record.statusBusy = true;
    setBanner(record, 'Comprobando estado de PC3…', 'info');
    setControls(record);
    try {
      var response = await fetchFor(record.options)('/api/pc3-console/status', {
        method: 'GET',
        headers: { 'x-agyide-pwd': typeof record.options.getPwd === 'function' ? record.options.getPwd() : '' }
      });
      var data = await jsonFor(response);
      if (!responseOK(response)) throw errorFor(response, data, 'No fue posible consultar el estado de PC3');
      record.statusKnown = true;
      record.offline = !(data && data.ok !== false && data.online === true && data.connected === true);
      if (record.offline) {
        setBanner(record, 'PC3 disconnected' + (messageFor(data, '') ? ': ' + messageFor(data, '') : '.'), 'error');
      } else {
        setBanner(record, 'PC3 online — conectado.', 'success');
      }
    } catch (error) {
      record.statusKnown = true;
      record.offline = true;
      setBanner(record, 'PC3 disconnected: ' + (error && error.message || error), 'error');
    } finally {
      record.statusBusy = false;
      setControls(record);
    }
    return !record.offline;
  }
  function createConsole(options) {
    var config = targetFor(options);
    var output = options.output;
    var doc = documentFor(options, output);
    if (!doc || typeof doc.createElement !== 'function') return null;
    installStyles(doc);
    var record = {
      options: options,
      config: config,
      output: output,
      document: doc,
      storage: storageFor(options),
      lines: [],
      lastId: '',
      terminal: false,
      queryBusy: false,
      statusKnown: config.key !== 'PC3',
      offline: false,
      statusBusy: false
    };
    var panel = makeNode(doc, 'section', null, 'pc2-console ' + config.key.toLowerCase() + '-console');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', config.titleId);
    var heading = makeNode(doc, 'h2', config.title);
    heading.id = config.titleId;
    panel.appendChild(heading);
    var close = makeNode(doc, 'button', 'Cerrar', 'pc2-console-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar consola ' + config.key);
    heading.appendChild(close);
    panel.appendChild(makeNode(doc, 'p', config.description, 'pc2-console-notice'));
    panel.appendChild(makeNode(doc, 'p', config.help + ' Cerrar esta vista no cancela una orden en ' + config.key + '.', 'pc2-console-help'));
    var form = makeNode(doc, 'form');
    var input = makeNode(doc, 'input');
    input.type = 'text';
    input.name = config.commandName;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Escribe un comando de una sola línea…';
    input.setAttribute('aria-label', 'Comando para ' + config.key);
    var send = makeNode(doc, 'button', 'Enviar');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(form);
    var shortcuts = makeNode(doc, 'div', null, 'pc2-console-shortcuts');
    shortcuts.setAttribute('aria-label', 'Atajos explícitos de ' + config.key);
    config.shortcuts.forEach(function (item) {
      var shortcut = makeNode(doc, 'button', item[0]);
      shortcut.type = 'button';
      shortcut.setAttribute('aria-label', 'Preparar ' + item[1]);
      shortcut.addEventListener('click', function () { commandInput(record, item[1]); });
      shortcuts.appendChild(shortcut);
    });
    panel.appendChild(shortcuts);
    var status = makeNode(doc, 'div', config.statusText, 'pc2-console-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var log = makeNode(doc, 'pre', null, 'pc2-console-log');
    log.setAttribute('aria-label', 'Salida de la consola ' + config.key);
    panel.appendChild(status);
    panel.appendChild(log);
    var actions = makeNode(doc, 'div', null, 'pc2-console-actions');
    var check = makeNode(doc, 'button', 'Consultar estado de nuevo');
    check.type = 'button';
    var refresh = null;
    if (config.key === 'PC3') {
      refresh = makeNode(doc, 'button', 'Actualizar estado de PC3');
      refresh.type = 'button';
      refresh.setAttribute('aria-label', 'Actualizar estado de PC3');
      actions.appendChild(refresh);
    }
    var clear = makeNode(doc, 'button', 'Limpiar salida');
    clear.type = 'button';
    actions.appendChild(check);
    actions.appendChild(clear);
    panel.appendChild(actions);
    record.panel = panel; record.form = form; record.input = input; record.send = send; record.check = check; record.refresh = refresh; record.clear = clear; record.status = status; record.log = log; record.button = options.button;
    close.addEventListener('click', function () { closeConsole(record); });
    clear.addEventListener('click', function () { clearConsole(record); });
    check.addEventListener('click', function () { return execute(record, '', record.lastId); });
    if (refresh) refresh.addEventListener('click', function () { return refreshStatus(record); });
    function submitCommand(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      var command = String(input.value || '');
      if (record.queryBusy || readPending(record.storage, record.config.storageKey) || (record.lastId && !record.terminal)) return;
      if (record.config.key === 'PC3' && (!record.statusKnown || record.offline)) {
        setBanner(record, 'PC3 disconnected. Actualiza el estado antes de enviar.', 'error');
        return;
      }
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
  async function launch(options) {
    options = options || {};
    var config = targetFor(options);
    var output = options.output;
    var targetInstances = output && instances ? instances.get(output) : null;
    var record = targetInstances ? targetInstances.get(config.key) : null;
    if (!record) {
      record = createConsole(options);
      if (output && instances && record) {
        if (!targetInstances) {
          targetInstances = new Map();
          instances.set(output, targetInstances);
        }
        targetInstances.set(config.key, record);
      }
    } else {
      record.options = options;
      record.storage = storageFor(options);
      record.button = options.button;
    }
    if (!record) return Promise.resolve(null);
    var parent = record.output || (record.document && record.document.body);
    if (record.panel.parentNode !== parent && parent) parent.appendChild(record.panel);
    if (config.key === 'PC3') await refreshStatus(record);
    var pending = readPending(record.storage, record.config.storageKey);
    if (pending) showPending(record, pending);
    else setControls(record);
    if (!pending && !(record.config.key === 'PC3' && record.offline)) focusInput(record);
    return record;
  }
  return {
    launch: launch,
    DEFAULT_MAX_MS: MAX_MS,
    DEFAULT_INTERVAL_MS: INTERVAL_MS,
    STORAGE_KEY: STORAGE_KEY,
    PC3_STORAGE_KEY: PC3_STORAGE_KEY,
    STORAGE_KEYS: { PC2: STORAGE_KEY, PC3: PC3_STORAGE_KEY }
  };
});