(function () {
  if (!document.getElementById('btn-yarbis')) {
    var headerButtons = document.querySelector('#header .header-btns');
    var goalButton = document.getElementById('btn-goal');
    if (headerButtons) {
      var button = document.createElement('button');
      button.className = 'hbtn hbtn-yarbis';
      button.id = 'btn-yarbis';
      button.type = 'button';
      button.textContent = '◉ MODO YARBIS';
      headerButtons.insertBefore(button, goalButton ? goalButton.nextSibling : headerButtons.firstChild);
    }
  }
  if (!document.getElementById('yarbis-overlay')) {
    var header = document.getElementById('header');
    if (header) {
      header.insertAdjacentHTML('afterend',
        '<div id="yarbis-overlay" aria-hidden="true">' +
          '<section id="yarbis-panel" role="dialog" aria-modal="true" aria-labelledby="yarbis-title">' +
            '<header class="yarbis-head"><div><span class="yarbis-kicker">VOICE HUB AISLADO</span><h2 id="yarbis-title">MODO YARBIS</h2></div>' +
            '<button id="yarbis-close" type="button" aria-label="Cerrar Modo Yarbis">×</button></header>' +
            '<div class="yarbis-body"><div class="yarbis-reactor-wrap">' +
              '<div id="yarbis-reactor" class="yarbis-reactor" data-state="IDLE"><i></i><b></b><span>Y</span></div>' +
              '<strong id="yarbis-state">IDLE</strong><p id="yarbis-status">Apagado. Nada escucha ni está conectado.</p></div>' +
              '<div class="yarbis-controls"><button id="yarbis-connect" type="button">CONECTAR LIVE</button>' +
              '<button id="yarbis-mic" type="button" disabled>ACTIVAR MICRÓFONO</button>' +
              '<button id="yarbis-disconnect" type="button" disabled>DESCONECTAR</button></div>' +
              '<div id="yarbis-history" class="yarbis-history" aria-live="polite"></div>' +
              '<form id="yarbis-text-form" class="yarbis-text"><input id="yarbis-text-input" maxlength="4000" placeholder="Plan B: escribe aquí si no puedes usar el micrófono" autocomplete="off">' +
              '<button type="submit" disabled>ENVIAR</button></form>' +
              '<div id="yarbis-proposal" class="yarbis-proposal" hidden><p id="yarbis-proposal-text"></p>' +
              '<button id="yarbis-confirm" type="button">CONFIRMAR BUZÓN</button><button id="yarbis-cancel" type="button">CANCELAR</button></div>' +
              '<p class="yarbis-note">Yarbis no reemplaza Chat, OUTPUT ni /goal. Las misiones a PC1 usan exclusivamente el Buzón oficial y requieren confirmación.</p>' +
            '</div></section></div>');
    }
  }
  var overlay = document.getElementById('yarbis-overlay');
  var reactor = document.getElementById('yarbis-reactor');
  var stateEl = document.getElementById('yarbis-state');
  var statusEl = document.getElementById('yarbis-status');
  var history = document.getElementById('yarbis-history');
  var connectBtn = document.getElementById('yarbis-connect');
  var micBtn = document.getElementById('yarbis-mic');
  var disconnectBtn = document.getElementById('yarbis-disconnect');
  var textForm = document.getElementById('yarbis-text-form');
  var textInput = document.getElementById('yarbis-text-input');
  var textSend = textForm.querySelector('button');
  var proposalBox = document.getElementById('yarbis-proposal');
  var proposalText = document.getElementById('yarbis-proposal-text');
  if (!overlay || !reactor || !stateEl || !statusEl || !history || !connectBtn ||
      !micBtn || !disconnectBtn || !textForm || !textInput || !proposalBox ||
      !proposalText || !document.getElementById('btn-yarbis')) return;
  var ws = null, stream = null, audioCtx = null, source = null, processor = null;
  var playbackCtx = null, playbackAt = 0, proposalId = '', closing = false;

  function pwd() { try { return localStorage.getItem('agyide_auth_v1') || ''; } catch (_) { return ''; } }
  function voiceSession() {
    var key = 'agy_yarbis_voice_session', value = '';
    try { value = sessionStorage.getItem(key) || ''; } catch (_) {}
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(value)) {
      value = 'yarbis_' + Date.now() + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem(key, value); } catch (_) {}
    }
    return value;
  }
  function setState(value, message) {
    reactor.dataset.state = value;
    stateEl.textContent = value;
    if (message) statusEl.textContent = message;
  }
  function add(role, text) {
    if (!text) return;
    var row = document.createElement('div');
    row.className = 'yarbis-line yarbis-' + role;
    var name = document.createElement('strong');
    name.textContent = role === 'yarbis' ? 'YARBIS' : role === 'system' ? 'SISTEMA' : 'TÚ';
    var body = document.createElement('span');
    body.textContent = text;
    row.append(name, body);
    history.appendChild(row);
    history.scrollTop = history.scrollHeight;
  }
  function floatTo16(samples) {
    var out = new Int16Array(samples.length);
    for (var i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
    return out;
  }
  function base64(bytes) {
    var s = '', view = new Uint8Array(bytes);
    for (var i = 0; i < view.length; i += 0x8000) s += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function downsample(input, fromRate) {
    if (fromRate === 16000) return input;
    var ratio = fromRate / 16000, length = Math.round(input.length / ratio), out = new Float32Array(length);
    for (var i = 0; i < length; i++) {
      var start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
      var sum = 0; for (var j = start; j < end; j++) sum += input[j];
      out[i] = sum / Math.max(1, end - start);
    }
    return out;
  }
  function stopMic() {
    if (processor) { processor.disconnect(); processor.onaudioprocess = null; }
    if (source) source.disconnect();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    if (audioCtx) audioCtx.close().catch(function(){});
    processor = source = stream = audioCtx = null;
    micBtn.textContent = 'ACTIVAR MICRÓFONO';
  }
  async function startMic() {
    if (stream) { stopMic(); setState('IDLE', 'Micrófono detenido; Live sigue conectado.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (event) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        var pcm = floatTo16(downsample(event.inputBuffer.getChannelData(0), audioCtx.sampleRate));
        ws.send(JSON.stringify({ type: 'audio', data: base64(pcm.buffer) }));
      };
      source.connect(processor); processor.connect(audioCtx.destination);
      micBtn.textContent = 'DETENER MICRÓFONO';
      setState('LISTENING', 'Escuchando solo dentro de Modo Yarbis.');
    } catch (_) {
      stopMic(); setState('IDLE', 'Permiso de micrófono denegado. Usa el modo texto.');
      add('system', 'No se pudo abrir el micrófono. El Plan B de texto sigue disponible.');
    }
  }
  function playPcm(data, mime) {
    var match = /rate=(\d+)/.exec(mime || ''), rate = match ? Number(match[1]) : 24000;
    var raw = atob(data), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var pcm = new Int16Array(bytes.buffer), floats = new Float32Array(pcm.length);
    for (var j = 0; j < pcm.length; j++) floats[j] = pcm[j] / 32768;
    playbackCtx = playbackCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate });
    var buffer = playbackCtx.createBuffer(1, floats.length, rate); buffer.copyToChannel(floats, 0);
    var node = playbackCtx.createBufferSource(); node.buffer = buffer; node.connect(playbackCtx.destination);
    playbackAt = Math.max(playbackAt, playbackCtx.currentTime); node.start(playbackAt); playbackAt += buffer.duration;
    setState('SPEAKING', 'Yarbis está respondiendo.');
  }
  function disconnect(message) {
    closing = true; stopMic();
    if (ws) { try { ws.close(1000); } catch (_) {} ws = null; }
    if (playbackCtx) { playbackCtx.close().catch(function(){}); playbackCtx = null; playbackAt = 0; }
    connectBtn.disabled = false; micBtn.disabled = true; disconnectBtn.disabled = true; textSend.disabled = true;
    setState('IDLE', message || 'Apagado. Nada escucha ni está conectado.');
    closing = false;
  }
  function connect() {
    if (ws) return;
    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(scheme + '//' + location.host + '/api/yarbis/live');
    connectBtn.disabled = true; disconnectBtn.disabled = false;
    setState('THINKING', 'Conectando con Gemini Live…');
    ws.onopen = function () { ws.send(JSON.stringify({ type: 'auth', password: pwd() })); };
    ws.onmessage = function (event) {
      var m; try { m = JSON.parse(event.data); } catch (_) { return; }
      if (m.type === 'connecting') {
        setState('THINKING', 'Autenticado. Esperando a Gemini Live…');
      } else if (m.type === 'ready') {
        micBtn.disabled = false; textSend.disabled = false; setState('IDLE', 'Live listo. Activa el micrófono o usa texto.');
      } else if (m.type === 'unavailable') {
        textSend.disabled = false; setState('IDLE', m.message); add('system', m.message);
      } else if (m.type === 'transcript') add(m.role === 'user' ? 'user' : 'yarbis', m.text);
      else if (m.type === 'audio') playPcm(m.data, m.mimeType);
      else if (m.type === 'turn_complete') setState(stream ? 'LISTENING' : 'IDLE', stream ? 'Escuchando.' : 'Live listo.');
      else if (m.type === 'interrupted') { playbackAt = 0; setState('LISTENING', 'Respuesta interrumpida; escuchando.'); }
      else if (m.type === 'error' || m.type === 'disconnected') { add('system', m.message); setState('IDLE', m.message); }
    };
    ws.onclose = function (event) {
      ws = null; stopMic(); connectBtn.disabled = false; micBtn.disabled = true; disconnectBtn.disabled = true; textSend.disabled = true;
      if (!closing) { setState('IDLE', 'Live desconectado. Puedes volver a conectar.'); add('system', event.reason || 'La conexión terminó.'); }
    };
    ws.onerror = function () { setState('IDLE', 'No se pudo conectar con Live.'); };
  }
  async function mailboxCommand(text) {
    var intent = typeof window._mailboxVoiceIntent === 'function' ? window._mailboxVoiceIntent(text) : null;
    if (!intent || intent.type !== 'draft' || !intent.mission) {
      throw new Error('Aclara la misión que quieres proponer para el Buzón de PC1.');
    }
    var response = await fetch('/api/ops/mailbox/voice/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
      body: JSON.stringify({ action: 'draft', mission: intent.mission, utterance: intent.utterance || text })
    });
    var body = await response.json().catch(function(){ return {}; });
    if (!response.ok) throw new Error(body.error || 'No se pudo consultar el Buzón.');
    if (body.kind === 'proposal') {
      proposalId = body.proposalId; proposalText.textContent = body.message || 'Confirma la misión propuesta.'; proposalBox.hidden = false;
    }
    return body;
  }
  async function confirmMailbox(decision) {
    if (!proposalId) return;
    var response = await fetch('/api/ops/mailbox/voice/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
      body: JSON.stringify({ proposalId: proposalId, decision: decision })
    });
    var body = await response.json().catch(function(){ return {}; });
    proposalId = ''; proposalBox.hidden = true;
    add('system', body.message || body.error || 'Buzón actualizado.');
  }
  document.getElementById('btn-yarbis').addEventListener('click', function () {
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    overlay.style.setProperty('display', 'grid', 'important');
    textInput.focus();
  });
  document.getElementById('yarbis-close').addEventListener('click', function () {
    overlay.style.setProperty('display', 'none', 'important');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    proposalId = '';
    proposalBox.hidden = true;
    try {
      disconnect();
    } catch (_) {
      ws = null;
      stream = audioCtx = source = processor = playbackCtx = null;
      connectBtn.disabled = false;
      micBtn.disabled = true;
      disconnectBtn.disabled = true;
      textSend.disabled = true;
      setState('IDLE', 'Apagado. Nada escucha ni está conectado.');
    }
  });
  connectBtn.addEventListener('click', connect);
  disconnectBtn.addEventListener('click', function(){ disconnect('Desconectado manualmente.'); });
  micBtn.addEventListener('click', startMic);
  textForm.addEventListener('submit', async function (event) {
    event.preventDefault(); var text = textInput.value.trim(); if (!text) return;
    textInput.value = ''; add('user', text); setState('THINKING', 'Procesando…');
    try {
      if (/^(?:crea|crear|env[ií]a|mandar|manda).*(?:misi[oó]n|buz[oó]n|pc1)/i.test(text)) {
        var result = await mailboxCommand(text); add('system', result.message || 'Propuesta preparada.');
        setState(stream ? 'LISTENING' : 'IDLE', 'Esperando confirmación del Buzón.');
      } else if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'text', text: text }));
      else { add('system', 'Conecta Live para conversar. Para una misión a PC1, menciona misión, Buzón o PC1.'); setState('IDLE'); }
    } catch (error) { add('system', error.message); setState('IDLE', 'No se pudo procesar la solicitud.'); }
  });
  document.getElementById('yarbis-confirm').addEventListener('click', function(){ confirmMailbox('confirm'); });
  document.getElementById('yarbis-cancel').addEventListener('click', function(){ confirmMailbox('cancel'); });
})();
