'use strict';

// REVIEW ONLY: immutable lock; no production login/session/logout until separate authorization.
// No enrollment or grant-management HTTP API. Invitation receiver is a separate deployed module.
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
class OperatorError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const APP = 'agy-ide';
const OPERATOR_SUPABASE_ORIGIN = 'https://lxlcivzuevowckbcxczc.supabase.co';
const OPERATOR_ORIGIN = 'https://agy-ide-production.up.railway.app';
const OPERATOR_AUTH_RELEASE_ENABLED = false;
// No public key was independently attested; decode claims AND pin independently before a later approval.
const VERIFIED_AUTH_ANON_KEY_SHA256 = null;
// This pin is independent of the anon pin. The database client must NEVER
// reuse the legacy SUPABASE_SERVICE_ROLE_KEY (which may belong to another project).
const VERIFIED_SERVICE_ROLE_KEY_2_SHA256 = null;
const COOKIE = { sid: '__Host-agy_operator', token: '__Host-agy_identity', csrf: '__Host-agy_csrf' };
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, code) => { throw new OperatorError(status, code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function validPublicKey(key) {
  if (typeof key !== 'string' || key.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    // Claims are not evidence of the key's origin: only independent SHA-256 pinning is.
    return claims?.role === 'anon' && claims.ref === 'lxlcivzuevowckbcxczc' &&
      typeof VERIFIED_AUTH_ANON_KEY_SHA256 === 'string' &&
      /^[a-f0-9]{64}$/.test(VERIFIED_AUTH_ANON_KEY_SHA256) &&
      digest(key) === VERIFIED_AUTH_ANON_KEY_SHA256;
  } catch { return false; }
}
function validServiceRoleKey(key) {
  if (typeof key !== 'string' || key.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    // JWT claims alone are NOT proof; require an independently attested fingerprint.
    return claims?.role === 'service_role' && claims.ref === 'lxlcivzuevowckbcxczc' &&
      typeof VERIFIED_SERVICE_ROLE_KEY_2_SHA256 === 'string' &&
      /^[a-f0-9]{64}$/.test(VERIFIED_SERVICE_ROLE_KEY_2_SHA256) &&
      digest(key) === VERIFIED_SERVICE_ROLE_KEY_2_SHA256;
  } catch { return false; }
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) {
      const name = part.slice(0, at).trim();
      if (Object.values(COOKIE).includes(name)) {
        if (Object.hasOwn(out, name)) fail(401, 'OPERADOR_COOKIE_INVALIDA');
        out[name] = part.slice(at + 1).trim();
      }
    }
  }
  return out;
}
function identity(user) {
  // Never use user_metadata, app selector, email alone or a caller-supplied UUID.
  if (!user || !/^[0-9a-f-]{36}$/i.test(user.id || '') || !user.email_confirmed_at ||
      !user.email || user.is_anonymous === true ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())) fail(401, 'OPERADOR_IDENTIDAD_NO_VERIFICADA');
  return { id: user.id, email: user.email };
}

