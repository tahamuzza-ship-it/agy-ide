'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const PREFIX = '/api/notebooklm/admin';
const COOKIE = '__Secure-agy-notebooklm-admin';
const UPSTREAM_COOKIE = '__Secure-notebooklm-admin';
const MAX_BODY = 16 * 1024;

function constantEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactHttpsOrigin(value, name) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search ||
      url.hash || url.pathname !== '/' || String(value).endsWith('/')) {
    throw new Error(`${name} must be an exact HTTPS origin without a path.`);
  }
  return url.origin;
}

function configuration(options = {}) {
  const env = options.env || process.env;
  const cloudOrigin = exactHttpsOrigin(
    options.cloudUrl || env.NOTEBOOKLM_CLOUD_URL,
    'NOTEBOOKLM_CLOUD_URL',
  );
  const browserOrigin = exactHttpsOrigin(
    options.browserOrigin || env.AGY_PUBLIC_ORIGIN,
    'AGY_PUBLIC_ORIGIN',
  );
  const adminKey = String(options.adminKey || env.NOTEBOOKLM_CLOUD_ADMIN_KEY || '');
  const hubKey = String(env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN || '');
  if (adminKey.length < 32 || (hubKey && constantEqual(adminKey, hubKey))) {
    throw new Error('A distinct NOTEBOOKLM_CLOUD_ADMIN_KEY of at least 32 characters is required.');
  }
  const ttl = Number(options.ttlSeconds || env.NOTEBOOKLM_LOGIN_TTL_SECONDS || 300);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) {
    throw new Error('The AGY administrative TTL must be between 1 and 300 seconds.');
  }
  return { env, cloudOrigin, browserOrigin, adminKey, ttl };
}

