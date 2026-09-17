(function () {
  'use strict';

  var overlay, panel, statusBox, notebookSelect, sourcesBox, jobsBox, resultBox;
  var opened = false;
  var activeNotebookId = '';
  var notebooks = [];
  var busy = false;
  var jobTimers = {};
  var jobActions = {};
  var jobContexts = {};
  var audioUrl = '';
  var newsDraft = null;
  var newsDraftToken = 0;
  var MAX_NEWS_SUMMARY_UTF16 = 3500;
  var notebookRefreshTimer = null;
  var notebookRefreshInFlight = false;
  var notebookOptionsFingerprint = '';
  var NOTEBOOK_REFRESH_MS = 20000;

  /* La API vive en la raíz incluso cuando el IDE se sirve bajo un prefijo. */
  function apiUrl(path) {
    return new URL('/api/notebooklm' + path, window.location.origin).toString();
  }
  function authHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var pwd = '';
    try { if (typeof window._getPwd === 'function') pwd = window._getPwd(); } catch (_) {}
    if (!pwd) { try { pwd = localStorage.getItem('agyide_auth_v1') || ''; } catch (_) {} }
    if (pwd) headers['x-agyide-pwd'] = pwd;
    return headers;
  }
  async function request(path, options) {
    var opts = Object.assign({}, options || {});
    opts.headers = authHeaders(opts.headers);
    var response;
    try {
      response = await fetch(apiUrl(path), opts);
    } catch (_) {
      throw new Error('No fue posible conectar con el servicio Notebook LM.');
    }
    var contentType = response.headers.get('content-type') || '';
    var data = contentType.indexOf('application/json') !== -1
      ? await response.json().catch(function () { return {}; })
      : await response.text().catch(function () { return ''; });
    if (!response.ok) {
      var message = data && typeof data === 'object' && (data.message || data.error);
      throw new Error(message || ('El servicio respondió con HTTP ' + response.status + '.'));
    }
    return data;
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'className') node.className = attrs[key];
      else if (key === 'textContent') node.textContent = attrs[key];
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(id, label, title, className) {
    return el('button', { id: id, type: 'button', className: 'notebooklm-action ' + (className || ''), title: title }, label);
  }
  function setStatus(message, kind) {
    if (!statusBox) return;
    statusBox.className = 'notebooklm-status ' + (kind || '');
    statusBox.replaceChildren();
    statusBox.appendChild(el('span', { 'aria-hidden': 'true' }, kind === 'error' ? '⚠' : kind === 'ok' ? '✓' : 'ⓘ'));
    statusBox.appendChild(el('span', {}, message));
  }
  function setBusy(value) {
    busy = value;
    if (panel) panel.querySelectorAll('[data-nlm-submit]').forEach(function (node) { node.disabled = value; });
  }
  function selectedNotebook() {
    return activeNotebookId || (notebooks[0] && notebooks[0].id) || '';
  }
  function requireNotebook() {
    if (!selectedNotebook()) {
      setStatus('Crea o selecciona un notebook antes de usar esta función.', 'warn');
      return false;
    }
    return true;
  }
  function createPanel() {
    overlay = el('div', { id: 'notebooklm-overlay', role: 'presentation', 'aria-hidden': 'true' });
    panel = el('section', { id: 'notebooklm-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'notebooklm-title' });
    var head = el('header', { className: 'notebooklm-head' });
    var heading = el('div');
    heading.appendChild(el('div', { className: 'notebooklm-kicker' }, 'AGY · INVESTIGACIÓN ASISTIDA'));
    heading.appendChild(el('h2', { id: 'notebooklm-title' }, 'Notebook LM'));
    var headActions = el('div', { className: 'notebooklm-head-actions' });
    var helpButton = el('button', { id: 'notebooklm-help-toggle', type: 'button', 'aria-expanded': 'false' }, '❔ Ayuda');
    var nodeButton = el('button', { id: 'notebooklm-node', type: 'button', title: 'Consultar el estado HTTPS del nodo Notebook LM' }, '◉ Nodo');
    var closeButton = el('button', { id: 'notebooklm-close', type: 'button', className: 'notebooklm-close', 'aria-label': 'Cerrar Notebook LM' }, '×');
    headActions.append(helpButton, nodeButton, closeButton);
    head.append(heading, headActions);
    statusBox = el('div', { className: 'notebooklm-status', role: 'status', 'aria-live': 'polite' }, 'Comprobando configuración…');
    var body = el('div', { className: 'notebooklm-body' });
    var grid = el('div', { className: 'notebooklm-grid' });

    var notebookCard = el('section', { className: 'notebooklm-card', 'aria-labelledby': 'notebooklm-notebooks-title' });
    notebookCard.appendChild(el('h3', { id: 'notebooklm-notebooks-title' }, '1 · NOTEBOOK ACTIVO'));
    notebookCard.appendChild(el('p', {}, 'Elige dónde guardar fuentes y resultados. Entrada: título opcional. Resultado: notebook activo.'));
    var selectRow = el('div', { className: 'notebooklm-select-row' });
    notebookSelect = el('select', { id: 'notebooklm-select', className: 'notebooklm-select', 'aria-label': 'Notebook activo' });
    selectRow.appendChild(notebookSelect);
    var refreshButton = button('notebooklm-refresh', '↻', 'Actualizar la lista de notebooks');
    selectRow.appendChild(refreshButton);
    notebookCard.appendChild(selectRow);
    var createForm = el('form', { id: 'notebooklm-create-form', className: 'notebooklm-form' });
    var createInput = el('input', { id: 'notebooklm-new-title', className: 'notebooklm-input', type: 'text', maxlength: '120', placeholder: 'Título del nuevo notebook', 'aria-label': 'Título del nuevo notebook' });
    var createButton = button('notebooklm-create', '＋ Crear notebook', 'Crear un notebook nuevo con el título escrito');
    createButton.setAttribute('data-nlm-submit', '');
    createForm.append(createInput, createButton);
    notebookCard.appendChild(createForm);
    var sourceCard = el('section', { className: 'notebooklm-card', 'aria-labelledby': 'notebooklm-sources-title' });
    sourceCard.appendChild(el('h3', { id: 'notebooklm-sources-title' }, '2 · FUENTES'));
    sourceCard.appendChild(el('p', {}, 'Añade una URL web o YouTube, o un PDF local. Entrada: URL/archivo. Resultado: fuente disponible en el notebook.'));
    var urlForm = el('form', { id: 'notebooklm-url-form', className: 'notebooklm-inline' });
    var urlInput = el('input', { id: 'notebooklm-url', className: 'notebooklm-input', type: 'url', placeholder: 'https://… (web o YouTube)', 'aria-label': 'URL web o YouTube' });
    var urlButton = button('notebooklm-add-url', '＋ URL', 'Añadir esta URL como fuente');
    urlButton.setAttribute('data-nlm-submit', '');
    urlForm.append(urlInput, urlButton);
    sourceCard.appendChild(urlForm);
    var pdfForm = el('form', { id: 'notebooklm-pdf-form', className: 'notebooklm-inline' });
    var pdfInput = el('input', { id: 'notebooklm-pdf', className: 'notebooklm-file', type: 'file', accept: 'application/pdf,.pdf', 'aria-label': 'PDF para añadir como fuente' });
    var pdfButton = button('notebooklm-add-pdf', '＋ PDF', 'Subir el PDF elegido como fuente');
    pdfButton.setAttribute('data-nlm-submit', '');
    pdfForm.append(pdfInput, pdfButton);
    sourceCard.appendChild(pdfForm);
    sourcesBox = el('div', { className: 'notebooklm-sources', 'aria-live': 'polite' });
    sourceCard.appendChild(sourcesBox);
    grid.append(notebookCard, sourceCard);

    var researchCard = el('section', { className: 'notebooklm-card' });
    researchCard.appendChild(el('h3', {}, '3 · INVESTIGAR Y GENERAR'));
    researchCard.appendChild(el('p', {}, 'Genera un podcast MP3 o un reporte usando las fuentes del notebook. Entrada: notebook activo. Resultado: trabajo asíncrono y descarga cuando termine.'));
    var researchButtons = el('div', { className: 'notebooklm-inline' });
    var podcastButton = button('notebooklm-podcast', '🎙 Podcast MP3', 'Generar un podcast MP3 a partir del notebook');
    var reportButton = button('notebooklm-report', '▤ Reporte', 'Generar un reporte a partir del notebook');
    podcastButton.setAttribute('data-nlm-submit', ''); reportButton.setAttribute('data-nlm-submit', '');
    researchButtons.append(podcastButton, reportButton);
    researchCard.appendChild(researchButtons);
    var voiceCard = el('section', { className: 'notebooklm-card' });
    voiceCard.appendChild(el('h3', {}, '4 · PREGUNTAR'));
    voiceCard.appendChild(el('p', {}, 'Haz una pregunta y recibe texto más audio neuronal MP3. Entrada: pregunta. Resultado: respuesta, reproductor y descarga protegida.'));
    var voiceForm = el('form', { id: 'notebooklm-voice-form', className: 'notebooklm-form' });
    var questionInput = el('textarea', { id: 'notebooklm-question', className: 'notebooklm-textarea', rows: '2', maxlength: '4000', placeholder: '¿Qué quieres saber sobre tus fuentes?', 'aria-label': 'Pregunta para Notebook LM' });
    var voiceButton = button('notebooklm-voice', '🔊 Preguntar', 'Enviar la pregunta al notebook activo', 'accent');
    voiceButton.setAttribute('data-nlm-submit', '');
    voiceForm.append(questionInput, voiceButton);
    voiceCard.appendChild(voiceForm);
    var newsCard = el('section', { className: 'notebooklm-card' });
    newsCard.appendChild(el('h3', {}, '5 · NOTICIAS'));
    newsCard.appendChild(el('p', {}, 'Prepara un resumen usando las fuentes existentes del notebook y publícalo en el canal. Siempre pide confirmación antes de publicar.'));
    var newsForm = el('form', { id: 'notebooklm-news-form', className: 'notebooklm-form' });
    var newsButton = button('notebooklm-news', '📰 Preparar noticia', 'Preparar un resumen de noticias usando las fuentes existentes', 'accent');
    newsButton.setAttribute('data-nlm-submit', '');
    newsForm.append(newsButton);
    var confirmBox = el('div', { id: 'notebooklm-news-confirm', className: 'notebooklm-confirm', role: 'alert' });
    confirmBox.hidden = true;
    confirmBox.appendChild(el('div', {}, 'Vista previa del resumen generado con las fuentes existentes. Confirma solo si quieres publicarlo:'));
    var confirmText = el('div', { id: 'notebooklm-confirm-text', className: 'notebooklm-result-text' });
    confirmBox.appendChild(confirmText);
    var confirmActions = el('div', { className: 'notebooklm-confirm-actions' });
    var confirmButton = button('notebooklm-news-confirm', '✓ Publicar en grupo', 'Publicar este resumen en el grupo', 'accent');
    var cancelButton = button('notebooklm-news-cancel', 'Cancelar', 'Cancelar la publicación de noticias', 'secondary');
    confirmActions.append(confirmButton, cancelButton); confirmBox.appendChild(confirmActions);
    newsCard.append(newsForm, confirmBox);
    grid.append(researchCard, voiceCard, newsCard);
    body.appendChild(grid);
    resultBox = el('section', { className: 'notebooklm-result', hidden: true, 'aria-live': 'polite' });
    body.appendChild(resultBox);
    var jobsSection = el('section', { className: 'notebooklm-jobs', 'aria-labelledby': 'notebooklm-jobs-title' });
    jobsSection.appendChild(el('h3', { id: 'notebooklm-jobs-title', className: 'notebooklm-card' }, 'Trabajos recientes'));
    jobsBox = el('div', { className: 'notebooklm-card' });
    jobsSection.appendChild(jobsBox); body.appendChild(jobsSection);
    var help = el('section', { id: 'notebooklm-help', className: 'notebooklm-help', hidden: true });
    help.appendChild(el('h3', {}, 'Guía rápida: todo se hace con botones'));
    var helpList = el('ol');
    [['Elige o crea un notebook', 'selecciona el contexto donde se guardarán las fuentes.'],
     ['Añade fuentes', 'pega una URL web/YouTube o selecciona un PDF y pulsa su botón.'],
     ['Genera', 'usa Podcast MP3, Reporte o Preguntar; verás el progreso y el resultado real.'],
     ['Noticias', 'prepara un resumen desde las fuentes existentes, revisa la vista previa y confirma explícitamente antes de publicar en el canal.'],
     ['Estado y ayuda', '◉ Nodo comprueba HTTPS; ❔ Ayuda muestra esta explicación; × cierra sin perder el IDE.']]
      .forEach(function (item) { var li = el('li'); li.appendChild(el('strong', {}, item[0] + ': ')); li.appendChild(el('span', {}, item[1])); helpList.appendChild(li); });
    help.appendChild(helpList); body.appendChild(help);
    panel.append(head, statusBox, body); overlay.appendChild(panel); document.body.appendChild(overlay);

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    helpButton.addEventListener('click', function () {
      var isHidden = help.hidden; help.hidden = !isHidden; helpButton.setAttribute('aria-expanded', String(isHidden));
    });
    nodeButton.addEventListener('click', checkNode);
    refreshButton.addEventListener('click', loadNotebooks);
    notebookSelect.addEventListener('change', selectNotebook);
    createForm.addEventListener('submit', function (event) { event.preventDefault(); createNotebook(createInput, createButton); });
    urlForm.addEventListener('submit', function (event) { event.preventDefault(); addUrl(urlInput, urlButton); });
    pdfForm.addEventListener('submit', function (event) { event.preventDefault(); addPdf(pdfInput, pdfButton); });
    podcastButton.addEventListener('click', function () { submitJob('podcast', podcastButton); });
    reportButton.addEventListener('click', function () { submitJob('report', reportButton); });
    voiceForm.addEventListener('submit', function (event) { event.preventDefault(); ask(questionInput, voiceButton); });
    newsForm.addEventListener('submit', function (event) { event.preventDefault(); prepareNews(confirmBox, confirmText, newsButton); });
    cancelButton.addEventListener('click', function () { cancelNewsDraft(confirmBox, confirmText); });
    confirmButton.addEventListener('click', function () { submitNews(confirmBox, confirmText, confirmButton, cancelButton); });
    document.getElementById('btn-notebooklm').addEventListener('click', open);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && opened) close(); });
    document.addEventListener('visibilitychange', function () {
      if (!opened) return;
      if (document.hidden) stopNotebookRefresh();
      else { loadNotebooks(); scheduleNotebookRefresh(); }
    });
    renderJobs([]);
  }
  function stopNotebookRefresh() {
    if (notebookRefreshTimer) clearTimeout(notebookRefreshTimer);
    notebookRefreshTimer = null;
  }
  function scheduleNotebookRefresh() {
    stopNotebookRefresh();
    if (!opened || document.hidden) return;
    notebookRefreshTimer = setTimeout(function () {
      notebookRefreshTimer = null;
      loadNotebooks().finally(scheduleNotebookRefresh);
    }, NOTEBOOK_REFRESH_MS);
  }
  async function open() {
    if (!overlay) createPanel();
    opened = true; overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('notebooklm-close').focus();
    setStatus('Comprobando configuración y acceso…', '');
    scheduleNotebookRefresh();
    await Promise.all([loadStatus(), loadNotebooks()]);
  }
  function close() {
    if (!overlay) return;
    opened = false; overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
    stopNotebookRefresh();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = ''; }
    document.getElementById('btn-notebooklm').focus();
  }
  async function loadStatus() {
    try {
      var data = await request('/status');
      if (data.configured && data.authenticated) setStatus(data.message || 'Notebook LM está disponible.', 'ok');
      else setStatus(data.message || 'Notebook LM no está configurado o la sesión no está autenticada. Revisa la configuración del servidor.', 'warn');
    } catch (error) { setStatus(error.message, 'error'); }
  }
  function renderNotebooks(errorMessage) {
    var fingerprint = errorMessage
      ? 'error:' + errorMessage
      : JSON.stringify(notebooks.map(function (notebook) {
        return [String(notebook.id), String(notebook.title || notebook.id)];
      })) + ':' + activeNotebookId;
    if (fingerprint === notebookOptionsFingerprint) return;
    notebookOptionsFingerprint = fingerprint;
    notebookSelect.replaceChildren();
    if (errorMessage) {
      notebookSelect.appendChild(el('option', { value: '' }, 'No se pudieron cargar los notebooks'));
      return;
    }
    if (!notebooks.length) {
      notebookSelect.appendChild(el('option', { value: '' }, 'Sin notebooks todavía'));
      return;
    }
    notebooks.forEach(function (notebook) {
      var option = el('option', { value: notebook.id }, notebook.title || notebook.id);
      option.selected = notebook.id === activeNotebookId; notebookSelect.appendChild(option);
    });
  }
  async function loadNotebooks() {
    if (notebookRefreshInFlight) return;
    notebookRefreshInFlight = true;
    try {
      var data = await request('/notebooks');
      var nextNotebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
      var currentStillExists = nextNotebooks.some(function (notebook) { return String(notebook.id) === String(activeNotebookId); });
      var serverStillExists = nextNotebooks.some(function (notebook) { return String(notebook.id) === String(data.activeNotebookId || ''); });
      notebooks = nextNotebooks;
      var nextNotebookId = currentStillExists
        ? activeNotebookId
        : (serverStillExists ? data.activeNotebookId : ((notebooks[0] && notebooks[0].id) || ''));
      if (activeNotebookId && nextNotebookId !== activeNotebookId) invalidateNewsDraft();
      activeNotebookId = nextNotebookId;
      renderNotebooks(); await loadSources();
    } catch (error) {
      invalidateNewsDraft();
      notebooks = []; activeNotebookId = ''; renderNotebooks(error.message); renderSources([]);
      setStatus(error.message, 'error');
    } finally {
      notebookRefreshInFlight = false;
    }
  }
  async function createNotebook(input, actionButton) {
    if (busy) return;
    var title = input.value.trim();
    if (!title) { setStatus('Escribe un título para crear el notebook.', 'warn'); input.focus(); return; }
    invalidateNewsDraft();
    setBusy(true);
    try {
      var data = await request('/notebooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) });
      if (data.notebook) notebooks.push(data.notebook);
      activeNotebookId = data.activeNotebookId || (data.notebook && data.notebook.id) || activeNotebookId;
      input.value = ''; renderNotebooks(); await loadSources(); setStatus('Notebook creado y seleccionado.', 'ok');
      await loadNotebooks();
    } catch (error) { setStatus(error.message, 'error'); }
    finally { setBusy(false); }
  }
  async function selectNotebook() {
    var id = notebookSelect.value;
    if (!id || id === activeNotebookId) return;
    invalidateNewsDraft();
    try {
      var data = await request('/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: id }) });
      activeNotebookId = data.activeNotebookId || id; renderNotebooks(); await loadSources(); setStatus('Notebook activo actualizado.', 'ok');
    } catch (error) { setStatus(error.message, 'error'); renderNotebooks(); }
  }
  function renderSources(sources) {
    sourcesBox.replaceChildren();
    if (!sources.length) { sourcesBox.appendChild(el('div', { className: 'notebooklm-empty' }, selectedNotebook() ? 'No hay fuentes en este notebook.' : 'Selecciona o crea un notebook para ver sus fuentes.')); return; }
    sources.forEach(function (source) {
      var row = el('div', { className: 'notebooklm-source' });
      row.appendChild(el('span', { className: 'notebooklm-source-title' }, source.title || 'Fuente sin título'));
      row.appendChild(el('span', { className: 'notebooklm-source-type' }, source.type || 'fuente'));
      sourcesBox.appendChild(row);
    });
  }
  async function loadSources() {
    if (!selectedNotebook()) { renderSources([]); return; }
    try { var data = await request('/sources?notebookId=' + encodeURIComponent(selectedNotebook())); renderSources(Array.isArray(data.sources) ? data.sources : []); }
    catch (error) { renderSources([]); setStatus(error.message, 'error'); }
  }
  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer), binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  async function addUrl(input) {
    if (busy || !requireNotebook()) return;
    var url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) { setStatus('Escribe una URL válida que empiece por https:// o http://.', 'warn'); input.focus(); return; }
    var actionButton = document.getElementById('notebooklm-add-url'); setBusy(true);
    var jobStarted = false;
    try { await startJob({ action: 'source_url', url: url }, actionButton); jobStarted = true; input.value = ''; }
    catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  async function addPdf(input) {
    if (busy || !requireNotebook()) return;
    var file = input.files && input.files[0];
    if (!file) { setStatus('Selecciona un archivo PDF antes de pulsar el botón.', 'warn'); return; }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setStatus('Solo se admiten archivos PDF.', 'warn'); return; }
    if (file.size > 4 * 1024 * 1024) { setStatus('El PDF supera el límite de 4 MB. Elige un archivo más pequeño.', 'warn'); input.value = ''; return; }
    var actionButton = document.getElementById('notebooklm-add-pdf'); setBusy(true);
    var jobStarted = false;
    try {
      var base64 = arrayBufferToBase64(await file.arrayBuffer());
      await startJob({ action: 'source_pdf', filename: file.name, pdfBase64: base64 }, actionButton); jobStarted = true; input.value = '';
    } catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  async function ask(input, actionButton) {
    if (busy || !requireNotebook()) return;
    var question = input.value.trim();
    if (!question) { setStatus('Escribe una pregunta antes de pulsar Preguntar.', 'warn'); input.focus(); return; }
    setBusy(true); var jobStarted = false;
    try { await startJob({ action: 'voice', question: question }, actionButton); jobStarted = true; input.value = ''; }
    catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  function invalidateNewsDraft() {
    newsDraftToken++;
    newsDraft = null;
    var box = document.getElementById('notebooklm-news-confirm');
    var textBox = document.getElementById('notebooklm-confirm-text');
    if (box) { box.classList.remove('open'); box.hidden = true; }
    if (textBox) textBox.textContent = '';
  }
  function cancelNewsDraft(box, textBox) {
    invalidateNewsDraft();
    if (box) { box.classList.remove('open'); box.hidden = true; }
    if (textBox) textBox.textContent = '';
  }
  async function prepareNews(box, textBox, actionButton) {
    if (busy || !requireNotebook()) return;
    invalidateNewsDraft();
    var notebookId = selectedNotebook();
    var token = newsDraftToken;
    setBusy(true);
    var jobStarted = false;
    try {
      await startJob({ action: 'news_draft', notebookId: notebookId }, actionButton, { notebookId: notebookId, newsDraftToken: token });
      jobStarted = true;
    } catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  async function submitNews(box, textBox, actionButton, cancelButton) {
    if (busy) return;
    var draft = newsDraft;
    if (!draft || draft.token !== newsDraftToken || draft.notebookId !== selectedNotebook()) {
      cancelNewsDraft(box, textBox);
      setStatus('La vista previa ya no es válida porque cambió el notebook o se preparó otro borrador.', 'warn');
      return;
    }
    newsDraft = null;
    newsDraftToken++;
    actionButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    setBusy(true); box.classList.remove('open'); box.hidden = true;
    var jobStarted = false;
    try {
      await startJob({ action: 'news_publish', notebookId: draft.notebookId, draftId: draft.draftId, confirmed: true }, actionButton);
      jobStarted = true;
    }
    catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  async function submitJob(action, actionButton) {
    if (busy || !requireNotebook()) return;
    setBusy(true); var jobStarted = false;
    try { await startJob({ action: action }, actionButton); jobStarted = true; }
    catch (_) {} finally { if (!jobStarted) setBusy(false); }
  }
  async function startJob(payload, actionButton, context) {
    payload.notebookId = payload.notebookId || selectedNotebook();
    var data = await request('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!data.id) throw new Error('El servicio no devolvió un identificador de trabajo.');
    jobActions[data.id] = payload.action;
    jobContexts[data.id] = context || { notebookId: payload.notebookId };
    setStatus('Trabajo enviado. Esperando resultado real…', '');
    addJob({ id: data.id, status: data.status || 'queued', message: 'En cola' });
    pollJob(data.id, payload.action, actionButton);
  }
  function addJob(job) {
    var existing = jobsBox.querySelector('[data-job-id="' + CSS.escape(String(job.id)) + '"]');
    if (existing) existing.remove();
    var row = el('div', { className: 'notebooklm-job', 'data-job-id': String(job.id) });
    row.append(el('span', { className: 'notebooklm-job-state' }, String(job.status || '').toUpperCase()), el('span', { className: 'notebooklm-job-message' }, job.message || ''));
    if (job.status === 'error' || job.status === 'paused') {
      var refresh = button('', 'Consultar resultado', 'Volver a consultar este trabajo sin ejecutarlo otra vez');
      refresh.addEventListener('click', function () {
        if (busy) return;
        setBusy(true);
        refresh.disabled = true;
        pollJob(job.id, jobActions[job.id]);
      });
      row.appendChild(refresh);
    }
    jobsBox.prepend(row);
  }
  function renderJobs(jobs) {
    jobsBox.replaceChildren();
    if (!jobs.length) { jobsBox.appendChild(el('div', { className: 'notebooklm-empty' }, 'Todavía no hay trabajos en esta sesión.')); return; }
    jobs.forEach(addJob);
  }
  function showNewsDraft(data, context) {
    var result = data && data.result;
    if (!context || context.newsDraftToken !== newsDraftToken ||
        context.notebookId !== selectedNotebook() ||
        !result || result.notebookId !== context.notebookId) {
      invalidateNewsDraft();
      setStatus('La vista previa de noticias se descartó porque cambió el notebook o quedó antigua.', 'warn');
      return false;
    }
    if (typeof result.text !== 'string' || !result.draftId) {
      invalidateNewsDraft();
      setStatus('El servicio no devolvió un borrador de noticias válido.', 'error');
      return false;
    }
    if (result.text.length > MAX_NEWS_SUMMARY_UTF16) {
      invalidateNewsDraft();
      setStatus('El resumen de noticias supera el límite de 3500 caracteres.', 'error');
      return false;
    }
    newsDraft = {
      text: result.text,
      draftId: result.draftId,
      notebookId: result.notebookId,
      token: newsDraftToken
    };
    var box = document.getElementById('notebooklm-news-confirm');
    var textBox = document.getElementById('notebooklm-confirm-text');
    if (!box || !textBox) return false;
    var publishButton = document.getElementById('notebooklm-news-confirm');
    var cancelButton = document.getElementById('notebooklm-news-cancel');
    if (publishButton) publishButton.disabled = false;
    if (cancelButton) cancelButton.disabled = false;
    resultBox.hidden = true;
    textBox.textContent = result.text;
    box.hidden = false;
    box.classList.add('open');
    return true;
  }
  function showResult(data, action, context) {
    if (action === 'news_draft') return showNewsDraft(data, context);
    resultBox.hidden = false; resultBox.replaceChildren();
    resultBox.appendChild(el('h4', {}, 'RESULTADO · ' + String(action || 'TRABAJO').toUpperCase()));
    if (data.text) resultBox.appendChild(el('div', { className: 'notebooklm-result-text' }, data.text));
    var result = data.result || data;
    if (result.text && !data.text) resultBox.appendChild(el('div', { className: 'notebooklm-result-text' }, result.text));
    if (result.downloadUrl) {
      var actions = el('div', { className: 'notebooklm-result-actions' });
      var download = button('notebooklm-download', '⇩ Descargar ' + (result.fileName || 'archivo'), 'Descargar el archivo con autenticación');
      download.addEventListener('click', function () { downloadFile(result.downloadUrl, result.fileName || 'notebooklm-result', result.mimeType || 'application/octet-stream', download); });
      actions.appendChild(download); resultBox.appendChild(actions);
      if ((result.mimeType || '').indexOf('audio/') === 0) {
        var audio = el('audio', { className: 'notebooklm-audio', controls: '', 'aria-label': 'Reproducir audio generado' });
        audio.addEventListener('error', function () { setStatus('No fue posible reproducir el audio descargado.', 'error'); });
        actions.prepend(audio); downloadFile(result.downloadUrl, result.fileName || 'notebooklm.mp3', result.mimeType, null, audio);
      }
    }
    if (!data.text && !result.text && !result.downloadUrl) resultBox.appendChild(el('div', { className: 'notebooklm-empty' }, 'El trabajo terminó sin contenido visible.'));
  }
  async function downloadFile(path, filename, mime, trigger, audio) {
    try {
      var fileUrl = new URL(path, window.location.origin);
      if (fileUrl.origin !== window.location.origin || !/^\/api\/notebooklm\/files\/[A-Za-z0-9_-]{1,100}$/.test(fileUrl.pathname) || fileUrl.search || fileUrl.hash) {
        throw new Error('Notebook LM devolvió una dirección de descarga no válida.');
      }
      var response = await fetch(fileUrl.toString(), { headers: authHeaders(), redirect: 'error' });
      if (!response.ok) throw new Error('No se pudo descargar el archivo (HTTP ' + response.status + ').');
      var blob = await response.blob(), url = URL.createObjectURL(blob);
      if (audio) { if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = url; audio.src = url; audio.load(); return; }
      var link = document.createElement('a'); link.href = url; link.download = filename; link.rel = 'noopener'; link.click();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (error) { setStatus(error.message, 'error'); }
  }
  function pollJob(id, action, actionButton) {
    var attempts = 0;
    function tick() {
      request('/jobs/' + encodeURIComponent(id)).then(function (data) {
        addJob(data); var state = data.status;
        if (state === 'completed') {
          setBusy(false);
          var displayed = showResult(data, action, jobContexts[id]);
          loadSources();
          if (displayed !== false) setStatus('Trabajo completado.', 'ok');
          return;
        }
        if (state === 'failed') { setBusy(false); setStatus(data.message || 'El trabajo falló sin explicación adicional.', 'error'); return; }
        attempts++;
        if (attempts >= 1200) {
          setBusy(false);
          addJob({ id: id, status: 'paused', message: 'La consulta automática se pausó; el trabajo no se canceló.' });
          setStatus('El trabajo sigue en curso. Usa Consultar resultado para revisar su estado sin repetirlo.', 'warn'); return;
        }
        jobTimers[id] = window.setTimeout(tick, 2000);
      }).catch(function (error) { setBusy(false); addJob({ id: id, status: 'error', message: error.message }); setStatus(error.message, 'error'); });
    }
    tick();
  }
  async function checkNode() {
    var nodeButton = document.getElementById('notebooklm-node');
    nodeButton.disabled = true; nodeButton.textContent = '◌ Nodo…';
    try {
      var data = await request('/nodes');
      setStatus((data.message || 'Nodo: ' + (data.status || 'sin detalle')) + (data.url ? ' · ' + data.url : ''), data.online ? 'ok' : 'warn');
    } catch (error) { setStatus(error.message, 'error'); }
    finally { nodeButton.disabled = false; nodeButton.textContent = '◉ Nodo'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
  else createPanel();
})();