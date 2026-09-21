'use strict';

// Fixed, read-only Yarbis connector. Do not add a generic URL or HTTP method
// argument here: every operation below owns its endpoint and always uses GET.
const CLIENT_ID = 'AGY-IDE';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 5;

class YarbisReadError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'YarbisReadError';
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

function fail(code, message, status) {
  return new YarbisReadError(code, message, status);
}

function config(env) {
  const rawBase = typeof env.YARBIS_READ_BASE_URL === 'string'
    ? env.YARBIS_READ_BASE_URL.trim()
    : 'https://yarbis-autonomous-control-production.up.railway.app';
  if (!rawBase) throw fail('YARBIS_READ_CONFIG', 'YARBIS_READ_BASE_URL is required.');
  let base;
  try {
    base = new URL(rawBase);
  } catch {
    throw fail('YARBIS_READ_CONFIG', 'YARBIS_READ_BASE_URL must be a valid HTTPS origin.');
  }
  if (
    base.protocol !== 'https:' ||
    !base.hostname ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== '' && base.pathname !== '/')
  ) {
    throw fail(
      'YARBIS_READ_CONFIG',
      'YARBIS_READ_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.',
    );
  }
  if ((env.YARBIS_READ_CLIENT_ID ?? CLIENT_ID) !== CLIENT_ID) {
    throw fail('YARBIS_READ_CONFIG', 'YARBIS_READ_CLIENT_ID must be exactly AGY-IDE.');
  }
  const token = typeof env.YARBIS_READ_TOKEN === 'string' ? env.YARBIS_READ_TOKEN.trim() : '';
  if (!token) throw fail('YARBIS_READ_CONFIG', 'YARBIS_READ_TOKEN is required.');
  const timeout = env.YARBIS_READ_TIMEOUT_MS == null || env.YARBIS_READ_TIMEOUT_MS === ''
    ? DEFAULT_TIMEOUT_MS
    : Number(env.YARBIS_READ_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120000) {
    throw fail(
      'YARBIS_READ_CONFIG',
      'YARBIS_READ_TIMEOUT_MS must be an integer between 100 and 120000.',
    );
  }
  return { origin: base.origin, token, timeout };
}

function tokenParts(token) {
  const parts = [token];
  try {
    parts.push(encodeURIComponent(token));
    parts.push(new URLSearchParams([['q', token]]).toString().slice(2));
  } catch {}
  return [...new Set(parts.filter(Boolean))];
}

function hasToken(value, token) {
  const text = String(value == null ? '' : value);
  return tokenParts(token).some((part) => text.includes(part));
}