function cookieValue(header, name) {
  for (const item of String(header || '').split(';')) {
    const at = item.indexOf('=');
    if (at < 0 || item.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(at + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function upstreamCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/(?:^|,\s*)__Secure-notebooklm-admin=([^;,]*)/);
  if (!match || !match[1]) throw new Error('Cloud gateway did not create a secure session.');
  return `${UPSTREAM_COOKIE}=${match[1]}`;
}

function jsonError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json({ error: message });
}

function sameOrigin(req, config) {
  return req.headers.origin === config.browserOrigin &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
}

function createNotebookCloudAdmin(options = {}) {
  const config = configuration(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const random = options.randomBytes || crypto.randomBytes;
  const sessions = new Map();

  function prune() {
    const timestamp = now();
    for (const [token, session] of sessions) {
      if (timestamp >= session.expiresAt || timestamp - session.authenticatedAt > 300000) {
        sessions.delete(token);
        if (session.socket) session.socket.close(1008, 'Session expired');
      }
    }
  }

  function sessionFor(req) {
    prune();
    const token = cookieValue(req.headers.cookie, COOKIE);
    const session = token && sessions.get(token);
    return session && constantEqual(token, session.token) ? session : null;
  }

  function csrfSession(req) {
    const session = sessionFor(req);
    const supplied = req.headers['x-agy-admin-csrf'];
    return session && constantEqual(supplied, session.csrf) ? session : null;
  }

  function privateHeaders(session, origin, csrfVerified) {
    return {
      'X-NotebookLM-Admin-Key': config.adminKey,
      'X-AGY-Administrator': session.actor,
      'X-AGY-Authenticated-At': String(session.authenticatedAt / 1000),
      Origin: origin,
      ...(csrfVerified ? { 'X-AGY-CSRF-Verified': 'true' } : {}),
    };
  }

  async function upstreamPost(path, session, confirmed) {
    const response = await fetchImpl(`${config.cloudOrigin}/admin/${path}`, {
      method: 'POST',
      headers: {
        ...privateHeaders(session, config.browserOrigin, path === 'session'),
        'Content-Type': 'application/json',
        ...(session.upstreamCookie ? {
          Cookie: session.upstreamCookie,
          'X-CSRF-Token': session.upstreamCsrf,
        } : {}),
      },
      body: JSON.stringify(confirmed ? { confirmed: true } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function setSessionCookie(res, token, maxAge) {
    res.setHeader('Set-Cookie',
      `${COOKIE}=${encodeURIComponent(token)}; Path=${PREFIX}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`);
  }

  async function create(req, res) {
    if (!sameOrigin(req, config) || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return jsonError(res, 403, 'Solicitud administrativa de origen no válido.');
    }
    if (!req.body || req.body.confirmed !== true) {
      return jsonError(res, 400, 'Se requiere confirmación humana explícita.');
    }
    prune();
    if (sessions.size) return jsonError(res, 409, 'Ya existe una sesión administrativa activa.');
    const token = random(32).toString('base64url');
    const session = {
      token,
      csrf: random(32).toString('base64url'),
      actor: String(options.actor || 'agy-administrator').slice(0, 200),
      authenticatedAt: now(),
      expiresAt: now() + config.ttl * 1000,
      upstreamCookie: '',
      upstreamCsrf: '',
      desktopGrant: false,
      socket: null,
    };
    try {
      const { response, data } = await upstreamPost('session', session, true);
      if (!response.ok || typeof data.csrf !== 'string' || !data.csrf) {
        return jsonError(res, response.status === 409 ? 409 : 503,
          'El escritorio privado no está disponible.');
      }
      session.upstreamCookie = upstreamCookie(response);
      session.upstreamCsrf = data.csrf;
      const upstreamTtl = Math.max(1, Math.min(config.ttl, Number(data.expires_in) || config.ttl));
      session.expiresAt = Math.min(session.expiresAt, now() + upstreamTtl * 1000);
      sessions.set(token, session);
      setSessionCookie(res, token, upstreamTtl);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ csrf: session.csrf, expires_in: upstreamTtl });
    } catch {
      return jsonError(res, 503, 'No se pudo iniciar el escritorio privado.');
    }
  }

  async function end(req, res, finish) {
    if (!sameOrigin(req, config)) return jsonError(res, 403, 'Origen no válido.');
    const session = csrfSession(req);
    if (!session) return jsonError(res, 403, 'Sesión administrativa no válida.');
    sessions.delete(session.token);
    session.desktopGrant = false;
    if (session.socket) session.socket.close(1000, 'Session closed');
    try {
      const { response, data } = await upstreamPost(finish ? 'finish' : 'revoke', session, false);
      setSessionCookie(res, '', 0);
      res.setHeader('Cache-Control', 'no-store');
      if (!response.ok) return res.status(502).json({ error: 'No se pudo cerrar limpiamente la sesión remota.' });
      return res.json({ hub_ready: Boolean(data.hub_ready) });
    } catch {
      setSessionCookie(res, '', 0);
      return jsonError(res, 502, 'La sesión local fue revocada; el gateway no confirmó el cierre.');
    }
  }

  function grantDesktop(req, res) {
    if (!sameOrigin(req, config)) return jsonError(res, 403, 'Origen no válido.');
    const session = csrfSession(req);
    if (!session) return jsonError(res, 403, 'Sesión administrativa no válida.');
    session.desktopGrant = true;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ready: true });
  }

  function status(req, res) {
    if (!sameOrigin(req, config)) return jsonError(res, 403, 'Origen no válido.');
    const session = csrfSession(req);
    if (!session) return jsonError(res, 403, 'Sesión administrativa no válida.');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ active: true, expires_in: Math.max(0, Math.ceil((session.expiresAt - now()) / 1000)) });
  }

  async function revokeAll() {
    const pending = [...sessions.values()];
    sessions.clear();
    await Promise.allSettled(pending.map(session => upstreamPost('revoke', session, false)));
  }

  async function getReadiness() {
    const unavailable = {
      configured: true,
      reachable: false,
      sandboxReady: false,
      notebooklm: 'UNKNOWN',
      ready: false,
    };
    const configuredTimeout = Number(options.readinessTimeoutMs || 5000);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(250, Math.min(10000, configuredTimeout))
      : 5000;
    try {
      const response = await fetchImpl(`${config.cloudOrigin}/healthz`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return unavailable;
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') return unavailable;
      const notebooklm = ['READY', 'SESSION_REQUIRED'].includes(data.notebooklm)
        ? data.notebooklm
        : 'UNKNOWN';
      const sandboxReady = data.sandboxReady === true;
      return {
        configured: true,
        reachable: true,
        sandboxReady,
        notebooklm,
        ready: sandboxReady,
      };
    } catch {
      return unavailable;
    }
  }

  return {
    config, sessions, create, end, grantDesktop, status, sessionFor,
    privateHeaders, revokeAll, getReadiness,
  };
}

function registerNotebookCloudAdmin(app, requirePwd, options = {}) {
  if (!app || typeof app.post !== 'function' || typeof requirePwd !== 'function') {
    throw new TypeError('Express app and existing requirePwd middleware are required.');
  }
  const admin = options.admin || createNotebookCloudAdmin(options);
  app.post(`${PREFIX}/session`, requirePwd, admin.create);
  app.post(`${PREFIX}/desktop-access`, admin.grantDesktop);
  app.post(`${PREFIX}/finish`, (req, res) => admin.end(req, res, true));
  app.post(`${PREFIX}/revoke`, (req, res) => admin.end(req, res, false));
  app.get(`${PREFIX}/status`, admin.status);
  return admin;
}

function attachNotebookCloudAdminWs(server, options = {}) {
  const admin = options.admin;
  if (!server || typeof server.on !== 'function' || !admin) {
    throw new TypeError('HTTP server and the registered admin instance are required.');
  }
  const wsModule = options.wsModule || require('ws');
  const { WebSocket, WebSocketServer } = wsModule;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  const onUpgrade = (req, socket, head) => {
    let parsed;
    try { parsed = new URL(req.url, 'https://agy.invalid'); } catch { return; }
    if (parsed.pathname !== `${PREFIX}/desktop`) return;
    if (parsed.search || req.headers.origin !== admin.config.browserOrigin ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      socket.destroy();
      return;
    }
    const session = admin.sessionFor(req);
    if (!session || !session.desktopGrant || session.socket) {
      socket.destroy();
      return;
    }
    session.desktopGrant = false;
    const upstreamUrl = `${admin.config.cloudOrigin.replace(/^https:/, 'wss:')}/admin/desktop`;
    const upstream = new WebSocket(upstreamUrl, ['binary'], {
      headers: {
        ...admin.privateHeaders(session, admin.config.browserOrigin, false),
        Cookie: session.upstreamCookie,
        'X-CSRF-Token': session.upstreamCsrf,
      },
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
      handshakeTimeout: 10000,
      followRedirects: false,
    });
    let accepted = false;
    const fail = () => {
      if (!accepted) socket.destroy();
      if (upstream.readyState < WebSocket.CLOSING) upstream.close(1011);
    };
    upstream.once('open', () => {
      wss.handleUpgrade(req, socket, head, browser => {
        accepted = true;
        session.socket = browser;
        browser.on('message', (data, binary) => {
          if (!binary || upstream.readyState !== WebSocket.OPEN) return browser.close(1003);
          upstream.send(data, { binary: true });
        });
        upstream.on('message', (data, binary) => {
          if (!binary || browser.readyState !== WebSocket.OPEN) return browser.close(1003);
          browser.send(data, { binary: true });
        });
        browser.once('close', () => {
          if (session.socket === browser) session.socket = null;
          if (upstream.readyState < WebSocket.CLOSING) upstream.close(1000);
        });
        upstream.once('close', (code) => {
          if (browser.readyState < WebSocket.CLOSING) browser.close(code === 1000 ? 1000 : 1011);
        });
        upstream.once('error', () => browser.close(1011));
      });
    });
    upstream.once('error', fail);
    upstream.once('unexpected-response', fail);
  };
  server.on('upgrade', onUpgrade);
  return { close: () => { server.off('upgrade', onUpgrade); wss.close(); }, wss };
}

function getNotebookCloudNoVncRoot() {
  return path.dirname(path.dirname(require.resolve('@novnc/novnc')));
}

module.exports = {
  PREFIX,
  COOKIE,
  createNotebookCloudAdmin,
  registerNotebookCloudAdmin,
  attachNotebookCloudAdminWs,
  getNotebookCloudNoVncRoot,
};