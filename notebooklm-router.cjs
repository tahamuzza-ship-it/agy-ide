'use strict';

const crypto = require('node:crypto');

const ROUTER_ID = 'agyide_notebooklm_router_v1';
const ROUTER_PROJECT = 'agy-ide-notebooklm-router';
const VERSION = 1;
const MAX_JOBS = 1000;
const ACTOR = 'notebooklm-router-admin-v1';
// NotebookLM operations are intentionally cloud-only.  PC1/PC2 and
// Antigravity are separate mission executors and must never become an
// implicit transport fallback for this API.
const ROUTES = new Set(['cloud']);
const LEGACY_ROUTES = new Set(['auto', 'pc2']);
const ROUTER_ID_RE = /^nlmr_[a-f0-9]{32}$/;

function now() { return new Date().toISOString(); }
function nextTimestamp(previous) {
  const current = Date.now();
  const prior = Date.parse(previous || '');
  return new Date(Number.isFinite(prior) ? Math.max(current, prior + 1) : current).toISOString();
}
function newId() { return `nlmr_${crypto.randomUUID().replaceAll('-', '')}`; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function payloadHash(operation, body) {
  return crypto.createHash('sha256').update(canonical({ operation, body })).digest('hex');
}
function emptyDocument() {
  return { version: VERSION, route: 'cloud', jobs: [], resources: [], updatedAt: now() };
}
function parseDocument(row) {
  if (!row) return null;
  let value = row.messages;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('ROUTER_STORE_INVALID'); }
  }
  if (!value || value.version !== VERSION
    || (!ROUTES.has(value.route) && !LEGACY_ROUTES.has(value.route))
    || !Array.isArray(value.jobs)) {
    throw new Error('ROUTER_STORE_INVALID');
  }
  return {
    ...value,
    resources: Array.isArray(value.resources) ? value.resources : [],
    updatedAt: row.updated_at || value.updatedAt
  };
}
function rowFor(document) {
  return {
    id: ROUTER_ID,
    project: ROUTER_PROJECT,
    title: 'NotebookLM durable router',
    messages: document,
    updated_at: document.updatedAt
  };
}

function createSupabaseRouterStore(env = process.env, options = {}) {
  const url = String(env.SUPABASE_URL_2 || 'https://lxlcivzuevowckbcxczc.supabase.co').replace(/\/+$/, '');
  const key = String(env.SUPABASE_KEY_2 || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '');
  let client = options.supabaseClient;
  function getClient() {
    if (client) return client;
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return client;
  }
  return {
    configured: Boolean(url && key),
    async get() {
      if (!this.configured) throw new Error('ROUTER_STORE_NOT_CONFIGURED');
      const result = await getClient().from('cibercode_chats')
        .select('id,project,messages,updated_at').eq('id', ROUTER_ID)
        .eq('project', ROUTER_PROJECT).maybeSingle();
      if (result.error) throw result.error;
      return parseDocument(result.data);
    },
    async insert(document) {
      const result = await getClient().from('cibercode_chats').insert(rowFor(document));
      if (result.error) throw result.error;
    },
    async compareAndSet(previous, document) {
      const result = await getClient().from('cibercode_chats')
        .update({ title: 'NotebookLM durable router', messages: document, updated_at: document.updatedAt })
        .eq('id', ROUTER_ID).eq('project', ROUTER_PROJECT).eq('updated_at', previous.updatedAt).select('id');
      if (result.error) throw result.error;
      return Array.isArray(result.data) && result.data.length === 1;
    }
  };
}

function isConflict(error) {
  return Boolean(error && (error.code === '23505' || error.status === 409 || error.statusCode === 409));
}