function safe(value, token, max = 800) {
  if (value == null) return null;
  let text = String(value == null ? '' : value);
  for (const part of tokenParts(token)) text = text.split(part).join('[REDACTED]');
  text = text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

function sanitizeStructured(value, token, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return safe(value, token, 2000);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= 3) return safe(value, token, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeStructured(item, token, depth + 1));
  }
  if (object(value)) {
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 40)) {
      output[safe(key, token, 120)] = sanitizeStructured(child, token, depth + 1);
    }
    return output;
  }
  return safe(value, token, 500);
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(value, keys) {
  if (!object(value)) return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function memoryItem(value) {
  return object(value) && (object(value.memory) || object(value.item) || object(value.data))
    ? value.memory || value.item || value.data
    : value;
}

function memoryList(value) {
  if (Array.isArray(value)) return value;
  if (!object(value)) return [];
  for (const key of ['items', 'results', 'memories', 'records']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (object(value.data)) {
    for (const key of ['items', 'results', 'memories', 'records']) {
      if (Array.isArray(value.data[key])) return value.data[key];
    }
  }
  if (Array.isArray(value.data)) return value.data;
  return [value];
}

function citation(value, index, token) {
  const item = memoryItem(value);
  const entry = {
    reference: safe(pick(item, ['reference']), token, 240),
    id: safe(pick(item, ['id', 'memory_id', 'session_id', 'key']), token, 240),
    title: safe(pick(item, ['title', 'name', 'subject', 'summary']), token, 240),
    date: safe(pick(item, ['date', 'created_at', 'updated_at', 'timestamp', 'createdAt']), token, 100),
    source: safe(pick(item, ['source', 'project', 'app', 'origin']), token, 180),
  };
  return {
    citation: entry,
    excerpt: safe(pick(item, ['snippet', 'excerpt', 'content', 'text', 'description']), token, 700),
  };
}

function releaseResult(payload, token) {
  const item = object(payload) && (object(payload.release) || object(payload.data))
    ? payload.release || payload.data
    : payload;
  const version = safe(pick(item, ['version', 'release', 'tag', 'name']), token, 160);
  const result = {
    ok: true,
    untrusted: true,
    summary: version
      ? `Versión remota de Yarbis: ${version}.`
      : 'La respuesta remota de versión fue recibida.',
  };
  for (const key of ['version', 'deploymentRevision', 'releasedAt', 'notes', 'verification', 'verified']) {
    if (object(item) && Object.prototype.hasOwnProperty.call(item, key)) {
      result[key] = key === 'version' ? version : sanitizeStructured(item[key], token);
    }
  }
  return result;
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,7}$/;
const CAPABILITY_MODE = new Set(['read', 'action']);
const CAPABILITY_TOP_LEVEL_KEYS = ['schemaVersion', 'policyVersion', 'client', 'yarbisVersion', 'capabilities'];
const CAPABILITY_RECORD_KEYS = ['id', 'mode', 'enabled', 'requiresConfirmation', 'evidenceRequired'];
const CAPABILITY_READ_IDS = new Set([
  'capabilities.read',
  'release.read',
  'memory.status',
  'memory.search',
  'memory.get',
  'mailbox.read',
  'pc1.sync.read',
  'notebooklm.list',
  'notebooklm.search',
  'notebooklm.sources',
  'notebooklm.job-status',
  'mission.status'
]);
const KNOWN_CAPABILITY_POLICIES = new Map([
  ...[...CAPABILITY_READ_IDS].map((id) => [id, { mode: 'read', requiresConfirmation: false, evidenceRequired: false }]),
  ['notebooklm.ask', { mode: 'action', requiresConfirmation: false, evidenceRequired: true }],
  ['notebooklm.research', { mode: 'action', requiresConfirmation: false, evidenceRequired: true }],
  ['mission.draft', { mode: 'action', requiresConfirmation: false, evidenceRequired: false }],
  ['mission.confirm', { mode: 'action', requiresConfirmation: true, evidenceRequired: true }],
]);

function exactKeys(value, expected) {
  return object(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function capabilitiesResult(payload, token) {
  if (!exactKeys(payload, CAPABILITY_TOP_LEVEL_KEYS) ||
      payload.schemaVersion !== '1' ||
      payload.policyVersion !== '1' ||
      payload.client !== CLIENT_ID ||
      typeof payload.yarbisVersion !== 'string' ||
      !payload.yarbisVersion.trim()) {
    throw fail('YARBIS_READ_INVALID_RESPONSE', 'El catálogo de capacidades no es un objeto.');
  }
  const schemaVersion = payload.schemaVersion;
  const yarbisVersion = safe(payload.yarbisVersion, token, 160);
  const policyVersion = payload.policyVersion;
  const entries = payload.capabilities;
  if (!schemaVersion || !Array.isArray(entries) || entries.length > 100) {
    throw fail('YARBIS_READ_INVALID_RESPONSE', 'El catálogo de capacidades tiene un formato inválido.');
  }
  const seen = new Set();
  const capabilities = entries.map((entry) => {
    if (!exactKeys(entry, CAPABILITY_RECORD_KEYS)) {
      throw fail('YARBIS_READ_INVALID_RESPONSE', 'El catálogo contiene una capacidad inválida.');
    }
    const id = safe(entry.id, token, 100);
    if (!id || !CAPABILITY_ID_PATTERN.test(id) || seen.has(id)) {
      throw fail('YARBIS_READ_INVALID_RESPONSE', 'El catálogo contiene un identificador duplicado o inválido.');
    }
    const policy = KNOWN_CAPABILITY_POLICIES.get(id);
    if (typeof entry.enabled !== 'boolean' || !CAPABILITY_MODE.has(entry.mode) ||
        typeof entry.requiresConfirmation !== 'boolean' ||
        typeof entry.evidenceRequired !== 'boolean' ||
        (policy && (
          entry.mode !== policy.mode ||
          entry.requiresConfirmation !== policy.requiresConfirmation ||
          entry.evidenceRequired !== policy.evidenceRequired
        ))) {
      throw fail('YARBIS_READ_INVALID_RESPONSE', `La capacidad ${id} tiene metadatos inválidos.`);
    }
    seen.add(id);
    return {
      id,
      mode: entry.mode,
      enabled: entry.enabled,
      requiresConfirmation: entry.requiresConfirmation,
      evidenceRequired: entry.evidenceRequired
    };
  });
  if ([...KNOWN_CAPABILITY_POLICIES.keys()].some((id) => !seen.has(id))) {
    throw fail('YARBIS_READ_INVALID_RESPONSE', 'El catálogo no declara todas las capacidades conocidas.');
  }
  return {
    ok: true,
    synchronized: true,
    untrusted: true,
    schemaVersion,
    yarbisVersion,
    policyVersion,
    capabilities,
    count: capabilities.filter((entry) => entry.enabled).length,
    summary: `Catálogo de capacidades recibido: ${capabilities.length} declaraciones válidas.`
  };
}

function statusResult(payload, token) {
  const item = object(payload) && (object(payload.status) || object(payload.data))
    ? payload.status || payload.data
    : payload;
  const status = safe(pick(item, ['status', 'state', 'message']), token, 240);
  const result = {
    ok: true,
    untrusted: true,
    summary: status
      ? `Estado remoto de memoria: ${status}.`
      : 'El estado remoto de memoria fue recibido.',
    status,
    healthy: typeof item?.healthy === 'boolean'
      ? item.healthy
      : typeof item?.ok === 'boolean' ? item.ok : null,
    checked_at: safe(
      pick(item, ['checked_at', 'checkedAt', 'updated_at', 'timestamp']),
      token,
      100,
    ),
  };
  const sources = [payload, object(payload) ? payload.data : null, object(payload) ? payload.status : null]
    .filter(object);
  const memoryIndexKey = /^(?:memory[\s_-]*index|connected$|sourceTable$|count$|database$|databaseName$|database_name$|table$|schema$|source$|backend$)/i;
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (memoryIndexKey.test(key)) result[key] = sanitizeStructured(value, token);
    }
  }
  return result;
}

function searchResult(payload, token, query, limit) {
  const entries = memoryList(payload).slice(0, limit).map((value, index) => citation(value, index, token));
  const citations = entries.map((entry) => entry.citation);
  const results = entries.map((entry) => ({ ...entry.citation, excerpt: entry.excerpt }));
  const lines = entries.map((entry) => {
    const label = [
      entry.citation.title,
      entry.citation.date,
      entry.citation.source,
    ].filter(Boolean).join(' · ');
    return [
      entry.citation.reference,
      label,
      entry.excerpt,
    ].filter(Boolean).join(' — ') || 'Recuerdo recibido';
  });
  return {
    ok: true,
    untrusted: true,
    query: safe(query, token, 500),
    limit,
    count: citations.length,
    summary: lines.length
      ? `Resultados de memoria (${citations.length}):\n${lines.join('\n')}`
      : 'No se encontraron recuerdos en la respuesta remota.',
    citations,
    results,
  };
}

function getResult(payload, token) {
  const entry = citation(memoryItem(payload), 0, token);
  return {
    ok: true,
    untrusted: true,
    summary: entry.citation.title
      ? `Recuerdo remoto: ${entry.citation.title}.`
      : 'Recuerdo remoto recibido.',
    citation: entry.citation,
    memory: { ...entry.citation, excerpt: entry.excerpt },
  };
}

function queryValue(query, token) {
  if (typeof query !== 'string' || !query.trim()) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'La consulta de memoria q es obligatoria.');
  }
  const value = query.trim();
  if (value.length > 500) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'La consulta q no puede superar 500 caracteres.');
  }
  if (hasToken(value, token)) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'La consulta contiene material no permitido.');
  }
  return value;
}

