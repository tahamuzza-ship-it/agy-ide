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
              '<div class="yarbis-missions-bar"><button id="yarbis-missions-open" type="button" aria-haspopup="dialog">MISIONES CREADAS <span id="yarbis-missions-count">0</span></button></div>' +
              '<div id="yarbis-history" class="yarbis-history" aria-live="polite"></div>' +
              '<form id="yarbis-text-form" class="yarbis-text"><input id="yarbis-text-input" maxlength="4000" placeholder="Plan B: escribe aquí si no puedes usar el micrófono" autocomplete="off">' +
              '<button type="submit" disabled>ENVIAR</button></form>' +
              '<div id="yarbis-missions-layer" class="yarbis-missions-layer" hidden><section class="yarbis-missions-dialog" role="dialog" aria-modal="true" aria-labelledby="yarbis-missions-title">' +
              '<header><div><span>BANDEJA DE BORRADORES</span><h3 id="yarbis-missions-title">MISIONES CREADAS</h3></div><button id="yarbis-missions-close" type="button" aria-label="Cerrar misiones creadas">×</button></header>' +
              '<div id="yarbis-missions-list" class="yarbis-missions-list"></div></section></div>' +
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
  var missionsOpenBtn = document.getElementById('yarbis-missions-open');
  var missionsCount = document.getElementById('yarbis-missions-count');
  var missionsLayer = document.getElementById('yarbis-missions-layer');
  var missionsList = document.getElementById('yarbis-missions-list');
  var missionsCloseBtn = document.getElementById('yarbis-missions-close');
  if (!overlay || !reactor || !stateEl || !statusEl || !history || !connectBtn ||
      !micBtn || !disconnectBtn || !textForm || !textInput || !missionsOpenBtn ||
      !missionsCount || !missionsLayer || !missionsList || !missionsCloseBtn ||
      !document.getElementById('btn-yarbis')) return;
  var ws = null, stream = null, audioCtx = null, source = null, processor = null;
  var playbackCtx = null, playbackAt = 0, closing = false, panelOpen = false;
  var drafts = [], activeYarbisBody = null;
  var micGeneration = 0, connectionGeneration = 0;
  var activeConnection = null;
  var activePlaybackNodes = new Set(), speechActive = false, audioTurnOpen = false, lastSpeechAt = 0;
  var inputTurnSequence = 0, activeInputTurnId = 0, awaitingInputTurnId = 0;
  var blockedSpeechUntilSilence = false;
  var serverTurnInProgress = false, discardInterruptedOutput = false;
  var processedInputTurns = new Set();
  var SPEECH_RMS_THRESHOLD = 0.018, SPEECH_END_DELAY_MS = 850;

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
  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var request = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, request).catch(function (error) {
      if (error && error.name === 'AbortError') throw new Error('La conexión tardó demasiado. Revisa la bandeja antes de repetir.');
      throw error;
    }).finally(function () { clearTimeout(timer); });
  }
  function setState(value, message) {
    reactor.dataset.state = value;
    stateEl.textContent = value;
    if (message) statusEl.textContent = message;
  }
  function mergeTranscriptText(current, incoming) {
    var left = String(current || '').trim(), right = String(incoming || '').trim();
    if (!right || right === left || left.endsWith(right)) return left;
    if (!left || right.startsWith(left)) return right;
    if (left.startsWith(right)) return left;
    var maxOverlap = Math.min(left.length, right.length);
    for (var size = maxOverlap; size >= 2; size--) {
      if (left.slice(-size).toLocaleLowerCase('es') === right.slice(0, size).toLocaleLowerCase('es')) {
        return left + right.slice(size);
      }
    }
    return (left + ' ' + right).replace(/\s+/g, ' ').trim();
  }
  function finishYarbisMessage() { activeYarbisBody = null; }
  function add(role, text) {
    if (!text) return;
    if (role !== 'yarbis') finishYarbisMessage();
    var row = document.createElement('div');
    row.className = 'yarbis-line yarbis-' + role;
    var name = document.createElement('strong');
    name.textContent = role === 'yarbis' ? 'YARBIS' : role === 'system' ? 'SISTEMA' : 'TÚ';
    var body = document.createElement('span');
    body.textContent = text;
    row.append(name, body);
    history.appendChild(row);
    history.scrollTop = history.scrollHeight;
    return body;
  }
  function appendYarbisTranscript(text) {
    if (!text) return;
    if (!activeYarbisBody || !activeYarbisBody.isConnected) {
      activeYarbisBody = add('yarbis', text);
    } else {
      activeYarbisBody.textContent = mergeTranscriptText(activeYarbisBody.textContent, text);
      history.scrollTop = history.scrollHeight;
    }
  }
  function renderDrafts() {
    var actionableCount = drafts.filter(function (draft) { return draft.status === 'draft'; }).length;
    missionsCount.textContent = String(actionableCount);
    missionsOpenBtn.classList.toggle('has-items', drafts.length > 0);
    missionsOpenBtn.setAttribute('aria-label', 'Misiones creadas: ' + actionableCount);
    missionsList.replaceChildren();
    if (!drafts.length) {
      var empty = document.createElement('div');
      empty.className = 'yarbis-missions-empty';
      var emptyTitle = document.createElement('strong');
      emptyTitle.textContent = 'NO HAY MISIONES PENDIENTES';
      var emptyText = document.createElement('p');
      emptyText.textContent = 'Cuando Yarbis prepare una misión para PC1, aparecerá aquí antes de enviarse.';
      empty.append(emptyTitle, emptyText);
      missionsList.appendChild(empty);
      return;
    }
    drafts.forEach(function (draft, index) {
      var card = document.createElement('article');
      card.className = 'yarbis-mission-card';
      var label = document.createElement('span');
      label.className = 'yarbis-mission-label';
      label.textContent = draft.status === 'uncertain'
        ? 'REVISAR BUZÓN'
        : draft.status === 'sending'
          ? 'ENVIANDO'
          : 'BORRADOR ' + String(drafts.length - index);
      var mission = document.createElement('p');
      mission.textContent = draft.mission;
      var meta = document.createElement('small');
      var expires = new Date(draft.expiresAt);
      meta.textContent = Number.isNaN(expires.getTime())
        ? 'Pendiente de decisión'
        : 'Disponible hasta ' + expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      card.append(label, mission, meta);
      if (draft.status === 'draft') {
        var actions = document.createElement('div');
        actions.className = 'yarbis-mission-actions';
        var send = document.createElement('button');
        send.type = 'button';
        send.className = 'yarbis-mission-send';
        send.textContent = 'ENVIAR A PC1';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'yarbis-mission-cancel';
        cancel.textContent = 'CANCELAR';
        send.addEventListener('click', function () { confirmMailbox('confirm', draft.proposalId, card); });
        cancel.addEventListener('click', function () { confirmMailbox('cancel', draft.proposalId, card); });
        actions.append(send, cancel);
        card.appendChild(actions);
      } else {
        var warning = document.createElement('p');
        warning.className = 'yarbis-mission-warning';
        warning.textContent = draft.status === 'sending'
          ? 'Envío en curso. Espera el resultado antes de realizar otra acción.'
          : 'No la vuelvas a enviar. Consulta el Buzón para verificar si PC1 la recibió.';
        card.appendChild(warning);
      }
      missionsList.appendChild(card);
    });
  }
  async function refreshDrafts(silent) {
    try {
      var response = await fetchWithTimeout('/api/ops/mailbox/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
        body: JSON.stringify({ action: 'drafts' })
      }, 10000);
      var body = await response.json().catch(function(){ return {}; });
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || 'No se pudieron cargar los borradores.');
      drafts = body.items;
      renderDrafts();
      return true;
    } catch (error) {
      if (!silent) add('system', error.message || 'No se pudieron cargar los borradores.');
      return false;
    }
  }
  function openMissions() {
    missionsLayer.hidden = false;
    refreshDrafts(false);
    missionsCloseBtn.focus();
  }
  function closeMissions() {
    missionsLayer.hidden = true;
    missionsOpenBtn.focus();
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
  function stopPlayback(message) {
    activePlaybackNodes.forEach(function (node) {
      try { node.onended = null; node.stop(0); node.disconnect(); } catch (_) {}
    });
    activePlaybackNodes.clear();
    if (playbackCtx) playbackAt = playbackCtx.currentTime;
    if (message) setState(stream ? 'LISTENING' : 'IDLE', message);
  }
  function finishAudioTurn(message) {
    if (!audioTurnOpen) return;
    audioTurnOpen = false;
    speechActive = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'audio_end', turnId: activeInputTurnId }));
      awaitingInputTurnId = activeInputTurnId;
      setState('THINKING', message || 'Procesando tu turno…');
    }
    activeInputTurnId = 0;
  }
  function inputRms(samples) {
    var sum = 0;
    for (var i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
  }
  function isYarbisOperationalUtterance(text) {
    var normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || normalized.length > 180) return false;
    if (/^estado\s+(?:de\s+)?(?:la\s+)?(?:flota|pc\s*1|equipo)\b/.test(normalized)) return true;
    var action = /^(?:abre|cierra|ejecuta|inicia|deten|activa|desactiva|genera|muestra|revisa|comprueba|consulta|lista|lee|busca|descarga|guarda)\b/.test(normalized);
    var object = /\b(?:informe|archivo|programa|navegador|camara|bloc|terminal|carpeta|documento|reporte|estado|flota|disco|ram|video|audio|pantalla|url|web|aplicacion|app|foto)\b/.test(normalized);
    return action && object;
  }
  function mailboxIntentForUtterance(text) {
    if (typeof window._mailboxVoiceIntent !== 'function') return null;
    var intent = window._mailboxVoiceIntent(text);
    if (!intent && isYarbisOperationalUtterance(text)) {
      intent = window._mailboxVoiceIntent('PC1: ' + text);
    }
    return intent;
  }
  async function processFinalInputTurn(text, turnId) {
    var key = connectionGeneration + ':' + String(turnId || ('text:' + String(text || '').trim().toLowerCase()));
    if (!text || processedInputTurns.has(key)) return;
    processedInputTurns.add(key);
    add('user', text);
    var intent = mailboxIntentForUtterance(text);
    try {
      if (intent) await handleMailboxIntent(text, intent);
    } catch (error) {
      add('system', error.message || 'No se pudo preparar la propuesta del Buzón.');
    }
  }
  function stopMic(finishTurn) {
    if (finishTurn !== false) finishAudioTurn('Turno cerrado. Procesando…');
    micGeneration++;
    if (processor) { processor.disconnect(); processor.onaudioprocess = null; }
    if (source) source.disconnect();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    if (audioCtx) audioCtx.close().catch(function(){});
    processor = source = stream = audioCtx = null;
    speechActive = false;
    micBtn.textContent = 'ACTIVAR MICRÓFONO';
  }
  async function startMic() {
    if (stream) { stopMic(); setState('IDLE', 'Micrófono detenido; Live sigue conectado.'); return; }
    var generation = ++micGeneration;
    var pendingStream = null;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== micGeneration || closing || !panelOpen || overlay.getAttribute('aria-hidden') === 'true') {
        pendingStream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = pendingStream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (event) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        var input = event.inputBuffer.getChannelData(0);
        var now = Date.now(), heardSpeech = inputRms(input) >= SPEECH_RMS_THRESHOLD;
        if (blockedSpeechUntilSilence) {
          if (!heardSpeech) blockedSpeechUntilSilence = false;
          return;
        }
        if (heardSpeech) {
          if (!speechActive) {
            if (awaitingInputTurnId) {
              blockedSpeechUntilSilence = true;
              setState('THINKING', 'Espera el cierre del turno y vuelve a hablar tras una pausa.');
              return;
            }
            if (!audioTurnOpen) {
              audioTurnOpen = true;
              activeInputTurnId = ++inputTurnSequence;
            }
            var interruptedPlayback = activePlaybackNodes.size > 0 || reactor.dataset.state === 'SPEAKING';
            discardInterruptedOutput = interruptedPlayback && serverTurnInProgress;
            stopPlayback(interruptedPlayback ? 'Interrupción detectada; escuchando.' : '');
            if (!interruptedPlayback) setState('LISTENING', 'Escuchando.');
          }
          speechActive = true;
          lastSpeechAt = now;
        }
        if (!audioTurnOpen) return;
        if (speechActive && !heardSpeech && now - lastSpeechAt >= SPEECH_END_DELAY_MS) {
          finishAudioTurn('Pausa detectada. Procesando…');
          return;
        }
        var pcm = floatTo16(downsample(input, audioCtx.sampleRate));
        ws.send(JSON.stringify({ type: 'audio', turnId: activeInputTurnId, data: base64(pcm.buffer) }));
      };
      source.connect(processor); processor.connect(audioCtx.destination);
      micBtn.textContent = 'DETENER MICRÓFONO';
      setState('LISTENING', 'Escuchando solo dentro de Modo Yarbis.');
    } catch (_) {
      if (generation !== micGeneration) return;
      stopMic(); setState('IDLE', 'Permiso de micrófono denegado. Usa el modo texto.');
      add('system', 'No se pudo abrir el micrófono. El Plan B de texto sigue disponible.');
    }
  }
  function playPcm(data, mime, generation, session) {
    if (
      closing || !panelOpen || speechActive || discardInterruptedOutput || generation !== connectionGeneration || !ws ||
      !session || session.closed || activeConnection !== session || session.socket !== ws
    ) {
      overlay.dataset.lastDiscard = 'audio';
      return;
    }
    var match = /rate=(\d+)/.exec(mime || ''), rate = match ? Number(match[1]) : 24000;
    var raw = atob(data), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var pcm = new Int16Array(bytes.buffer), floats = new Float32Array(pcm.length);
    for (var j = 0; j < pcm.length; j++) floats[j] = pcm[j] / 32768;
    playbackCtx = playbackCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate });
    var buffer = playbackCtx.createBuffer(1, floats.length, rate); buffer.copyToChannel(floats, 0);
    var node = playbackCtx.createBufferSource(); node.buffer = buffer; node.connect(playbackCtx.destination);
    activePlaybackNodes.add(node);
    node.onended = function () {
      activePlaybackNodes.delete(node);
      try { node.disconnect(); } catch (_) {}
      if (!activePlaybackNodes.size && !speechActive && panelOpen) {
        setState(stream ? 'LISTENING' : 'IDLE', stream ? 'Escuchando.' : 'Live listo.');
      }
    };
    playbackAt = Math.max(playbackAt, playbackCtx.currentTime); node.start(playbackAt); playbackAt += buffer.duration;
    setState('SPEAKING', 'Yarbis está respondiendo.');
  }
  function disconnect(message) {
    finishYarbisMessage();
    closing = true;
    activeInputTurnId = 0;
    awaitingInputTurnId = 0;
    blockedSpeechUntilSilence = false;
    audioTurnOpen = false;
    serverTurnInProgress = false;
    discardInterruptedOutput = false;
    if (activeConnection) activeConnection.closed = true;
    activeConnection = null;
    connectionGeneration++;
    stopMic(false);
    stopPlayback();
    var closingSocket = ws;
    ws = null;
    if (closingSocket) {
      closingSocket.onopen = closingSocket.onmessage = closingSocket.onclose = closingSocket.onerror = null;
      try { closingSocket.close(1000); } catch (_) {}
    }
    if (playbackCtx) { playbackCtx.close().catch(function(){}); playbackCtx = null; playbackAt = 0; }
    connectBtn.disabled = false; micBtn.disabled = true; disconnectBtn.disabled = true; textSend.disabled = true;
    setState('IDLE', message || 'Apagado. Nada escucha ni está conectado.');
    closing = false;
  }
  function connect() {
    if (ws) return;
    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var generation = ++connectionGeneration;
    var socket = new WebSocket(scheme + '//' + location.host + '/api/yarbis/live');
    var session = { socket: socket, closed: false };
    activeConnection = session;
    ws = socket;
    connectBtn.disabled = true; disconnectBtn.disabled = false;
    setState('THINKING', 'Conectando con Gemini Live…');
    socket.onopen = function () {
      if (ws !== socket || generation !== connectionGeneration || !panelOpen) return;
      socket.send(JSON.stringify({ type: 'auth', password: pwd() }));
    };
    socket.onmessage = function (event) {
      if (
        closing || !panelOpen || ws !== socket || generation !== connectionGeneration ||
        session.closed || activeConnection !== session
      ) {
        overlay.dataset.lastDiscard = 'message';
        return;
      }
      var m; try { m = JSON.parse(event.data); } catch (_) { return; }
      if (m.type === 'connecting') {
        setState('THINKING', 'Autenticado. Esperando a Gemini Live…');
      } else if (m.type === 'ready') {
        micBtn.disabled = false; textSend.disabled = false; setState('IDLE', 'Live listo. Activa el micrófono o usa texto.');
      } else if (m.type === 'unavailable') {
        add('system', m.message);
        disconnect(m.message);
      } else if (m.type === 'transcript' && m.role === 'user' && m.final) {
        processFinalInputTurn(m.text, m.turnId);
      } else if (m.type === 'input_turn_finalized') {
        if (!awaitingInputTurnId || Number(m.turnId) === awaitingInputTurnId) awaitingInputTurnId = 0;
      } else if (m.type === 'input_turn_busy') {
        blockedSpeechUntilSilence = true;
        setState('THINKING', 'El turno anterior aún se está cerrando.');
      } else if (m.type === 'transcript') appendYarbisTranscript(m.text);
      else if (m.type === 'audio') { serverTurnInProgress = true; playPcm(m.data, m.mimeType, generation, session); }
      else if (m.type === 'turn_complete') {
        finishYarbisMessage();
        serverTurnInProgress = false;
        discardInterruptedOutput = false;
        if (!activePlaybackNodes.size) setState(stream ? 'LISTENING' : 'IDLE', stream ? 'Escuchando.' : 'Live listo.');
      }
      else if (m.type === 'interrupted') { finishYarbisMessage(); discardInterruptedOutput = true; stopPlayback('Respuesta interrumpida; escuchando.'); }
      else if (m.type === 'error' || m.type === 'disconnected') {
        finishYarbisMessage();
        add('system', m.message);
        disconnect((m.message || 'La sesión Live terminó.') + ' Pulsa CONECTAR LIVE para volver a intentarlo.');
      }
    };
    socket.onclose = function (event) {
      if (ws !== socket || generation !== connectionGeneration || activeConnection !== session) return;
      session.closed = true;
      activeConnection = null;
      ws = null; stopMic(false); stopPlayback(); connectBtn.disabled = false; micBtn.disabled = true; disconnectBtn.disabled = true; textSend.disabled = true;
      if (!closing) { setState('IDLE', 'Live desconectado. Puedes volver a conectar.'); add('system', event.reason || 'La conexión terminó.'); }
    };
    socket.onerror = function () {
      if (
        ws === socket && generation === connectionGeneration && panelOpen &&
        !session.closed && activeConnection === session
      ) setState('IDLE', 'No se pudo conectar con Live.');
    };
  }
  async function mailboxCommand(text, intentOverride) {
    var intent = intentOverride || mailboxIntentForUtterance(text);
    if (!intent || intent.type !== 'draft' || !intent.mission) {
      throw new Error('Aclara la misión que quieres proponer para el Buzón de PC1.');
    }
    var response = await fetchWithTimeout('/api/ops/mailbox/voice/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
      body: JSON.stringify({ action: 'draft', mission: intent.mission, utterance: intent.utterance || text })
    }, 15000);
    var body = await response.json().catch(function(){ return {}; });
    if (!response.ok) throw new Error(body.error || 'No se pudo consultar el Buzón.');
    if (body.kind === 'proposal') await refreshDrafts(true);
    return body;
  }
  async function handleMailboxIntent(text, intent) {
    if (intent.type === 'draft' && intent.mission) {
      var proposal = await mailboxCommand(text, intent);
      add('system', proposal.message || 'Borrador preparado. No se ejecutará sin confirmación.');
      setState(stream ? 'LISTENING' : 'IDLE', 'Misión guardada como borrador.');
      openMissions();
      return;
    }
    if (intent.type === 'confirm-only') {
      await refreshDrafts(true);
      if (!drafts.length) { add('system', 'No hay misiones creadas pendientes de enviar.'); return; }
      if (drafts.length > 1) { openMissions(); add('system', 'Hay varias misiones creadas. Elige cuál quieres enviar.'); return; }
      await confirmMailbox('confirm', drafts[0].proposalId);
      return;
    }
    if (intent.type === 'cancel-only') {
      await refreshDrafts(true);
      if (!drafts.length) { add('system', 'No hay misiones creadas pendientes de cancelar.'); return; }
      if (drafts.length > 1) { openMissions(); add('system', 'Hay varias misiones creadas. Elige cuál quieres cancelar.'); return; }
      await confirmMailbox('cancel', drafts[0].proposalId);
      return;
    }
    if (intent.type === 'list' || intent.type === 'list-agy-to-replit') {
      var response = await fetchWithTimeout('/api/ops/mailbox/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
        body: JSON.stringify({ action: intent.type, utterance: intent.utterance || text })
      }, 30000);
      var body = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(body.error || 'No se pudo consultar el Buzón.');
      add('system', body.message || 'Consulta del Buzón completada.');
      setState(stream ? 'LISTENING' : 'IDLE', 'Consulta del Buzón completada.');
      return;
    }
    add('system', intent.type === 'draft-help'
      ? 'Indica el objetivo concreto de la misión para PC1.'
      : 'Aclara si quieres consultar la Entrada de PC1 o la Salida de PC1.');
    setState(stream ? 'LISTENING' : 'IDLE', 'Esperando una instrucción más precisa.');
  }
  async function confirmMailbox(decision, proposalId, card) {
    if (!proposalId || (decision !== 'confirm' && decision !== 'cancel')) return;
    var buttons = card ? card.querySelectorAll('button') : [];
    Array.prototype.forEach.call(buttons, function (button) { button.disabled = true; });
    try {
      var response = await fetchWithTimeout('/api/ops/mailbox/voice/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': encodeURIComponent(pwd()), 'x-agy-voice-session': voiceSession() },
        body: JSON.stringify({ proposalId: proposalId, decision: decision })
      }, 40000);
      var body = await response.json().catch(function(){ return {}; });
      add('system', body.message || body.error || 'Buzón actualizado.');
      if (response.ok && decision === 'confirm') setState(stream ? 'LISTENING' : 'IDLE', 'Misión enviada a PC1.');
      if (!response.ok) setState(stream ? 'LISTENING' : 'IDLE', 'No se pudo completar la decisión.');
    } catch (error) {
      add('system', error.message || 'No se pudo completar la decisión.');
      setState(stream ? 'LISTENING' : 'IDLE', 'No se pudo completar la decisión.');
    } finally {
      await refreshDrafts(true);
    }
  }
  document.getElementById('btn-yarbis').addEventListener('click', function () {
    panelOpen = true;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    overlay.style.setProperty('display', 'grid', 'important');
    refreshDrafts(true);
    textInput.focus();
  });
  document.getElementById('yarbis-close').addEventListener('click', function () {
    panelOpen = false;
    micGeneration++;
    overlay.style.setProperty('display', 'none', 'important');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    missionsLayer.hidden = true;
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
  missionsOpenBtn.addEventListener('click', openMissions);
  missionsCloseBtn.addEventListener('click', closeMissions);
  missionsLayer.addEventListener('click', function (event) { if (event.target === missionsLayer) closeMissions(); });
  textForm.addEventListener('submit', async function (event) {
    event.preventDefault(); var text = textInput.value.trim(); if (!text) return;
    textInput.value = ''; add('user', text); setState('THINKING', 'Procesando…');
    try {
      var intent = mailboxIntentForUtterance(text);
      if (intent) await handleMailboxIntent(text, intent);
      else if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'text', text: text }));
      else { add('system', 'Conecta Live para conversar. Para una misión a PC1, menciona misión, Buzón o PC1.'); setState('IDLE'); }
    } catch (error) { add('system', error.message); setState('IDLE', 'No se pudo procesar la solicitud.'); }
  });
  renderDrafts();
})();
