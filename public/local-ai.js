(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let busy = false, answer = '', recognition = null;
  const say = text => { el('status').textContent = text; };
  const voice = text => { el('voice-status').textContent = text; };
  function silence() {
    try { window.speechSynthesis?.cancel(); }
    catch { voice('No se pudo detener el audio. Puedes continuar por texto.'); }
  }
  function stopDictation() {
    const previous = recognition;
    recognition = null;
    el('mic').textContent = 'Dictar';
    if (!previous) return;
    previous.onresult = previous.onerror = previous.onend = previous.onstart = null;
    try { previous.abort(); voice('Dictado detenido. Puedes volver a pulsar Dictar.'); }
    catch { voice('El navegador no confirmó el cierre del dictado. Puedes seguir escribiendo.'); }
  }
  async function json(url, options = {}, timeout = 15000) {
    const readOnly = !options.method || options.method === 'GET';
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
        const raw = await response.text();
        if (!raw.trim()) throw Object.assign(Error('El servidor devolvió una respuesta vacía.'), { retryable: true });
        let body;
        try { body = JSON.parse(raw); }
        catch { throw Object.assign(Error('La conexión devolvió una respuesta incompleta o no válida.'), { retryable: true }); }
        if (!response.ok) throw Object.assign(Error(body.error || 'HTTP ' + response.status),
          { retryable: response.status >= 500 || response.status === 429 || response.status === 304 });
        return body;
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) {
          error = Object.assign(Error('La conexión se interrumpió o tardó demasiado.'), { retryable: true });
        }
        if (!readOnly) {
          error.message += ' No se reenvió la solicitud; podría haber llegado al servidor.';
          throw error;
        }
        if (!error.retryable || attempt >= 2) throw error;
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  json('/api/local-ai/config', {}, 10000).then(config => {
    el('node').options[1].disabled = !config.pc4Enabled;
    el('pc4-note').textContent = config.pc4Enabled ? '' : 'PC4 pendiente de activación del receptor y worker.';
  }).catch(() => say('No se pudo comprobar la configuración. El próximo envío volverá a comprobarla.'));
  if (!Recognition) {
    el('mic').disabled = true;
    voice('Este navegador no ofrece dictado web. Usa un navegador compatible o escribe tu pregunta.');
  }
  el('stop').onclick = silence;
  el('read').onclick = () => {
    stopDictation();
    silence();
    if (!answer) return voice('Primero necesitas recibir una respuesta.');
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance)
      return voice('Este navegador no ofrece lectura de voz.');
    try {
      const utterance = new SpeechSynthesisUtterance(answer);
      utterance.lang = 'es-CO';
      utterance.onerror = () => voice('La lectura se interrumpió. El envío por texto sigue disponible.');
      window.speechSynthesis.speak(utterance);
    } catch { voice('No se pudo iniciar la lectura. El envío por texto sigue disponible.'); }
  };
  el('mic').onclick = () => {
    if (recognition) { stopDictation(); voice('Dictado detenido.'); return; }
    if (!Recognition) return voice('Dictado no disponible en este navegador.');
    if (window.isSecureContext === false) return voice('El dictado necesita una página HTTPS.');
    silence();
    let current, received = false;
    try {
      current = new Recognition();
      recognition = current;
      current.lang = 'es-CO';
      current.interimResults = false;
      current.continuous = false;
      el('mic').textContent = 'Detener dictado';
      voice('Solicitando micrófono…');
      current.onstart = () => { if (recognition === current) voice('Escuchando. Di tu pregunta.'); };
      current.onresult = event => {
        if (recognition !== current) return;
        const text = event.results?.[event.resultIndex || 0]?.[0]?.transcript;
        if (!text) return;
        received = true;
        el('text').value = text;
        voice('Dictado recibido. Pulsa Enviar.');
      };
      current.onerror = event => {
        if (recognition !== current) return;
        const messages = {
          'not-allowed': 'Micrófono bloqueado. Permite el micrófono en el navegador; si estás en la vista incrustada, abre el panel en otra pestaña.',
          'service-not-allowed': 'El navegador bloquea el servicio de dictado. Prueba un navegador compatible.',
          'audio-capture': 'No se pudo acceder al micrófono. Comprueba que esté conectado y disponible.',
          'network': 'El servicio de dictado del navegador no responde por red. No es un fallo de PC3 ni PC4.',
          'no-speech': 'No se detectó voz. Pulsa Dictar para intentarlo otra vez.',
          'aborted': 'Dictado detenido. Puedes volver a pulsar Dictar.',
          'language-not-supported': 'El navegador no admite el idioma de dictado seleccionado.',
        };
        const code = event.error || 'desconocido';
        stopDictation();
        voice((messages[code] || 'No se pudo dictar.') + ' Código: ' + code);
      };
      current.onend = () => {
        if (recognition !== current) return;
        recognition = null;
        el('mic').textContent = 'Dictar';
        if (!received) voice('El dictado terminó sin texto. Puedes volver a pulsar Dictar.');
      };
      current.start();
    } catch (error) {
      stopDictation();
      voice('No se pudo iniciar el dictado (' + error.name + '). El envío por texto sigue disponible.');
    }
  };
  el('send').onclick = async () => {
    if (busy) return say('Hay una consulta en curso. No se ha enviado otra.');
    const text = el('text').value.trim(), node = el('node').value;
    if (!el('pwd').value || !text) return say('Introduce la contraseña y una consulta.');
    busy = true;
    el('send').disabled = true;
    const started = Date.now(), deadline = started + 210000;
    let phase = 'Preparando consulta', ticker;
    try {
      // Every operation after locking the form is covered by finally.
      silence(); stopDictation();
      answer = ''; el('answer').textContent = '';
      ticker = setInterval(() => say(phase + ' · ' + Math.floor((Date.now() - started) / 1000) + ' s'), 1000);
      say(phase);
      const headers = { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(el('pwd').value) };
      const config = await json('/api/local-ai/config', {}, 10000);
      if (config.authMode === 'cibercode') {
        const auth = await json('/api/auth', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: el('pwd').value }) }, 15000);
        if (!auth.token) throw Error('Acceso no autorizado');
        delete headers['x-agyide-pwd']; headers['x-cibercode-token'] = auth.token;
      }
      phase = 'Enviando una sola solicitud a ' + node;
      const job = await json('/api/local-ai/chat', { method: 'POST', headers, body: JSON.stringify({ node, text }) }, 20000);
      if (!job.id || !job.access) throw Error('No llegó el identificador de la consulta. No se reenvió automáticamente.');
      headers['x-inference-access'] = job.access;
      phase = 'Esperando respuesta de ' + node;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let result;
        try {
          result = await json('/api/local-ai/chat/' + encodeURIComponent(job.id), { headers }, Math.min(15000, remaining));
          phase = 'Esperando respuesta de ' + node;
        } catch (error) {
          if (!error.retryable) throw error;
          phase = 'Reconectando para recuperar la misma respuesta de ' + node;
          continue;
        }
        if (result.status === 'failed') throw Error(result.error || 'El equipo informó un fallo.');
        if (result.status === 'completed') {
          answer = result.text;
          el('answer').textContent = answer;
          clearInterval(ticker);
          say('Respuesta recibida de ' + node + '. Puedes escribir otra pregunta y pulsar Enviar.');
          return;
        }
      }
      throw Error('Tiempo de espera agotado. La consulta podría seguir en el equipo; no se reenvió automáticamente.');
    } catch (error) {
      clearInterval(ticker);
      say('No completado: ' + error.message);
    } finally {
      clearInterval(ticker);
      busy = false;
      el('send').disabled = false;
      el('send').textContent = 'Enviar';
    }
  };
  window.addEventListener('pagehide', () => { stopDictation(); silence(); });
})();
