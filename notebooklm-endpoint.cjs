'use strict';

const crypto = require('node:crypto');

/*
 * Durable NotebookLM tunnel registry.
 *
 * This intentionally uses the already existing cibercode_chats table.  The
 * row has its own id and project, so it cannot be confused with chat history
 * or files.  The Supabase client is loaded only when the default store is
 * actually used; tests can therefore provide a small in-memory store.
 */
const ENDPOINT_PATH = '/api/notebooklm/endpoint';
const REGISTRY_ID = 'agyide_notebooklm_endpoint';
const REGISTRY_PROJECT = 'agy-ide-notebooklm-endpoint';
const FALLBACK_SUPABASE_URL = 'https://lxlcivzuevowckbcxczc.supabase.co';
const TRANSPORT_VERSION = 1;
// Cloudflare/NotebookLM can take more than fifteen seconds to wake up.
const HEALTH_TIMEOUT_MS = 45000;
const SUPABASE_TIMEOUT_MS = 15000;
const ENDPOINT_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/;

function authToken(env = process.env) {
  return String(env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN || '');
}

function sameToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  const size = Math.max(actualBytes.length, expectedBytes.length);
  const paddedActual = Buffer.alloc(size);
  const paddedExpected = Buffer.alloc(size);
  actualBytes.copy(paddedActual);
  expectedBytes.copy(paddedExpected);
  return crypto.timingSafeEqual(paddedActual, paddedExpected)
    && actualBytes.length === expectedBytes.length;
}

function endpointOrigin(value) {
  if (typeof value !== 'string' || !ENDPOINT_RE.test(value)) {
    throw new Error('El endpoint debe ser un origen HTTPS de trycloudflare.');
  }
  const url = new URL(value);
  // The strict expression above also excludes paths, queries, fragments,
  // credentials and ports. Keep these checks explicit for future edits.
  if (url.protocol !== 'https:' || url.hostname !== url.hostname.toLowerCase()
      || url.username || url.password || url.port || url.pathname !== '/'
      || url.search || url.hash) {
    throw new Error('El endpoint debe ser un origen HTTPS sin ruta ni credenciales.');
  }
  return value;
}

function generationValue(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('generation debe ser un milisegundo Unix positivo y seguro.');
  }
  return value;
}

function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Solicitud de endpoint no válida.');
  }
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('endpoint') || !keys.includes('generation')) {
    throw new Error('La solicitud debe contener únicamente endpoint y generation.');
  }
  return {
    endpoint: endpointOrigin(body.endpoint),
    generation: generationValue(body.generation)
  };
}

function validateStored(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Registro de endpoint inválido.');
  }
  const endpoint = endpointOrigin(value.endpoint);
  const generation = generationValue(value.generation);
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt
    && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : null;
  if (!updatedAt || value.transportVersion !== TRANSPORT_VERSION) {
    throw new Error('Registro de endpoint incompleto.');
  }
  return { endpoint, generation, updatedAt, transportVersion: TRANSPORT_VERSION };
}

function publicRecord(value) {
  const record = validateStored(value);
  return { ok: true, ...record };
}

function rowValue(row) {
  if (!row || typeof row !== 'object') return null;
  let value = row.messages;
  if (Array.isArray(value)) {
    const item = value.find((entry) => entry && entry.role === 'notebooklm-endpoint');
    value = item && item.content;
  }
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    endpoint: value.endpoint,
    generation: value.generation,
    transportVersion: value.transportVersion,
    // updated_at is also the CAS token. Prefer the database column when it
    // exists (a trigger may normalize it), while retaining compatibility
    // with injected stores returning only the JSON payload.
    updatedAt: row.updated_at || value.updatedAt
  };
}

function rowFor(record) {
  return {
    id: REGISTRY_ID,
    project: REGISTRY_PROJECT,
    title: 'NotebookLM endpoint registry',
    messages: {
      endpoint: record.endpoint,
      generation: record.generation,
      updatedAt: record.updatedAt,
      transportVersion: TRANSPORT_VERSION
    },
    updated_at: record.updatedAt
  };
}

function boundedFetch() {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    const upstreamSignal = init.signal;
    const abort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await globalThis.fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (upstreamSignal) upstreamSignal.removeEventListener('abort', abort);
    }
  };
}