function createSupabaseAdapters(env = process.env) {
  // Check all public config before reading the project-specific DB credential.
  // Never read or fall back to the legacy SUPABASE_SERVICE_ROLE_KEY.
  if (!OPERATOR_AUTH_RELEASE_ENABLED || env.AGY_OPERATOR_AUTH_ENABLED !== 'true' ||
      env.AGY_OPERATOR_ORIGIN !== OPERATOR_ORIGIN ||
      env.SUPABASE_URL_2 !== OPERATOR_SUPABASE_ORIGIN ||
      !validPublicKey(env.SUPABASE_ANON_KEY_2)) return null;
  // Reject a mismatched/unattested DB credential BEFORE loading SDK or making requests.
  const key = env.SUPABASE_SERVICE_ROLE_KEY_2;
  if (!validServiceRoleKey(key)) return null;
  const { createClient } = require('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) }) } };
  // The privileged DB client NEVER signs in. Separate public-key Auth clients
  // cannot replace the privileged grant/session storage client.
  const db = createClient(OPERATOR_SUPABASE_ORIGIN, key, options);
  const auth = () => createClient(OPERATOR_SUPABASE_ORIGIN, env.SUPABASE_ANON_KEY_2, options).auth;
  async function check(query) {
    const { data, error } = await query;
    if (error) fail(503, 'OPERADOR_ALMACEN_NO_DISPONIBLE');
    return data;
  }
  return {
    provider: {
      async login(email, password) {
        const { data, error } = await auth().signInWithPassword({ email, password });
        if (error || !data.session) fail(401, 'OPERADOR_LOGIN_INVALIDO');
        // Explicit online identity verification, never trust login payload alone.
        const verified = await this.user(data.session.access_token);
        return { user: verified, accessToken: data.session.access_token, expiresAt: data.session.expires_at * 1000 };
      },
      async user(token) {
        const { data, error } = await auth().getUser(token);
        if (error || !data.user) fail(401, 'OPERADOR_IDENTIDAD_NO_VERIFICADA');
        return data.user;
      },
    },
    store: {
      session: hash => check(db.from('agy_operator_sessions').select('*').eq('id_hash', hash).maybeSingle()),
      grant: user => check(db.from('agy_operator_grants').select('*').eq('user_id', user).eq('application', APP).maybeSingle()),
      insert: row => check(db.from('agy_operator_sessions').insert(row)),
      revoke: hash => check(db.from('agy_operator_sessions').update({ revoked_at: new Date().toISOString() }).eq('id_hash', hash)),
    },
  };
}

function createOperatorAuthority({ adapters, env = process.env, now = Date.now } = {}) {
  // Tests only: inject adapters into an in-memory VM that substitutes the release
  // lock. The normal server never injects adapters or substitutes source.
  let configured = adapters;
  if (configured === undefined) configured = createSupabaseAdapters(env);
  const origin = env.AGY_OPERATOR_ORIGIN;
  const validOrigin = origin === OPERATOR_ORIGIN;
  const attempts = new Map();
  function ready() { return Boolean(OPERATOR_AUTH_RELEASE_ENABLED && configured && validOrigin); }
  function requireReady() { if (!ready()) fail(503, 'OPERADOR_AUTORIDAD_NO_CONFIGURADA'); }
  function protect(req) {
    requireReady();
    if (req.headers.origin !== origin || req.headers['x-agy-operator-request'] !== '1' ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) fail(403, 'OPERADOR_ORIGEN_INVALIDO');
  }
  function rate(req, email) {
    const time = now();
    for (const [k, v] of attempts) if (time > v.until) attempts.delete(k);
    // Use socket address, not untrusted forwarded/IP headers. Shared proxy may
    // conservatively rate-limit multiple users together; never weakens protection.
    const keys = ['ip:' + (req.socket?.remoteAddress || 'unknown'), 'account:' + digest(email)];
    for (const key of keys) {
      if (!attempts.has(key)) {
        if (attempts.size >= 2000) fail(429, 'OPERADOR_LOGIN_LIMITE');
        attempts.set(key, { count: 0, until: time + 600000 });
      }
      if (++attempts.get(key).count > 10) fail(429, 'OPERADOR_LOGIN_LIMITE');
    }
  }
  function writeCookies(res, values, maxAge) {
    res.setHeader('Set-Cookie', Object.entries(COOKIE).map(([name, cookie]) =>
      `${cookie}=${values[name] || ''}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`));
  }
  async function current(req, csrf = false) {
    requireReady();
    const values = cookies(req), sid = values[COOKIE.sid], token = values[COOKIE.token], proof = values[COOKIE.csrf];
    if (!/^[0-9a-f]{64}$/.test(sid || '') || typeof token !== 'string' || token.length > 8192 || token.length < 20 ||
        !/^[0-9a-f]{64}$/.test(proof || '')) fail(401, 'OPERADOR_SESION_REQUERIDA');
    if (csrf) { protect(req); if (!same(req.headers['x-agy-csrf'], proof)) fail(403, 'OPERADOR_CSRF_INVALIDO'); }
    const session = await configured.store.session(digest(sid));
    if (!session || session.application !== APP || session.revoked_at || Date.parse(session.expires_at) <= now() ||
        !Number.isFinite(Date.parse(session.expires_at)) || !same(session.token_hash, digest(token)) ||
        !same(session.csrf_hash, digest(proof))) fail(401, 'OPERADOR_SESION_REVOCADA');
    const user = identity(await configured.provider.user(token));
    if (user.id !== session.user_id) fail(401, 'OPERADOR_SESION_INVALIDA');
    const grant = await configured.store.grant(user.id); // NO authorization cache.
    const expires = grant && Date.parse(grant.expires_at);
    const allowed = grant && grant.user_id === user.id && grant.application === APP && !grant.revoked_at &&
      Number.isFinite(expires) && expires > now() && Array.isArray(grant.scopes) &&
      grant.scopes.length > 0 && grant.scopes.every(s => ['memory.read', 'execution.propose'].includes(s));
    return { user, session, grant: allowed ? grant : null, proof };
  }
  async function verifyOperator(req) {
    const state = await current(req, true);
    if (!state.grant) fail(403, 'OPERADOR_AGY_SIN_PERMISO');
    return { audience: APP, subject: state.user.id, sessionId: state.session.id_hash,
      scopes: state.grant.scopes, expiresAt: Math.min(Date.parse(state.session.expires_at), Date.parse(state.grant.expires_at)),
      csrfVerified: true };
  }
  function routes(app, requirePwd) {
    const wrap = handler => async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try { await handler(req, res); } catch (error) {
        res.status(error instanceof OperatorError ? error.status : 503).json({ ok: false, error: error instanceof OperatorError ? error.code : 'OPERADOR_SERVICIO_NO_DISPONIBLE' });
      }
    };
    app.get('/api/agy/operator/session', requirePwd, wrap(async (req, res) => {
      if (!ready()) return res.json({ ok: true, configured: false, authenticated: false, authorized: false });
      const state = await current(req);
      res.json({ ok: true, configured: true, authenticated: true, authorized: Boolean(state.grant),
        user: state.user, scopes: state.grant?.scopes || [], csrf: state.proof,
        expiresAt: Date.parse(state.session.expires_at) });
    }));
    app.post('/api/agy/operator/login', requirePwd, wrap(async (req, res) => {
      protect(req);
      const body = req.body;
      if (!body || Object.keys(body).sort().join(',') !== 'email,password' || typeof body.email !== 'string' ||
          body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
          typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 1024) fail(400, 'OPERADOR_LOGIN_INVALIDO');
      rate(req, body.email.toLowerCase());
      const logged = await configured.provider.login(body.email, body.password);
      const user = identity(await configured.provider.user(logged.accessToken));
      if (typeof logged.accessToken !== 'string' || /[\s;]/.test(logged.accessToken) || logged.accessToken.length > 8192) fail(401, 'OPERADOR_LOGIN_INVALIDO');
      const expires = Math.min(logged.expiresAt, now() + 3600000);
      if (!Number.isFinite(expires) || expires <= now()) fail(401, 'OPERADOR_LOGIN_INVALIDO');
      const sid = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      // Revoke previous browser session before replacing it (including user switch).
      const previous = cookies(req)[COOKIE.sid];
      if (/^[0-9a-f]{64}$/.test(previous || '')) await configured.store.revoke(digest(previous));
      await configured.store.insert({ id_hash: digest(sid), token_hash: digest(logged.accessToken), csrf_hash: digest(csrf),
        user_id: user.id, application: APP, expires_at: new Date(expires).toISOString(), revoked_at: null });
      writeCookies(res, { sid, token: logged.accessToken, csrf }, Math.floor((expires - now()) / 1000));
      res.json({ ok: true }); // No provider token/password/user claims in response.
    }));
    app.post('/api/agy/operator/logout', requirePwd, wrap(async (req, res) => {
      protect(req);
      const values = cookies(req);
      if (!same(req.headers['x-agy-csrf'], values[COOKIE.csrf])) fail(403, 'OPERADOR_CSRF_INVALIDO');
      if (/^[0-9a-f]{64}$/.test(values[COOKIE.sid] || '')) await configured.store.revoke(digest(values[COOKIE.sid]));
      // DB failure does not pretend to have revoked a still-live stolen session.
      writeCookies(res, {}, 0);
      res.json({ ok: true });
    }));
  }
  return { ready, verifyOperator, routes };
}
module.exports = { createOperatorAuthority, createSupabaseAdapters };