'use strict';
const crypto = require('node:crypto');
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const REQUEST_TIMEOUT_MS = 50000;
const JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;
function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}
function createNotebookClient(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutSignal = options.timeoutSignal || ((milliseconds) => AbortSignal.timeout(milliseconds));
  const port = Number(options.port || env.PORT);
  const password = String(options.password || env.AGY_IDE_PASSWORD || '');
  async function request(method, path, body) {
    if (!password || !Number.isSafeInteger(port) || port <= 0) throw new Error('Notebook LM no está configurado en este servidor.');
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/notebooklm${path}`, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-agyide-pwd': encodeURIComponent(password) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data.error || data.message || 'Notebook LM no respondió correctamente.'));
    return data;
  }
  async function listNotebooks() {
    const data = await request('GET', '/notebooks');
    const source = Array.isArray(data) ? data : Array.isArray(data.notebooks) ? data.notebooks : Array.isArray(data.items) ? data.items : [];
    const notebooks = source.map((item) => ({
      id: String(item && (item.id || item.notebookId || item.notebook_id || item.uuid) || ''),
      title: String(item && (item.title || item.name) || '').trim()
    })).filter((item) => ID.test(item.id) && item.title);
    return { ok: true, count: notebooks.length, notebooks };
  }
  async function searchNotebooks(query) {
    const data = await listNotebooks();
    const needle = fold(query);
    const notebooks = data.notebooks.filter((item) => fold(item.title).includes(needle));
    return { ok: true, count: notebooks.length, notebooks };
  }
  async function listSources(notebookId) {
    if (!ID.test(String(notebookId || ''))) throw new Error('Cuaderno no válido.');
    return request('GET', `/sources?notebookId=${encodeURIComponent(notebookId)}`);
  }
  async function ask(notebookId, question) {
    if (!ID.test(String(notebookId || ''))) throw new Error('Cuaderno no válido.');
    const clean = String(question || '').trim();
    if (!clean) throw new Error('Falta la pregunta para Notebook LM.');
    return request('POST', '/jobs', { action: 'notebook_ask', notebookId, question: clean });
  }
  async function research(topic, requestId, notebookId) {
    const clean = String(topic || '').trim();
    if (!clean) throw new Error('Falta el tema que se debe investigar.');
    if (!ID.test(String(notebookId || ''))) throw new Error('Cuaderno no válido.');
    const body = { action: 'notebook_research', topic: clean, notebookId: String(notebookId) };
    if (requestId !== undefined) {
      if (!ID.test(String(requestId))) throw new Error('Identificador de solicitud no válido.');
      body.requestId = String(requestId);
    }
    return request('POST', '/jobs', body);
  }
  async function jobStatus(jobId) {
    if (!ID.test(String(jobId || ''))) throw new Error('Trabajo no válido.');
    return request('GET', `/jobs/${encodeURIComponent(jobId)}`);
  }
  return { listNotebooks, searchNotebooks, listSources, ask, research, jobStatus };
}
function createJobPoller(client, onFinal, options = {}) {
  const intervalMs = options.intervalMs || 2000;
  const timeoutMs = options.timeoutMs || JOB_POLL_TIMEOUT_MS;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const jobs = new Map();
  function schedule(fn, delay) {
    const timer = setTimer(fn, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  }
  function terminal(data) {
    const status = String(data && (data.status || (data.job && data.job.status)) || '').toLowerCase();
    return ['complete', 'completed', 'done', 'failed', 'error', 'cancelled'].includes(status);
  }
  async function emit(jobId, result) {
    try { await onFinal(jobId, result); } catch {
      // Conversation/socket may have closed after the final status arrived.
    }
  }
  function watch(jobId) {
    if (!ID.test(String(jobId || '')) || jobs.has(jobId)) return;
    const started = Date.now();
    const state = { timer: null, cancelled: false };
    jobs.set(jobId, state);
    const poll = async () => {
      if (state.cancelled) return;
      try {
        const result = await client.jobStatus(jobId);
        if (state.cancelled) return;
        if (terminal(result)) { jobs.delete(jobId); await emit(jobId, result); return; }
      } catch (error) {
        if (state.cancelled) return;
        if (Date.now() - started >= timeoutMs) {
          jobs.delete(jobId);
          await emit(jobId, { status: 'timeout', recoverable: true, jobId, error: 'No se pudo confirmar el estado final dentro del plazo.' });
          return;
        }
      }
      if (state.cancelled) return;
      if (Date.now() - started >= timeoutMs) {
        jobs.delete(jobId);
        await emit(jobId, { status: 'timeout', recoverable: true, jobId, message: 'El trabajo sigue siendo recuperable mediante su identificador.' });
        return;
      }
      state.timer = schedule(poll, intervalMs);
    };
    state.timer = schedule(poll, 0);
  }
  function close() {
    for (const state of jobs.values()) { state.cancelled = true; if (state.timer) clearTimer(state.timer); }
    jobs.clear();
  }
  return { watch, close };
}
function publicFailure() {
  return { ok: false, error: 'Notebook LM no pudo completar la consulta. Comprueba el servicio o recupera el trabajo por su identificador.' };
}
function deriveResearchRequestId(sessionNonce, callId) {
  return crypto.createHash('sha256').update(`${String(sessionNonce)}:${String(callId)}`).digest('hex');
}
module.exports = {
  REQUEST_TIMEOUT_MS, JOB_POLL_TIMEOUT_MS, createNotebookClient, createJobPoller,
  deriveResearchRequestId, fold, publicFailure
};