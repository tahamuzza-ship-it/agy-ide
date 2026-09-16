(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis === 'object' ? globalThis : {});
  } else {
    root.PC2Terminal = factory(root);
  }
})(typeof window === 'object' ? window : this, function (root) {
  'use strict';

  var TAILSCALE_FIRST_OCTET = 100;
  var TAILSCALE_SECOND_MIN = 64;
  var TAILSCALE_SECOND_MAX = 127;
  var DEFAULT_MAX_MS = 60 * 1000;
  var DEFAULT_INTERVAL_MS = 2 * 1000;
  var activePromise = null;

  /*
   * The executor receives one shell line. The base64 payload only preserves
   * the recipe's shell syntax while it crosses the EJECUTAR instruction.
   */
  var SAFE_LAUNCHER_B64 = 'c2V0IC1ldQpjb21tYW5kIC12IHRhaWxzY2FsZSA+L2Rldi9udWxsIDI+JjEgfHwgeyBlY2hvICJUYWlsc2NhbGUgbm8gZXN0w6EgZGlzcG9uaWJsZSBlbiBQQzIiID4mMjsgZXhpdCAxOyB9CmNvbW1hbmQgLXYgY3VybCA+L2Rldi9udWxsIDI+JjEgfHwgeyBlY2hvICJjdXJsIGVzIG9ibGlnYXRvcmlvIHBhcmEgY29tcHJvYmFyIGxhIHRlcm1pbmFsIiA+JjI7IGV4aXQgMTsgfQppcD0iJCh0YWlsc2NhbGUgaXAgLTQgMj4vZGV2L251bGwgfCBhd2sgJ05GIHsgcHJpbnQgJDE7IGV4aXQgfScpIgpbIC1uICIkaXAiIF0gfHwgeyBlY2hvICJUYWlsc2NhbGUgbm8gZGV2b2x2acOzIHVuYSBJUHY0IHBhcmEgUEMyIiA+JjI7IGV4aXQgMTsgfQp2YWxpZF9pcD0iJChwcmludGYgJyVzXG4nICIkaXAiIHwgYXdrIC1GLiAnTkYgPT0gNCAmJiAkMSB+IC9eWzAtOV0rJC8gJiYgJDIgfiAvXlswLTldKyQvICYmICQzIH4gL15bMC05XSskLyAmJiAkNCB+IC9eWzAtOV0rJC8gJiYgJDEgPT0gMTAwICYmICQyID49IDY0ICYmICQyIDw9IDEyNyAmJiAkMyA+PSAwICYmICQzIDw9IDI1NSAmJiAkNCA+PSAwICYmICQ0IDw9IDI1NSB7IHByaW50OyBleGl0IH0nKSIKWyAiJHZhbGlkX2lwIiA9ICIkaXAiIF0gfHwgeyBlY2hvICJMYSBJUCBUYWlsc2NhbGUgZGUgUEMyIG5vIHBlcnRlbmVjZSBhIDEwMC42NC4wLjAvMTAiID4mMjsgZXhpdCAxOyB9CnVybD0iaHR0cDovLyRpcDo3NjgxIgpwcm9iZSgpIHsgY29kZT0iJChjdXJsIC0tbm9wcm94eSAnKicgLS1jb25uZWN0LXRpbWVvdXQgMSAtLW1heC10aW1lIDEgLS1zaWxlbnQgLS1zaG93LWVycm9yIC0tb3V0cHV0IC9kZXYvbnVsbCAtLXdyaXRlLW91dCAnJXtodHRwX2NvZGV9JyAiJHVybC8iIHx8IHRydWUpIjsgWyAiJGNvZGUiID0gIjIwMCIgXTsgfQppZiBwcm9iZTsgdGhlbiBwcmludGYgJ0FHWV9QQzJfVEVSTUlOQUxfUkVBRFk9JXNcbicgIiR1cmwiOyBleGl0IDA7IGZpCmlmIGNvbW1hbmQgLXYgc3MgPi9kZXYvbnVsbCAyPiYxOyB0aGVuIGlmIHNzIC1IIC1sdG4gJ3Nwb3J0ID0gOjc2ODEnIDI+L2Rldi9udWxsIHwgZ3JlcCAtcSBMSVNURU47IHRoZW4gZWNobyAiRWwgcHVlcnRvIDc2ODEgZXN0w6Egb2N1cGFkbyB5IG5vIHJlc3BvbmRlIGNvbW8gdGVybWluYWwiID4mMjsgZXhpdCAxOyBmaQplbGlmIGNvbW1hbmQgLXYgbHNvZiA+L2Rldi9udWxsIDI+JjE7IHRoZW4gaWYgbHNvZiAtblAgLWlUQ1A6NzY4MSAtc1RDUDpMSVNURU4gPi9kZXYvbnVsbCAyPiYxOyB0aGVuIGVjaG8gIkVsIHB1ZXJ0byA3NjgxIGVzdMOhIG9jdXBhZG8geSBubyByZXNwb25kZSBjb21vIHRlcm1pbmFsIiA+JjI7IGV4aXQgMTsgZmk7IGZpCmlmIFsgLXggIiRIT01FL3R0eWQiIF07IHRoZW4gdHR5ZF9iaW49IiRIT01FL3R0eWQiOyBlbGlmIGNvbW1hbmQgLXYgdHR5ZCA+L2Rldi9udWxsIDI+JjE7IHRoZW4gdHR5ZF9iaW49IiQoY29tbWFuZCAtdiB0dHlkKSI7IGVsc2UgZWNobyAiTm8gc2UgZW5jb250csOzIH4vdHR5ZCBuaSB0dHlkIGVuIFBBVEgiID4mMjsgZXhpdCAxOyBmaQpub2h1cCAiJHR0eWRfYmluIiAtaSAiJGlwIiAtcCA3NjgxIC1XIGJhc2ggPC9kZXYvbnVsbCA+Pi90bXAvdHR5ZC1wYzIubG9nIDI+JjEgJgphdHRlbXB0PTAKd2hpbGUgWyAiJGF0dGVtcHQiIC1sdCAxMCBdOyBkbyBpZiBwcm9iZTsgdGhlbiBwcmludGYgJ0FHWV9QQzJfVEVSTUlOQUxfUkVBRFk9JXNcbicgIiR1cmwiOyBleGl0IDA7IGZpOyBhdHRlbXB0PSQoKGF0dGVtcHQgKyAxKSk7IHNsZWVwIDE7IGRvbmUKZWNobyAidHR5ZCBubyByZXNwb25kacOzIGNvbiBIVFRQIDIwMCBlbiBQQzIiID4mMgpleGl0IDE=';
  var SAFE_LAUNCHER_COMMAND = "printf '%s' " + SAFE_LAUNCHER_B64 + ' | base64 -d | bash';

  function now(options) {
    return typeof options.now === 'function' ? options.now() : Date.now();
  }

  function getDelay(options) {
    if (typeof options.delay === 'function') return options.delay;
    return function (milliseconds) {
      return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
      });
    };
  }

  function getFetch(options) {
    if (typeof options.fetch === 'function') return options.fetch;
    if (root && typeof root.fetch === 'function') return root.fetch.bind(root);
    if (typeof fetch === 'function') return fetch;
    throw new Error('No hay una función fetch disponible para el puente PC2.');
  }

  function getDocument(options, output) {
    return options.document || (output && output.ownerDocument) || (root && root.document);
  }

  function responseIsOk(response) {
    if (!response) return false;
    if (typeof response.ok === 'boolean') return response.ok;
    return response.status >= 200 && response.status < 300;
  }

  async function responseJson(response) {
    try {
      return response && typeof response.json === 'function' ? await response.json() : {};
    } catch (_) {
      return {};
    }
  }

  function responseMessage(data, fallback) {
    if (data && typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (data && typeof data.result === 'string' && data.result.trim()) return data.result.trim();
    return fallback;
  }

  function appendText(output, doc, text, className) {
    if (!output || !doc || typeof doc.createElement !== 'function') return null;
    var node = doc.createElement('div');
    if (className) node.className = className;
    node.textContent = String(text);
    output.appendChild(node);
    if (typeof output.scrollHeight === 'number') output.scrollTop = output.scrollHeight;
    return node;
  }

  function isTailnetIPv4(ip) {
    if (typeof ip !== 'string') return false;
    var parts = ip.split('.');
    if (parts.length !== 4 || parts.some(function (part) { return !/^\d+$/.test(part); })) return false;
    var numbers = parts.map(Number);
    return numbers[0] === TAILSCALE_FIRST_OCTET &&
      numbers[1] >= TAILSCALE_SECOND_MIN &&
      numbers[1] <= TAILSCALE_SECOND_MAX &&
      numbers[2] >= 0 && numbers[2] <= 255 &&
      numbers[3] >= 0 && numbers[3] <= 255;
  }

  function extractReadyUrl(result) {
    var lines = String(result == null ? '' : result).split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.indexOf('AGY_PC2_TERMINAL_READY=') === 0;
    });
    if (lines.length !== 1) return null;
    var match = lines[0].match(/^AGY_PC2_TERMINAL_READY=(http:\/\/([0-9.]+):7681)$/);
    if (!match || !isTailnetIPv4(match[2])) return null;
    return match[1];
  }

  function addTerminalLink(output, doc, url, navigatorObject) {
    if (!output || !doc || typeof doc.createElement !== 'function') return;
    var link = doc.createElement('a');
    link.className = 'pc2-terminal-link';
    link.href = url;
    link.textContent = '🔴 ABRIR TERMINAL PC2 →';
    link.setAttribute('aria-label', 'Abrir terminal de PC2');
    output.appendChild(link);

    var copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'pc2-terminal-copy';
    copy.textContent = '📋 Copiar enlace';
    copy.addEventListener('click', function () {
      copyLink(url, doc, navigatorObject).then(function () {
        copy.textContent = '✅ Enlace copiado';
      }).catch(function () {
        copy.textContent = '⚠️ Copia manual: ' + url;
      });
    });
    output.appendChild(copy);
  }

  function copyLink(value, doc, navigatorObject) {
    var clipboard = navigatorObject && navigatorObject.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      return Promise.resolve(clipboard.writeText(value)).catch(function () {
        return copyWithSelection(value, doc);
      });
    }
    return copyWithSelection(value, doc);
  }

  function copyWithSelection(value, doc) {
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      return Promise.reject(new Error('El navegador no permite copiar el enlace automáticamente.'));
    }
    var area = doc.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    if (area.style) area.style.position = 'fixed';
    doc.body.appendChild(area);
    if (typeof area.select === 'function') area.select();
    var copied = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    if (area.parentNode) area.parentNode.removeChild(area);
    return copied
      ? Promise.resolve()
      : Promise.reject(new Error('El navegador no permite copiar el enlace automáticamente.'));
  }

  async function postLauncher(options, fetchFunction, getPwd) {
    var response = await fetchFunction('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agyide-pwd': getPwd()
      },
      body: JSON.stringify({
        target: 'PC2',
        instruction: 'EJECUTAR ' + SAFE_LAUNCHER_COMMAND
      })
    });
    var data = await responseJson(response);
    if (!responseIsOk(response)) {
      var status = response && response.status ? ' (HTTP ' + response.status + ')' : '';
      throw new Error(response.status === 401
        ? 'No autorizado: la sesión de AGYIDE no es válida.'
        : 'No fue posible enviar la orden a PC2' + status + ': ' + responseMessage(data, 'respuesta HTTP no válida'));
    }
    if (data && data.ok === false) {
      throw new Error('Error de ejecución en PC2: ' + responseMessage(data, 'la orden fue rechazada'));
    }
    if (!data || typeof data.id !== 'string' || !data.id.trim()) {
      throw new Error('PC2 no devolvió un ID de tarea; la terminal no se activó.');
    }
    return data.id;
  }

  async function pollLauncher(id, options, fetchFunction, getPwd) {
    var maxMs = Number.isFinite(options.maxMs) ? options.maxMs : DEFAULT_MAX_MS;
    var intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS;
    var startedAt = now(options);
    while (now(options) - startedAt < maxMs) {
      var response = await fetchFunction('/api/status/' + encodeURIComponent(id), {
        method: 'GET',
        headers: { 'x-agyide-pwd': getPwd() }
      });
      var data = await responseJson(response);
      if (!responseIsOk(response)) {
        var status = response && response.status ? ' (HTTP ' + response.status + ')' : '';
        throw new Error(response.status === 401
          ? 'No autorizado: la sesión de AGYIDE no es válida.'
          : 'No fue posible consultar el estado de PC2' + status + ': ' + responseMessage(data, 'respuesta HTTP no válida'));
      }
      if (data.status === 'done') return data;
      if (data.status === 'error') {
        throw new Error('Error de ejecución en PC2: ' + responseMessage(data, 'la orden terminó con error'));
      }
      var remaining = maxMs - (now(options) - startedAt);
      if (remaining <= 0) break;
      await getDelay(options)(Math.min(intervalMs, remaining));
    }
    throw new Error('Tiempo de espera agotado: PC2 no terminó la orden en 60 segundos.');
  }

  async function run(options) {
    var output = options.output;
    var button = options.button;
    var doc = getDocument(options, output);
    var fetchFunction = getFetch(options);
    var getPwd = typeof options.getPwd === 'function' ? options.getPwd : function () { return ''; };
    var navigatorObject = options.navigator || (root && root.navigator);
    var originalLabel = button && button.textContent;

    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Activando...';
    }
    appendText(output, doc, '⏳ Preparando la terminal segura de PC2…', 'pc2-terminal-pending');
    try {
      var id = await postLauncher(options, fetchFunction, getPwd);
      var result = await pollLauncher(id, options, fetchFunction, getPwd);
      var url = extractReadyUrl(result.result);
      if (!url) {
        throw new Error('PC2 terminó sin una señal de terminal válida; no se abrirá ningún enlace.');
      }
      appendText(output, doc, '✅ PC2 terminó la preparación de la terminal.', 'pc2-terminal-success');
      appendText(output, doc, 'Tailscale debe estar activo en el teléfono. La comprobación local no garantiza que el navegador pueda alcanzar PC2.', 'pc2-terminal-note');
      addTerminalLink(output, doc, url, navigatorObject);
      return { id: id, url: url, result: result };
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      appendText(output, doc, '❌ Error PUENTE PC2: ' + message, 'pc2-terminal-error');
      throw error;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || '🔴 PUENTE PC2';
      }
    }
  }

  function launch(options) {
    options = options || {};
    if (activePromise) return activePromise;
    activePromise = run(options).finally(function () {
      activePromise = null;
    });
    return activePromise;
  }

  return {
    launch: launch,
    buildLauncherCommand: function () { return SAFE_LAUNCHER_COMMAND; },
    extractReadyUrl: extractReadyUrl,
    isTailnetIPv4: isTailnetIPv4,
    DEFAULT_MAX_MS: DEFAULT_MAX_MS,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS
  };
});