function createRouterRepository(store, actor = ACTOR) {
  async function transact(change) {
    if (!store || store.configured === false) throw new Error('ROUTER_STORE_NOT_CONFIGURED');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let current = await store.get();
      if (!current) {
        current = emptyDocument();
        try { await store.insert(current); } catch (error) { if (!isConflict(error)) throw error; }
        const loaded = await store.get();
        if (loaded) current = loaded;
      }
      const draft = structuredClone(current);
      const result = await change(draft);
      if (result && result.noWrite) return result.value;
      draft.updatedAt = nextTimestamp(current.updatedAt);
      if (await store.compareAndSet(current, draft)) return result && result.value;
    }
    throw new Error('ROUTER_STORE_CONFLICT');
  }
  return {
    async getDocument() {
      if (!store || store.configured === false) throw new Error('ROUTER_STORE_NOT_CONFIGURED');
      return (await store.get()) || emptyDocument();
    },
    async getRoute() {
      const document = await this.getDocument();
      if (document.route === 'cloud') return 'cloud';
      // Migrate only the route field.  Jobs/resources are deliberately copied
      // untouched so this CAS cannot erase durable history.
      return transact((draft) => {
        draft.route = 'cloud';
        return { value: 'cloud' };
      });
    },
    setRoute(route) {
      if (!ROUTES.has(route)) throw new Error('ROUTE_INVALID');
      return transact((doc) => { doc.route = route; return { value: route }; });
    },
    reserve({ idempotencyKey, hash, executor, operation }) {
      return transact((doc) => {
        const existing = doc.jobs.find((job) => job.actor === actor && job.idempotencyKey === idempotencyKey);
        if (existing) {
          if (existing.hash !== hash || existing.operation !== operation) {
            return { noWrite: true, value: { conflict: true, job: existing } };
          }
          return { noWrite: true, value: { existing: true, job: existing } };
        }
        if (doc.jobs.length >= MAX_JOBS) throw new Error('ROUTER_CAPACITY');
        const job = {
          id: newId(), actor, idempotencyKey, hash, executor, operation,
          state: 'prepared', hubJobId: null, createdAt: now(), updatedAt: now()
        };
        doc.jobs.push(job);
        return { value: { job } };
      });
    },
    claim(id) {
      return transact((doc) => {
        const job = doc.jobs.find((item) => item.id === id && item.actor === actor);
        if (!job || job.state !== 'prepared') return { noWrite: true, value: null };
        job.state = 'sending';
        job.updatedAt = now();
        return { value: structuredClone(job) };
      });
    },
    transition(id, from, state, extra = {}) {
      return transact((doc) => {
        const job = doc.jobs.find((item) => item.id === id && item.actor === actor);
        if (!job || !from.includes(job.state)) return { noWrite: true, value: false };
        Object.assign(job, extra, { state, updatedAt: now() });
        return { value: true };
      });
    },
    async find(id) {
      const doc = await this.getDocument();
      return doc.jobs.find((job) => job.id === id && job.actor === actor) || null;
    },
    async findResource(id) {
      const doc = await this.getDocument();
      return doc.resources.find((resource) => resource.id === id && resource.actor === actor) || null;
    },
    mapResource({ executor, kind, upstreamId, jobId }) {
      return transact((doc) => {
        if (!Array.isArray(doc.resources)) doc.resources = [];
        const existing = doc.resources.find((resource) => resource.actor === actor
          && resource.executor === executor && resource.kind === kind
          && resource.upstreamId === upstreamId);
        if (existing) return { noWrite: true, value: existing };
        if (doc.resources.length >= MAX_JOBS * 4) throw new Error('ROUTER_CAPACITY');
        const resource = {
          id: newId(), actor, executor, kind, upstreamId, jobId, createdAt: now()
        };
        doc.resources.push(resource);
        return { value: resource };
      });
    }
  };
}

function validBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}
function responseError(status, error, route, code) {
  return { local: true, status, data: { error, route, ...(code ? { code } : {}) }, route };
}
async function cloudAuthError(response) {
  if (!response || response.status !== 401) return null;
  let code = 'CLOUD_AUTH_REQUIRED';
  if (typeof response.clone === 'function') {
    try {
      const data = await response.clone().json();
      const upstream = String(data && (data.code || data.error) || '').toUpperCase();
      if (upstream === 'SESSION_REQUIRED') code = 'CLOUD_SESSION_REQUIRED';
      else if (upstream === 'SESSION_EXPIRED' || upstream === 'AUTH_SESSION_EXPIRED') code = 'CLOUD_SESSION_EXPIRED';
    } catch {}
  }
  return responseError(401, 'NotebookLM Cloud requiere una sesión de Google válida.', 'cloud', code);
}
async function jsonResponse(response) {
  const text = await response.text();
  try { return { data: JSON.parse(text), text }; } catch { return { data: null, text }; }
}
function operationFor(suffix, body) {
  if (suffix === '/notebooks') return body ? 'create_notebook' : 'list_notebooks';
  if (suffix === '/sources') return 'list_sources';
  if (suffix === '/active') return 'set_active';
  if (suffix === '/jobs') return body && body.action || 'list_jobs';
  return suffix;
}
function cloudSupports(method, suffix, body) {
  if (method === 'GET') return ['/status', '/notebooks', '/sources', '/nodes', '/jobs'].includes(suffix);
  if (method === 'POST' && suffix === '/notebooks') return true;
  return method === 'POST' && suffix === '/jobs' && body
    && ['notebook_ask', 'notebook_research'].includes(body.action);
}
function createNotebookRouter(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const store = options.routerStore || createSupabaseRouterStore(env, options);
  const token = String(env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN || '');
  const cloudBase = validBase(env.NOTEBOOKLM_CLOUD_URL);
  const cloudEnabled = env.NOTEBOOKLM_CLOUD_ENABLED === 'true';
  const actor = String(env.NOTEBOOKLM_ROUTER_ADMIN_PRINCIPAL || ACTOR);
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(actor)) throw new Error('NOTEBOOKLM_ROUTER_ADMIN_PRINCIPAL is invalid');
  const repository = options.repository || createRouterRepository(store, actor);
  async function baseFor(route) {
    if (route === 'cloud') return cloudEnabled && cloudBase ? cloudBase : null;
    return null;
  }
  async function call(route, method, suffix, query, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = await Promise.race([
        baseFor(route),
        new Promise((_, reject) => controller.signal.addEventListener('abort',
          () => reject(Object.assign(new Error('ROUTE_TIMEOUT'), { route })), { once: true }))
      ]);
      if (!base) throw Object.assign(new Error('ROUTE_UNAVAILABLE'), { route });
      const url = new URL(`${base}/api/notebooklm${suffix}`);
      if (suffix === '/sources' && query && query.notebookId) url.searchParams.set('notebookId', query.notebookId);
      return await fetchImpl(url, {
        method,
        headers: {
          Accept: suffix.startsWith('/files/') ? '*/*' : 'application/json',
          'Content-Type': 'application/json',
          'X-SGN-Token': token,
          // Preserve the Hub's historical ownership namespace. The durable
          // router principal is authorization metadata, not a Hub actor.
          'X-SGN-Actor': 'ide'
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
  }
  async function cloudReady(timeoutMs = 7000) {
    if (!cloudEnabled || !cloudBase || !token) return false;
    try {
      const response = await call('cloud', 'GET', '/status', null, null, timeoutMs);
      if (!response.ok) return false;
      const { data } = await jsonResponse(response);
      return Boolean(data && data.configured === true && data.authenticated === true);
    } catch { return false; }
  }
  async function selectRoute(preference, method, suffix, body, readinessTimeout) {
    // Keep the durable preference for observability, but never let it select
    // a non-cloud executor.  Availability is reported by dispatch, not by
    // silently switching to another node.
    return 'cloud';
  }
  async function rewriteJobResult(data, job) {
    const output = { ...data, id: job.id, jobId: job.id, route: job.executor };
    if (output.job && typeof output.job === 'object') {
      output.job = { ...output.job, id: job.id, jobId: job.id };
    }
    if (!output.result || typeof output.result !== 'object' || Array.isArray(output.result)) return output;
    const result = { ...output.result };
    const fileMatch = typeof result.downloadUrl === 'string'
      ? result.downloadUrl.match(/^\/api\/notebooklm\/files\/([A-Za-z0-9_-]{1,160})$/) : null;
    if (fileMatch) {
      const resource = await repository.mapResource({
        executor: job.executor, kind: 'file', upstreamId: fileMatch[1], jobId: job.id
      });
      result.downloadUrl = `/api/notebooklm/files/${resource.id}`;
    }
    if (typeof result.draftId === 'string' && result.draftId) {
      const resource = await repository.mapResource({
        executor: job.executor, kind: 'draft', upstreamId: result.draftId, jobId: job.id
      });
      result.draftId = resource.id;
    }
    output.result = result;
    return output;
  }
  async function dispatch(input) {
    let readDeadline = null;
    const remainingReadBudget = (maximum) => Math.max(1, Math.min(maximum,
      (readDeadline || (Date.now() + maximum)) - Date.now()));
    const { method, suffix, query, body } = input;
    if (!cloudEnabled || !cloudBase || !token) {
      return responseError(503,
        'NotebookLM Cloud no está configurado o no está habilitado.',
        'cloud', 'CLOUD_CONFIGURATION_REQUIRED');
    }
    if (suffix === '/routing') {
      if (method === 'GET') {
        try { await repository.getRoute(); } catch {
          return responseError(503, 'No se pudo migrar la configuración durable del router.', null, 'ROUTER_MIGRATION_FAILED');
        }
        return { local: true, status: 200, data: { route: 'cloud', principal: actor }, route: 'cloud' };
      }
      if (method === 'PUT') {
        const route = body && body.route;
        if (!ROUTES.has(route)) return responseError(400, 'route debe ser únicamente cloud.', null, 'ROUTE_INVALID');
        try { await repository.setRoute(route); } catch {
          return responseError(503, 'No se pudo persistir la configuración cloud del router.', null, 'ROUTER_MIGRATION_FAILED');
        }
        return { local: true, status: 200, data: { route, principal: actor }, route };
      }
    }
    let preference;
    try { preference = await repository.getRoute(); } catch {
      return responseError(503, 'No se pudo migrar la configuración durable del router.', null, 'ROUTER_MIGRATION_FAILED');
    }
    readDeadline = Date.now() + 45000;
    const match = suffix.match(/^\/(jobs|files)\/([^/]+)$/);
    if (match) {
      const id = match[2];
      if (!ROUTER_ID_RE.test(id)) {
        return responseError(404, 'Identificador de router inválido.', 'cloud', 'ROUTER_ID_INVALID');
      }
      let job;
      let resource;
      try {
        if (match[1] === 'files') resource = await repository.findResource(id);
        else job = await repository.find(id);
      } catch {
        return responseError(503, 'No se pudo resolver el origen durable del trabajo.', null, 'ROUTER_STORE_UNAVAILABLE');
      }
      if (resource) {
        if (resource.kind !== 'file') return responseError(404, 'Archivo de router desconocido.', null, 'ROUTER_FILE_NOT_FOUND');
        if (resource.executor !== 'cloud') {
          return responseError(409, 'El recurso pertenece a una ruta no permitida para NotebookLM cloud.', 'cloud', 'CLOUD_ONLY_ROUTE_REQUIRED');
        }
        try {
          const response = await call('cloud', method,
            `/files/${encodeURIComponent(resource.upstreamId)}`, query, body, 120000);
          const authError = await cloudAuthError(response);
          if (authError) return authError;
          return { response, route: 'cloud' };
        } catch {
          return responseError(502, 'No se pudo contactar con NotebookLM Cloud.', 'cloud', 'CLOUD_UNAVAILABLE');
        }
      }
      if (!job) return responseError(404, 'Trabajo de router desconocido.', null, 'ROUTER_JOB_NOT_FOUND');
      if (job.executor !== 'cloud') {
        return responseError(409, 'El trabajo pertenece a una ruta no permitida para NotebookLM cloud.', 'cloud', 'CLOUD_ONLY_ROUTE_REQUIRED');
      }
      if (job.state !== 'accepted') {
        return responseError(409, 'La aceptación del trabajo no está confirmada; no se reenviará.', job.executor, job.state === 'acceptance_unknown' ? 'ACCEPTANCE_UNKNOWN' : 'JOB_NOT_ACCEPTED');
      }
      try {
        const upstreamSuffix = `/${match[1]}/${encodeURIComponent(job.hubJobId)}`;
        const response = await call('cloud', method, upstreamSuffix, query, body, match[1] === 'files' ? 120000 : 45000);
        const authError = await cloudAuthError(response);
        if (authError) return authError;
        if (match[1] === 'jobs') {
          const parsed = await jsonResponse(response);
          if (!parsed.data || typeof parsed.data !== 'object') {
            return responseError(502, `La ruta ${job.executor} no respondió con un estado válido.`, job.executor, 'INVALID_UPSTREAM_RESPONSE');
          }
          let data;
          try { data = await rewriteJobResult(parsed.data, job); } catch {
            return responseError(503, 'No se pudo guardar la pertenencia de los resultados.',
              job.executor, 'RESOURCE_MAPPING_FAILED');
          }
          return { local: true, status: response.status, data, route: 'cloud' };
        }
        return { response, route: 'cloud', routerJobId: job.id };
      } catch { return responseError(502, 'No se pudo contactar con NotebookLM Cloud.', 'cloud', 'CLOUD_UNAVAILABLE'); }
    }
    const route = 'cloud';
    if (route === 'cloud' && !cloudSupports(method, suffix, body)) {
      return responseError(409, 'Esta operación todavía no está habilitada en cloud.', 'cloud', 'CLOUD_OPERATION_UNSUPPORTED');
    }
    const isJobMutation = method === 'POST' && suffix === '/jobs';
    if (!isJobMutation) {
      try {
        const response = await call(route, method, suffix, query, body,
          suffix.startsWith('/files/') ? 120000 : 45000);
        const authError = await cloudAuthError(response);
        if (authError) return authError;
        return { response, route };
      } catch {
        return responseError(502, 'No se pudo contactar con NotebookLM Cloud.', 'cloud', 'CLOUD_UNAVAILABLE');
      }
    }
    let upstreamBody = body;
    if (body.action === 'news_publish' && ROUTER_ID_RE.test(body.draftId || '')) {
      let draft;
      try { draft = await repository.findResource(body.draftId); } catch {
        return responseError(503, 'No se pudo resolver el origen durable del borrador.', route, 'ROUTER_STORE_UNAVAILABLE');
      }
      if (!draft || draft.kind !== 'draft' || draft.executor !== route) {
        return responseError(404, 'Borrador de router desconocido para esta ruta.', route, 'ROUTER_DRAFT_NOT_FOUND');
      }
      upstreamBody = { ...body, draftId: draft.upstreamId };
    }
    const operation = operationFor(suffix, body);
    const key = body.requestId || crypto.randomUUID();
    let reservation;
    try {
      reservation = await repository.reserve({ idempotencyKey: key, hash: payloadHash(operation, body), executor: route, operation });
    } catch {
      return responseError(503, 'No se pudo reservar el trabajo de forma durable; no fue enviado.', route, 'RESERVATION_FAILED');
    }
    if (reservation.conflict) return responseError(409, 'requestId ya pertenece a otra solicitud.', 'cloud', 'IDEMPOTENCY_CONFLICT');
    const job = reservation.job;
    if (job.executor !== 'cloud') {
      return responseError(409, 'La solicitud previa pertenece a una ruta no permitida y no se reintentará.',
        'cloud', 'CLOUD_ONLY_ROUTE_REQUIRED');
    }
    if (reservation.existing) {
      if (job.state === 'accepted') return {
        local: true, status: 200,
        data: { id: job.id, jobId: job.id, status: 'queued', route: job.executor },
        route: job.executor
      };
      return responseError(409, 'La aceptación previa no está confirmada; no se reenviará.', job.executor, job.state === 'acceptance_unknown' || job.state === 'sending' ? 'ACCEPTANCE_UNKNOWN' : 'JOB_NOT_ACCEPTED');
    }
    let claimed;
    try { claimed = await repository.claim(job.id); } catch {
      return responseError(503, 'No se pudo confirmar la reserva; el trabajo no fue enviado.', route, 'CLAIM_FAILED');
    }
    if (!claimed) return responseError(409, 'El trabajo ya fue reclamado y no se reenviará.', route, 'ALREADY_CLAIMED');
    let response;
    try { response = await call(route, method, suffix, query, upstreamBody, 45000); } catch {
      await repository.transition(job.id, ['sending'], 'acceptance_unknown', { uncertaintyCode: 'transport' }).catch(() => {});
      return responseError(502, 'La aceptación del trabajo es desconocida; no se reenviará.', route, 'ACCEPTANCE_UNKNOWN');
    }
    const authError = await cloudAuthError(response);
    if (authError) {
      await repository.transition(job.id, ['sending'], 'rejected', { uncertaintyCode: authError.data.code }).catch(() => {});
      return authError;
    }
    const parsed = await jsonResponse(response);
    const hubJobId = parsed.data && (parsed.data.id || parsed.data.jobId || (parsed.data.job && parsed.data.job.id));
    if (!response.ok || !hubJobId) {
      const state = response.status >= 500 ? 'acceptance_unknown' : 'rejected';
      await repository.transition(job.id, ['sending'], state, { uncertaintyCode: state === 'acceptance_unknown' ? `http_${response.status}` : null }).catch(() => {});
      return responseError(response.status >= 500 ? 502 : response.status, state === 'acceptance_unknown'
        ? 'La aceptación del trabajo es desconocida; no se reenviará.'
        : 'El ejecutor rechazó el trabajo.', route, state === 'acceptance_unknown' ? 'ACCEPTANCE_UNKNOWN' : 'UPSTREAM_REJECTED');
    }
    let persisted = false;
    try { persisted = await repository.transition(job.id, ['sending'], 'accepted', { hubJobId: String(hubJobId) }); } catch {}
    if (!persisted) {
      await repository.transition(job.id, ['sending'], 'acceptance_unknown', { uncertaintyCode: 'ack_persist_failed' }).catch(() => {});
      return responseError(503, 'El Hub respondió, pero no se pudo guardar la aceptación; no se reenviará.', route, 'ACK_PERSIST_FAILED');
    }
    const data = { ...parsed.data, id: job.id, jobId: job.id, route };
    if (data.job && typeof data.job === 'object') data.job = { ...data.job, id: job.id, jobId: job.id };
    return { local: true, status: response.status, data, route };
  }
  return { dispatch, repository, cloudReady };
}

module.exports = {
  ACTOR, MAX_JOBS, ROUTER_ID, ROUTER_PROJECT, ROUTER_ID_RE, ROUTES,
  canonical, payloadHash, parseDocument, rowFor, createSupabaseRouterStore,
  createRouterRepository, createNotebookRouter, cloudSupports
};