function createSupabaseStore(env = process.env, options = {}) {
  const url = String(env.SUPABASE_URL_2 || FALLBACK_SUPABASE_URL).replace(/\/+$/, '');
  const key = String(env.SUPABASE_KEY_2 || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '');
  const configured = Boolean(key && url);
  let client = options.supabaseClient;
  return {
    configured,
    async get() {
      if (!configured) return null;
      if (!client) {
        let createClient;
        try {
          ({ createClient } = require('@supabase/supabase-js'));
        } catch {
          throw new Error('Supabase SDK no disponible.');
        }
        client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: boundedFetch() }
        });
      }
      const result = await client.from('cibercode_chats')
        .select('id,project,messages,updated_at')
        .eq('id', REGISTRY_ID).eq('project', REGISTRY_PROJECT).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return null;
      const parsed = rowValue(result.data);
      return parsed ? validateStored(parsed) : (() => { throw new Error('Registro de endpoint inválido.'); })();
    },
    async insert(record) {
      if (!configured) throw new Error('Supabase no configurado.');
      if (!client) {
        let createClient;
        try { ({ createClient } = require('@supabase/supabase-js')); } catch {
          throw new Error('Supabase SDK no disponible.');
        }
        client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: boundedFetch() }
        });
      }
      const result = await client.from('cibercode_chats').insert(rowFor(record));
      if (result.error) throw result.error;
    },
    async compareAndSet(previous, record) {
      if (!configured) throw new Error('Supabase no configurado.');
      if (!client) {
        let createClient;
        try { ({ createClient } = require('@supabase/supabase-js')); } catch {
          throw new Error('Supabase SDK no disponible.');
        }
        client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: boundedFetch() }
        });
      }
      const update = {
        title: 'NotebookLM endpoint registry',
        messages: rowFor(record).messages,
        updated_at: record.updatedAt
      };
      const result = await client.from('cibercode_chats').update(update)
        .eq('id', REGISTRY_ID).eq('project', REGISTRY_PROJECT)
        .eq('updated_at', previous.updatedAt)
        .filter('messages->>generation', 'eq', String(previous.generation))
        .select('id');
      if (result.error) throw result.error;
      return Array.isArray(result.data) && result.data.length === 1;
    }
  };
}

function isConflict(error) {
  return Boolean(error && (error.code === '23505' || error.status === 409 || error.statusCode === 409));
}

function storeIsConfigured(store) {
  return store && store.configured !== false;
}

async function verifyCandidate(endpoint, token, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${endpoint}/api/notebooklm/status`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-SGN-Token': token,
        'X-SGN-Actor': 'agy-endpoint-registry'
      },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response || !response.ok) throw new Error('health');
    const data = await response.json();
    if (!data || data.configured !== true) throw new Error('health');
  } finally {
    clearTimeout(timer);
  }
}

async function commitCandidate(store, candidate, token, fetchImpl) {
  let current = await store.get();
  if (current) current = validateStored(current);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current) {
      if (candidate.generation < current.generation) return { conflict: 'stale', record: current };
      if (candidate.generation === current.generation) {
        if (candidate.endpoint === current.endpoint) return { record: current };
        return { conflict: 'generation' };
      }
    }
    const next = {
      endpoint: candidate.endpoint,
      generation: candidate.generation,
      updatedAt: new Date().toISOString(),
      transportVersion: TRANSPORT_VERSION
    };
    try {
      await verifyCandidate(candidate.endpoint, token, fetchImpl);
    } catch (error) {
      const healthError = error instanceof Error ? error : new Error('health');
      healthError.notebookHealthFailure = true;
      throw healthError;
    }
    try {
      if (!current) {
        await store.insert(next);
        return { record: next };
      }
      const updated = await store.compareAndSet(current, next);
      if (updated) return { record: next };
    } catch (error) {
      if (!(!current && isConflict(error))) throw error;
    }
    current = await store.get();
    if (current) current = validateStored(current);
  }
  return { conflict: 'race' };
}

function registerNotebookEndpointRoutes(app, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const store = options.store || options.endpointStore || createSupabaseStore(env, options);
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path && req.path !== '/') {
      return res.status(404).json({ ok: false, error: 'Ruta no disponible.' });
    }
    const expected = authToken(env);
    if (!sameToken(req.headers && req.headers['x-sgn-token'], expected)) {
      return res.status(401).json({ ok: false, error: 'No autorizado.' });
    }
    if (!expected) return res.status(503).json({ ok: false, error: 'Registro Notebook LM no configurado.' });
    if (!storeIsConfigured(store)) return res.status(503).json({ ok: false, error: 'Registro Notebook LM no configurado.' });
    try {
      if (req.method === 'GET') {
        const value = await store.get();
        if (!value) return res.status(503).json({ configured: false, error: 'ENDPOINT_NOT_REGISTERED' });
        return res.json(publicRecord(value));
      }
      if (req.method !== 'POST') return res.status(404).json({ ok: false, error: 'Ruta no disponible.' });
      let candidate;
      try {
        candidate = validatePayload(req.body);
      } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      const result = await commitCandidate(store, candidate, expected, fetchImpl);
      if (result.conflict) {
        return res.status(409).json({
          ok: false,
          error: result.conflict === 'stale' ? 'generation obsoleta.' : 'conflicto de generation.'
        });
      }
      return res.json(publicRecord(result.record));
    } catch (error) {
      // Deliberately do not return database, endpoint, or upstream details.
      const healthFailure = Boolean(error && error.notebookHealthFailure);
      return res.status(healthFailure ? 502 : 503).json({
        ok: false,
        error: healthFailure ? 'El endpoint Notebook LM no superó la comprobación.' : 'No se pudo acceder al registro Notebook LM.'
      });
    }
  };
  // Registered first: this route deliberately bypasses the IDE password.
  app.use(ENDPOINT_PATH, handler);
  return handler;
}

module.exports = {
  ENDPOINT_PATH,
  REGISTRY_ID,
  REGISTRY_PROJECT,
  TRANSPORT_VERSION,
  authToken,
  endpointOrigin,
  validatePayload,
  validateStored,
  createSupabaseStore,
  registerNotebookEndpointRoutes,
  rowValue,
  rowFor,
  publicRecord
};