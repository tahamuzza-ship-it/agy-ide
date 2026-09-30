'use strict';

// AGY-only read-only connector: capabilities and execution status. No dispatch, persistence, credential provisioning or retry.
// Provision AGY_YARBIS_MCP_TOKEN independently on the server ONLY after approval;
// Yarbis must map it to id/memoryNamespace "agy-ide" with capabilities.read and execution.read only.
// The operator adapter fails closed until an approved identity authority and
// persistent grants verify an AGY-scoped session. Never derive it from req.body,
// a global IDE password, app URL, role headers or a browser-supplied identity.
const { createHash } = require('node:crypto');
const VERSION = '2025-03-26';
const BASE = 'https://yarbis-autonomous-control-production.up.railway.app/api/mcp/';
const TOOLS = Object.freeze({
  listar_capacidades_disponibles: 'capabilities',
  estado_ejecucion: 'execution',
});
class McpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new McpError(status, code); };
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function validate(name, args) {
  if (!Object.hasOwn(TOOLS, name) || !record(args)) fail(400, 'ARGUMENTOS_INVALIDOS');
  const keys = {
    consultar_memoria_index: ['query', 'limit'], consultar_memoria_por_id: ['id'],
    preparar_mision: ['target', 'title', 'instruction', 'requestId'],
  }[name] || [];
  if (Object.keys(args).some(k => !keys.includes(k))) fail(400, 'ARGUMENTOS_INVALIDOS');
  const text = (key, min, max) => {
    if (typeof args[key] !== 'string' || args[key].trim().length < min || args[key].length > max) fail(400, 'ARGUMENTOS_INVALIDOS');
    return args[key].trim();
  };
  if (name === 'consultar_memoria_index') {
    const query = text('query', 2, 500), limit = args.limit === undefined ? 8 : args.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail(400, 'ARGUMENTOS_INVALIDOS');
    return { query, limit };
  }
  if (name === 'consultar_memoria_por_id') {
    if (!Number.isSafeInteger(args.id) || args.id <= 0) fail(400, 'ARGUMENTOS_INVALIDOS');
  }
  if (name === 'preparar_mision') {
    const title = text('title', 1, 80), instruction = text('instruction', 1, 10000);
    if (!['PC1', 'PC2', 'PC-MIAMI', 'AGY'].includes(args.target) ||
        typeof args.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.requestId)) fail(400, 'ARGUMENTOS_INVALIDOS');
    return { target: args.target, title, instruction, requestId: args.requestId };
  }
  return { ...args };
}

// Incremental SSE: do not await EOF on a long-lived stream; stop on matching ID.
async function readRpc(response, id, maxBytes = 262144) {
  const sse = (response.headers.get('content-type') || '').includes('text/event-stream');
  if (!sse && !(response.headers.get('content-type') || '').includes('application/json')) fail(502, 'MCP_TIPO_INVALIDO');
  if (!response.body) fail(502, 'MCP_RESPUESTA_INVALIDA');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  const parse = raw => {
    let value;
    try { value = JSON.parse(raw); } catch { fail(502, 'MCP_JSON_INVALIDO'); }
    if (!record(value) || value.jsonrpc !== '2.0') fail(502, 'MCP_RESPUESTA_INVALIDA');
    if (value.id !== id) return null;
    if (value.error || !Object.hasOwn(value, 'result')) fail(502, 'MCP_ERROR_RPC');
    return value;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) { bytes += value.byteLength; if (bytes > maxBytes) fail(502, 'MCP_RESPUESTA_EXCESIVA'); }
      buffer += decoder.decode(value, { stream: !done });
      if (sse) {
        // Normalize CRLF across arbitrary network chunk boundaries.
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (data) { const result = parse(data); if (result) return result.result; }
        }
      }
      if (done) {
        if (!sse) { const result = parse(buffer); if (result) return result.result; }
        fail(502, 'MCP_RESPUESTA_INCOMPLETA');
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function createMcpClient({ fetchImpl = fetch, getToken = () => process.env.AGY_YARBIS_MCP_TOKEN, timeoutMs = 12000 } = {}) {
  const contexts = new Map();
  let sequence = 0;
  const token = () => {
    const value = getToken();
    if (typeof value !== 'string' || value.length < 32 || value.length > 4096 || /\s/.test(value)) fail(503, 'MCP_CREDENCIAL_AGY_NO_CONFIGURADA');
    return value;
  };
  async function request(surface, credential, state, method, params, notification = false) {
    const id = notification ? undefined : ++sequence;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': VERSION };
      if (state.session) headers['Mcp-Session-Id'] = state.session;
      const response = await fetchImpl(BASE + surface, { method: 'POST', headers, redirect: 'error', signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if ([401, 404].includes(response.status)) state.session = null;
        fail([401, 404].includes(response.status) ? response.status : 502, `MCP_HTTP_${response.status}`);
      }
      if (notification) {
        await response.body?.cancel().catch(() => {});
        if (response.status !== 202 && response.status !== 204) fail(502, 'MCP_NOTIFICACION_INVALIDA');
        return;
      }
      const result = await readRpc(response, id);
      if (method === 'initialize') {
        const session = response.headers.get('mcp-session-id');
        if (result.protocolVersion !== VERSION || !session || !/^[\x21-\x7e]{1,256}$/.test(session)) fail(502, 'MCP_SESION_INVALIDA');
        state.session = session;
      }
      return result;
    } catch (error) {
      state.session = null;
      if (error instanceof McpError) throw error;
      fail(502, controller.signal.aborted ? 'MCP_TIMEOUT' : 'MCP_TRANSPORTE_FALLIDO');
    } finally { clearTimeout(timer); }
  }
  return {
    ready() { try { token(); return true; } catch { return false; } },
    async call(name, rawArgs, actor = 'agy-public') {
      const args = validate(name, rawArgs), credential = token(), surface = TOOLS[name];
      if (typeof actor !== 'string' || !actor || actor.length > 256) fail(403, 'OPERADOR_AGY_INVALIDO');
      const key = createHash('sha256').update(JSON.stringify([credential, actor, surface])).digest('hex');
      const now = Date.now();
      for (const [k, v] of contexts) if (!v.busy && now - v.last > 300000) contexts.delete(k);
      if (!contexts.has(key)) {
        if (contexts.size >= 100) fail(429, 'MCP_LIMITE_SESIONES');
        contexts.set(key, { session: null, busy: false, last: now });
      }
      const state = contexts.get(key);
      if (state.busy) fail(429, 'MCP_SESION_OCUPADA');
      state.busy = true;
      try {
        if (!state.session) {
          await request(surface, credential, state, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'agy-ide', version: '1.0.0' } });
          await request(surface, credential, state, 'notifications/initialized', undefined, true);
        }
        const result = await request(surface, credential, state, 'tools/call', { name, arguments: args });
        if (!record(result) || result.isError || !Array.isArray(result.content) || result.content.length !== 1 || result.content[0].type !== 'text') fail(502, 'MCP_RESULTADO_INVALIDO');
        let data;
        try { data = JSON.parse(result.content[0].text); } catch { fail(502, 'MCP_RESULTADO_INVALIDO'); }
        if (name === 'listar_capacidades_disponibles' && data?.clientId !== 'agy-ide') fail(502, 'MCP_IDENTIDAD_INCORRECTA');
        if (['estado_ejecucion', 'preparar_mision'].includes(name) && data?.app !== 'agy-ide') fail(502, 'MCP_IDENTIDAD_INCORRECTA');
        if (name === 'preparar_mision' && (!record(data) || data.stored !== false || data.dispatched !== false || data.requiresConfirmation !== true || data.status !== 'prepared_only' || data.requestId !== args.requestId)) fail(502, 'MCP_PREVIEW_INSEGURA');
        return data;
      } finally { state.busy = false; state.last = Date.now(); }
    },
  };
}

