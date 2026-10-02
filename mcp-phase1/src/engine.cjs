'use strict';
// Internal, unmounted engine for isolated verification. Public entry remains locked.
const P = require('./policy.cjs');
const catalog = require('./catalog.cjs');
const { CALLBACK, PATHS, VERSION, SCOPES, LIMITS, fail, hash, challenge, secret, exact,
  text, opaque, escapeHtml, response, errorResponse, trustedIssuer } = P;

function createEngine({ authority, issuer, resolveOperator } = {}) {
  async function serve(req, signal) {
    const origin = trustedIssuer(issuer);
    if (!authority || typeof authority.call !== 'function') fail(503, 'AUTORIDAD_NO_DISPONIBLE');
    const h = req.headers || {};
    const approvalMatch = new RegExp('^' + PATHS.approve + '/([A-Za-z0-9_-]{43})$').exec(req.path);
    const isApproval = req.path === PATHS.approve || Boolean(approvalMatch);
    if (h.host !== origin.host) fail(403, 'HOST_NO_PERMITIDO');
    if (isApproval) {
      if (approvalMatch ? req.method !== 'GET' : req.method !== 'POST') fail(405, 'METODO_NO_ADMITIDO');
      if ((req.method === 'POST' && h.origin !== issuer) ||
          (h.origin !== undefined && h.origin !== issuer)) fail(403, 'ORIGIN_NO_PERMITIDO');
    } else if (h.origin !== undefined) fail(403, 'ORIGIN_NO_PERMITIDO');
    if (!Object.values(PATHS).includes(req.path) && !approvalMatch) fail(404, 'RUTA_NO_ENCONTRADA');
    if (req.body !== undefined && Buffer.byteLength(JSON.stringify(req.body)) > LIMITS.requestBytes) fail(413, 'PETICION_EXCESIVA');
    const rpc = async (action, args = {}) => {
      if (signal.aborted) fail(503, 'PLAZO_EXCEDIDO');
      const result = await authority.call(action, { ...args, issuer, resource: issuer + PATHS.mcp }, signal);
      if (signal.aborted) fail(503, 'PLAZO_EXCEDIDO');
      if (!result || result.ok !== true) fail(503, 'PERSISTENCIA_NO_DISPONIBLE');
      return result;
    };
    const health = await rpc('health');
    if (health.contract !== 'agy-phase1-authority-v1' || health.persistent !== true ||
        health.atomicCodeRedemption !== true || health.onlineOperatorValidation !== true ||
        health.limitsEnforced !== true || health.auditRedacted !== true) fail(503, 'PERSISTENCIA_NO_VERIFICADA');

    async function client() {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(h.authorization || '');
      if (!match) fail(401, 'CLIENTE_INVALIDO');
      const result = await rpc('client', { credential_hash: hash(match[1]) });
      text(result.client_id);
      if (result.active !== true || result.callback_uri !== CALLBACK) fail(403, 'CLIENTE_NO_AUTORIZADO');
      return result;
    }
    async function authorized(machine) {
      const result = await rpc('authorize', {
        client_id: machine.client_id, token_hash: hash(opaque(h['x-agy-operator-token'])),
      });
      if (result.client_id !== machine.client_id || result.audience !== 'agy' ||
          result.active !== true || !Number.isFinite(result.expires_at) || result.expires_at <= Date.now() ||
          !Array.isArray(result.scopes) || !result.scopes.length ||
          result.scopes.some(scope => !SCOPES.includes(scope))) fail(403, 'AUTORIZACION_DENEGADA');
      text(result.operator_id); text(result.grant_id);
      return result;
    }
    if (isApproval) {
      if (!approvalMatch) exact(req.body, ['request_id'], ['csrf_token']);
      const requestId = opaque(approvalMatch ? approvalMatch[1] : req.body.request_id);
      if (typeof resolveOperator !== 'function' || typeof authority.identity !== 'function') fail(503, 'AUTORIDAD_NO_DISPONIBLE');
      // Host must resolve a live, CSRF-verified individual session, never a global password.
      const session = await resolveOperator(req);
      if (!session || (!approvalMatch && session.csrfVerified !== true) ||
          !session.sessionId || !session.accessToken) fail(403, 'OPERADOR_NO_VERIFICADO');
      const user = await authority.identity(session.accessToken);
      await rpc('operator_session', { operator_id: user.id, session_hash: hash(session.sessionId) });
      const link = await rpc('link_read', { request_id: requestId, operator_id: user.id });
      if (link.callback_uri !== CALLBACK || link.expires_at <= Date.now() || link.status !== 'pending' ||
          link.issuer !== issuer || link.resource !== issuer + PATHS.mcp) fail(400, 'VINCULACION_INVALIDA');
      opaque(link.state);
      if (approvalMatch) {
        text(session.csrfToken, 32, 256);
        text(link.client_id);
        if (!Array.isArray(link.requested_scopes) || link.requested_scopes.some(s => !SCOPES.includes(s))) fail(403, 'PERMISO_NO_ADMITIDO');
        const html = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Vincular AGY</title>' +
          '<h1>Vincular perfil AGY de Mark 51</h1><p>Cliente: ' + escapeHtml(link.client_id) +
          '</p><p>Permisos existentes solicitados: ' + escapeHtml(link.requested_scopes.join(', ')) +
          '</p><p>No se concederán permisos nuevos. Fase 2 bloqueada.</p>' +
          '<form method="post" action="' + PATHS.approve + '">' +
          '<input type="hidden" name="request_id" value="' + requestId + '">' +
          '<input type="hidden" name="csrf_token" value="' + escapeHtml(session.csrfToken) + '">' +
          '<button type="submit">Aprobar vinculación</button></form></html>';
        return response(200, html, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        });
      }
      const code = secret();
      // Persist only its hash; RPC must bind to current grant + original client/challenge.
      await rpc('link_approve', {
        request_id: requestId, operator_id: user.id, session_hash: hash(session.sessionId),
        code_hash: hash(code), code_expires_at: Date.now() + LIMITS.codeSeconds * 1000,
      });
      const inputs = { code, state: link.state, iss: issuer };
      const nonce = secret();
      const html = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Vinculación AGY</title>' +
        '<form method="post" action="' + CALLBACK + '">' +
        Object.entries(inputs).map(([name, value]) =>
          '<input type="hidden" name="' + name + '" value="' + escapeHtml(value) + '">').join('') +
        '<button type="submit">Volver al perfil AGY de Mark 51</button></form>' +
        '<script nonce="' + nonce + '">document.forms[0].submit()</script></html>';
      return response(200, html, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${CALLBACK}; frame-ancestors 'none'; base-uri 'none'`,
      });
    }
    const machine = await client();
    if (req.path !== PATHS.mcp && req.method !== 'POST') fail(405, 'METODO_NO_ADMITIDO');
    if (req.path === PATHS.link) {
      exact(req.body, ['client_id', 'callback_uri', 'resource', 'state', 'code_challenge', 'code_challenge_method', 'requested_scopes']);
      const b = req.body;
      if (b.client_id !== machine.client_id || b.callback_uri !== CALLBACK ||
          b.resource !== issuer + PATHS.mcp || b.code_challenge_method !== 'S256') fail(400, 'VINCULACION_INVALIDA');
      opaque(b.state); opaque(b.code_challenge);
      if (!Array.isArray(b.requested_scopes) || !b.requested_scopes.length ||
          new Set(b.requested_scopes).size !== b.requested_scopes.length ||
          b.requested_scopes.some(s => !SCOPES.includes(s))) fail(403, 'PERMISO_NO_ADMITIDO');
      const requestId = secret();
      await rpc('link_create', {
        ...b, request_id: requestId, expires_at: Date.now() + LIMITS.linkSeconds * 1000,
      });
      return response(201, {
        request_id: requestId, approval_url: issuer + PATHS.approve + '/' + requestId, expires_in: LIMITS.linkSeconds,
      });
    }
    if (req.path === PATHS.token) {
      exact(req.body, ['client_id', 'request_id', 'code', 'code_verifier', 'callback_uri', 'resource', 'issuer']);
      const b = req.body;
      if (b.client_id !== machine.client_id || b.callback_uri !== CALLBACK ||
          b.resource !== issuer + PATHS.mcp || b.issuer !== issuer ||
          typeof b.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier)) fail(400, 'invalid_grant');
      try { opaque(b.code); opaque(b.request_id); } catch { fail(400, 'invalid_grant'); }
      const token = secret(), expires = Date.now() + LIMITS.grantSeconds * 1000;
      const result = await rpc('code_redeem', {
        client_id: machine.client_id, request_id: b.request_id, code_hash: hash(b.code),
        pkce_challenge: challenge(b.code_verifier), callback_uri: CALLBACK,
        token_hash: hash(token), expires_at: expires,
      });
      if (!Array.isArray(result.scopes) || !result.scopes.length || result.scopes.some(s => !SCOPES.includes(s))) fail(400, 'invalid_grant');
      return response(200, {
        operator_token: token, expires_in: LIMITS.grantSeconds,
        scope: result.scopes.join(' '), resource: issuer + PATHS.mcp,
      });
    }
    if (req.path === PATHS.revoke) {
      exact(req.body, []);
      const actor = await authorized(machine);
      await rpc('revoke', { client_id: machine.client_id, grant_id: actor.grant_id, operator_id: actor.operator_id });
      return response(200, { revoked: true });
    }
    if (req.path !== PATHS.mcp) fail(404, 'RUTA_NO_ENCONTRADA');
    if (!['POST', 'DELETE'].includes(req.method)) fail(405, 'METODO_NO_ADMITIDO');
    const actor = await authorized(machine);
    const binding = { client_id: machine.client_id, operator_id: actor.operator_id, grant_id: actor.grant_id };
    const lease = await rpc('enter', { ...binding, limits: LIMITS });
    text(lease.lease_id);
    try {
      const b = req.body;
      if (req.method === 'DELETE') {
        if (h['mcp-protocol-version'] !== VERSION) fail(400, 'VERSION_NO_ADMITIDA');
        await rpc('session_close', { ...binding, session_hash: hash(opaque(h['mcp-session-id'])) });
        return response(204, '');
      }
      if (!P.object(b) || b.jsonrpc !== '2.0' || typeof b.method !== 'string' ||
          Object.keys(b).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k)) ||
          (b.id !== undefined && !(typeof b.id === 'string' && b.id.length <= 128) &&
            !(Number.isSafeInteger(b.id)))) {
        return response(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Petición inválida' } });
      }
      const result = value => response(200, { jsonrpc: '2.0', id: b.id, result: value });
      const invalid = (code, message) => response(200, { jsonrpc: '2.0', id: b.id ?? null, error: { code, message } });
      if (b.method === 'initialize') {
        if (b.id === undefined || h['mcp-session-id']) fail(400, 'INICIALIZACION_INVALIDA');
        exact(b.params, ['protocolVersion', 'capabilities', 'clientInfo']);
        exact(b.params.clientInfo, ['name', 'version']);
        text(b.params.clientInfo.name, 1, 64); text(b.params.clientInfo.version, 1, 64);
        if (!P.object(b.params.capabilities) || b.params.protocolVersion !== VERSION ||
            (h['mcp-protocol-version'] !== undefined && h['mcp-protocol-version'] !== VERSION)) fail(400, 'VERSION_NO_ADMITIDA');
        const sid = secret();
        await rpc('session_create', { ...binding, session_hash: hash(sid), version: VERSION,
          expires_at: actor.expires_at, idle_seconds: LIMITS.idleSeconds });
        await authorized(machine);
        return { ...result({
          protocolVersion: VERSION, capabilities: { tools: {} },
          serverInfo: { name: 'agy-phase1-isolated', version: '0.1.0-review' },
        }), headers: { ...result({}).headers, 'mcp-session-id': sid } };
      }
      if (h['mcp-protocol-version'] !== VERSION) fail(400, 'VERSION_NO_ADMITIDA');
      const sessionHash = hash(opaque(h['mcp-session-id']));
      const session = await rpc('session_read', { ...binding, session_hash: sessionHash });
      if (session.client_id !== binding.client_id || session.operator_id !== binding.operator_id ||
          session.grant_id !== binding.grant_id || session.version !== VERSION || !['initialized', 'ready'].includes(session.state) ||
          session.expires_at <= Date.now() || session.last_seen <= Date.now() - LIMITS.idleSeconds * 1000) fail(404, 'SESION_NO_ACCESIBLE');
      if (b.method === 'notifications/initialized') {
        if (b.id !== undefined || session.state !== 'initialized') fail(400, 'INICIALIZACION_INVALIDA');
        if (b.params !== undefined) exact(b.params, []);
        await rpc('session_ready', { ...binding, session_hash: sessionHash });
        return response(202, '');
      }
      if (session.state !== 'ready') fail(400, 'MCP_NO_INICIALIZADO');
      if (b.id === undefined) fail(400, 'ID_REQUERIDO');
      let data;
      if (b.method === 'tools/list') {
        if (b.params !== undefined) exact(b.params, []);
        data = { tools: catalog.tools(actor.scopes) };
      } else if (b.method === 'tools/call') {
        try {
          exact(b.params, ['name', 'arguments']);
          const content = catalog.run(b.params.name, b.params.arguments, actor.scopes);
          data = { content: [{ type: 'text', text: JSON.stringify(content) }], structuredContent: content, isError: false };
        } catch (error) {
          if (!(error instanceof P.Denied)) throw error;
          if (error.status === 400) return invalid(-32602, error.code);
          await authorized(machine);
          return result({ isError: true, content: [{ type: 'text', text: error.code }] });
        }
      } else return invalid(-32601, 'Método no admitido');
      const current = await authorized(machine);
      if (current.grant_id !== actor.grant_id || current.operator_id !== actor.operator_id ||
          actor.scopes.some(scope => !current.scopes.includes(scope))) fail(403, 'AUTORIZACION_REVOCADA');
      return result(data);
    } finally {
      // Persistent lease release/audit is required; failure cannot silently succeed.
      await rpc('leave', { ...binding, lease_id: lease.lease_id });
      const finalActor = await authorized(machine);
      if (finalActor.grant_id !== actor.grant_id || finalActor.operator_id !== actor.operator_id ||
          actor.scopes.some(scope => !finalActor.scopes.includes(scope))) fail(403, 'AUTORIZACION_REVOCADA');
    }
  }
  return {
    async handle(req) {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          serve(req, controller.signal),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new P.Denied(503, 'PLAZO_EXCEDIDO'));
          }, LIMITS.deadlineMs); }),
        ]);
      } catch (error) { return errorResponse(error); }
      finally { clearTimeout(timer); }
    },
  };
}
module.exports = { createEngine };