function limitValue(limit) {
  const value = limit === undefined ? DEFAULT_LIMIT : Number(limit);
  if (!Number.isSafeInteger(value) || value < 1 || value > 25) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'El límite de memoria debe ser un entero entre 1 y 25.');
  }
  return value;
}

function idValue(id, token) {
  if (typeof id !== 'string' || !id.trim()) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'El id del recuerdo es obligatorio.');
  }
  const value = id.trim();
  if (value.length > 500) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'El id no puede superar 500 caracteres.');
  }
  if (hasToken(value, token)) {
    throw fail('YARBIS_READ_INVALID_INPUT', 'El id contiene material no permitido.');
  }
  return value;
}

async function body(response) {
  try {
    const text = typeof response.text === 'function'
      ? await response.text()
      : JSON.stringify(await response.json());
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('large');
    return JSON.parse(text);
  } catch {
    throw fail('YARBIS_READ_INVALID_RESPONSE', 'Yarbis returned an invalid JSON response.');
  }
}

function ok(response) {
  return response && (
    response.ok === true ||
    (Number.isInteger(response.status) && response.status >= 200 && response.status < 300)
  );
}

function aborted(error) {
  return Boolean(error) && (
    error.name === 'AbortError' ||
    error.code === 'ABORT_ERR' ||
    error.code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

function createYarbisReadClient(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw fail('YARBIS_READ_CONFIG', 'Global fetch is required for the Yarbis read connector.');
  }

  async function request(pathname, query) {
    const cfg = config(env);
    const url = new URL(pathname, `${cfg.origin}/`);
    if (url.origin !== cfg.origin) {
      throw fail('YARBIS_READ_CONFIG', 'The Yarbis read request left the configured HTTPS origin.');
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    }
    if (hasToken(url.toString(), cfg.token)) {
      throw fail('YARBIS_READ_INVALID_INPUT', 'The Yarbis read request would expose a credential in its URL.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout);
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${cfg.token}`,
          'X-Yarbis-Node-Id': CLIENT_ID,
          'X-Yarbis-Client-Id': CLIENT_ID,
        },
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response && response.url) {
        try {
          if (new URL(response.url).origin !== cfg.origin) {
            throw fail('YARBIS_READ_REDIRECT', 'Yarbis read redirects are not allowed.');
          }
        } catch (error) {
          if (error instanceof YarbisReadError) throw error;
          throw fail('YARBIS_READ_REDIRECT', 'Yarbis read redirects are not allowed.');
        }
      }
      if (!ok(response)) {
        throw fail(
          'YARBIS_READ_HTTP',
          `Yarbis read request failed with HTTP ${Number(response?.status) || 0}.`,
          Number.isInteger(response?.status) ? response.status : 0,
        );
      }
      return await body(response);
    } catch (error) {
      if (error instanceof YarbisReadError) throw error;
      if (aborted(error)) throw fail('YARBIS_READ_TIMEOUT', 'Yarbis read request timed out.');
      throw fail('YARBIS_READ_NETWORK', 'Yarbis read request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async yarbis_version() {
      const cfg = config(env);
      return releaseResult(await request('/api/release'), cfg.token);
    },
    async yarbis_capabilities() {
      const cfg = config(env);
      return capabilitiesResult(await request('/api/agent-capabilities'), cfg.token);
    },
    async yarbis_memory_status() {
      const cfg = config(env);
      return statusResult(await request('/api/worker/memory/status'), cfg.token);
    },
    async yarbis_memory_search(query, limit) {
      const cfg = config(env);
      const q = queryValue(query, cfg.token);
      const count = limitValue(limit);
      return searchResult(
        await request('/api/worker/memory/search', { q, limit: count }),
        cfg.token,
        q,
        count,
      );
    },
    async yarbis_memory_get(id) {
      const cfg = config(env);
      const value = idValue(id, cfg.token);
      return getResult(await request(`/api/worker/memory/${encodeURIComponent(value)}`), cfg.token);
    },
  };
}

function publicError(error, fallback = 'Yarbis read request failed.') {
  if (error instanceof YarbisReadError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: false, error: fallback, code: 'YARBIS_READ_FAILED' };
}

function routeStatus(error) {
  if (!(error instanceof YarbisReadError)) return 502;
  if (error.code === 'YARBIS_READ_INVALID_INPUT') return 400;
  if (error.code === 'YARBIS_READ_CONFIG') return 503;
  if (error.code === 'YARBIS_READ_TIMEOUT') return 504;
  return 502;
}

function registerYarbisReadRoutes(app, requirePwd, client) {
  if (!app || typeof app.get !== 'function' || typeof app.all !== 'function') {
    throw new TypeError('An Express app is required to register Yarbis read routes.');
  }
  if (typeof requirePwd !== 'function') {
    throw new TypeError('The existing requirePwd middleware is required.');
  }
  const readClient = client || createYarbisReadClient();
  function protectedGet(route, handler) {
    app.get(route, requirePwd, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        res.json(await handler(req));
      } catch (error) {
        res.status(routeStatus(error)).json(publicError(error));
      }
    });
    app.all(route, requirePwd, (_req, res) => {
      res.setHeader('Allow', 'GET');
      res.status(405).json({
        ok: false,
        error: 'Only GET is allowed for this read-only route.',
        code: 'METHOD_NOT_ALLOWED',
      });
    });
  }
  protectedGet('/api/yarbis/version', () => readClient.yarbis_version());
  protectedGet('/api/yarbis/memory/status', () => readClient.yarbis_memory_status());
  protectedGet('/api/yarbis/memory/search', (req) => readClient.yarbis_memory_search(
    typeof req.query?.q === 'string' ? req.query.q : '',
    req.query?.limit === undefined ? undefined : req.query.limit,
  ));
  protectedGet('/api/yarbis/memory/:id', (req) => readClient.yarbis_memory_get(
    typeof req.params?.id === 'string' ? req.params.id : '',
  ));
}

function yarbis_version() {
  return createYarbisReadClient().yarbis_version();
}
function yarbis_capabilities() {
  return createYarbisReadClient().yarbis_capabilities();
}
function yarbis_memory_status() {
  return createYarbisReadClient().yarbis_memory_status();
}
function yarbis_memory_search(query, limit) {
  return createYarbisReadClient().yarbis_memory_search(query, limit);
}
function yarbis_memory_get(id) {
  return createYarbisReadClient().yarbis_memory_get(id);
}

module.exports = {
  CLIENT_ID,
  YarbisReadError,
  capabilitiesResult,
  createYarbisReadClient,
  publicError,
  registerYarbisReadRoutes,
  yarbis_version,
  yarbis_capabilities,
  yarbis_memory_status,
  yarbis_memory_search,
  yarbis_memory_get,
};