function registerMcpRoutes(app, requirePwd, { client = createMcpClient(), verifyOperator = null, operatorReady = () => typeof verifyOperator === 'function' } = {}) {
  // Integration hook: a trusted server adapter must authenticate and authorize a
  // session, revocation, expiry, AGY audience and CSRF before returning this grant.
  // Default null deliberately blocks sensitive operations; no login is invented.
  app.get('/api/agy/yarbis-mcp/status', requirePwd, (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ configured: client.ready(), operatorAuthorityConfigured: operatorReady(), application: 'agy-ide', previewOnly: true });
  });
  app.post('/api/agy/yarbis-mcp/call', requirePwd, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!record(req.body) || Object.keys(req.body).some(k => !['tool', 'arguments'].includes(k))) fail(400, 'ARGUMENTOS_INVALIDOS');
      const name = req.body.tool, args = validate(name, req.body.arguments);
      let actor = 'agy-public';
      if (TOOLS[name] === 'memory' || name === 'preparar_mision') {
        if (typeof verifyOperator !== 'function') fail(403, 'OPERADOR_AGY_NO_CONFIGURADO');
        const grant = await verifyOperator(req);
        const scope = name === 'preparar_mision' ? 'execution.propose' : 'memory.read';
        if (!grant || grant.audience !== 'agy-ide' || typeof grant.subject !== 'string' || !grant.subject || grant.subject.length > 128 ||
            !Array.isArray(grant.scopes) || !grant.scopes.includes(scope) || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= Date.now() ||
            grant.csrfVerified !== true || typeof grant.sessionId !== 'string' || !grant.sessionId || grant.sessionId.length > 128) fail(403, 'OPERADOR_AGY_NO_AUTORIZADO');
        actor = createHash('sha256').update(JSON.stringify([grant.subject, grant.sessionId])).digest('hex');
      }
      const data = await client.call(name, args, actor);
      // A revocation during upstream I/O must also prevent result disclosure.
      if (TOOLS[name] === 'memory' || name === 'preparar_mision') {
        const latest = await verifyOperator(req);
        const scope = name === 'preparar_mision' ? 'execution.propose' : 'memory.read';
        if (!latest || latest.audience !== 'agy-ide' || !Array.isArray(latest.scopes) ||
            !latest.scopes.includes(scope) || latest.csrfVerified !== true ||
            !Number.isFinite(latest.expiresAt) || latest.expiresAt <= Date.now() ||
            createHash('sha256').update(JSON.stringify([latest.subject, latest.sessionId])).digest('hex') !== actor) fail(403, 'OPERADOR_AGY_NO_AUTORIZADO');
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(error instanceof McpError ? error.status : 502).json({ ok: false, error: error instanceof McpError ? error.code : 'MCP_SOLICITUD_FALLIDA' });
    }
  });
}
module.exports = { createMcpClient, registerMcpRoutes, validate, readRpc, McpError };