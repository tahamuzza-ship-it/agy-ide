'use strict';

// Invitation acceptance only. Never import the operator authority, MCP, SQL or IDE grants.
const { createHash } = require('node:crypto');
const { invitationPage } = require('./operator-invitation-page.cjs');
const SUPABASE_ORIGIN = 'https://lxlcivzuevowckbcxczc.supabase.co';
const OPERATOR_ORIGIN = 'https://agy-ide-production.up.railway.app';
// Modern Publishable keys are opaque; their prefix is type, NOT project proof.
// Keep null until a separately authorized, independent attestation of this exact key.
const VERIFIED_PUBLISHABLE_KEY_2_SHA256 = null;
const PATH = '/api/agy/operator/invitation';

function validPublishableKey(key) {
  // Only an independently attested exact digest binds the key to Supabase 2.
  return typeof key === 'string' && key.length <= 8192 &&
    /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key) &&
    typeof VERIFIED_PUBLISHABLE_KEY_2_SHA256 === 'string' &&
    /^[a-f0-9]{64}$/.test(VERIFIED_PUBLISHABLE_KEY_2_SHA256) &&
    createHash('sha256').update(key).digest('hex') === VERIFIED_PUBLISHABLE_KEY_2_SHA256;
}

function createInvitationReceiver({ env = process.env, provider, now = Date.now } = {}) {
  const origin = env.AGY_OPERATOR_ORIGIN;
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY_2;
  const enabled = env.AGY_OPERATOR_INVITATIONS_ENABLED === 'true' &&
    origin === OPERATOR_ORIGIN && env.SUPABASE_URL_2 === SUPABASE_ORIGIN &&
    validPublishableKey(publicKey);
  // Validate ALL configuration before loading the SDK or making any network call.
  // Injected test providers cannot bypass these checks. No privileged-key fallback.
  if (provider === undefined && enabled) {
    const { createClient } = require('@supabase/supabase-js');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) }) } };
    provider = {
      async acceptInvitation(accessToken, refreshToken, password) {
        const auth = createClient(SUPABASE_ORIGIN, publicKey, options).auth;
        const { data: verified, error: verifyError } = await auth.getUser(accessToken);
        const user = verified?.user;
        if (verifyError || !user || !/^[0-9a-f-]{36}$/i.test(user.id || '') ||
            !user.email || !user.email_confirmed_at || user.is_anonymous === true ||
            (user.banned_until && Date.parse(user.banned_until) > Date.now()) ||
            !user.invited_at || !Number.isFinite(Date.parse(user.invited_at))) {
          throw invalid(401, 'OPERADOR_INVITACION_INVALIDA');
        }
        const { data: session, error: sessionError } = await auth.setSession({
          access_token: accessToken, refresh_token: refreshToken,
        });
        if (sessionError || !session?.session || session.session.access_token !== accessToken ||
            session.user?.id !== user.id) throw invalid(401, 'OPERADOR_INVITACION_INVALIDA');
        const { data: updated, error: updateError } = await auth.updateUser({ password });
        if (updateError || updated?.user?.id !== user.id) throw invalid(503, 'OPERADOR_INVITACION_NO_COMPLETADA');
      },
    };
  }
  const ready = () => Boolean(enabled && provider && typeof provider.acceptInvitation === 'function');
  const attempts = new Map();
  function rate(req, token) {
    const time = now();
    for (const [key, value] of attempts) if (time > value.until) attempts.delete(key);
    for (const key of ['ip:' + (req.socket?.remoteAddress || 'unknown'),
      'token:' + createHash('sha256').update(token).digest('hex')]) {
      if (!attempts.has(key)) {
        if (attempts.size >= 2000) throw invalid(429, 'OPERADOR_INVITACION_LIMITE');
        attempts.set(key, { count: 0, until: time + 600000 });
      }
      if (++attempts.get(key).count > 10) throw invalid(429, 'OPERADOR_INVITACION_LIMITE');
    }
  }
  function register(app) {
    app.get(PATH, (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('X-Frame-Options', 'DENY');
      const noQuery = !Object.keys(req.query || {}).length;
      const { html, csp } = invitationPage(ready(), noQuery);
      res.set('Content-Security-Policy', csp).status(noQuery ? (ready() ? 200 : 503) : 400).type('html').send(html);
    });
    app.post(PATH, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        if (!ready()) throw invalid(503, 'OPERADOR_INVITACION_NO_CONFIGURADA');
        if (req.headers.origin !== origin || req.headers['x-agy-operator-request'] !== '1' ||
            (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          throw invalid(403, 'OPERADOR_ORIGEN_INVALIDO');
        }
        if (Object.keys(req.query || {}).length) throw invalid(400, 'OPERADOR_INVITACION_FORMATO_INVALIDO');
        if (!req.is('application/json')) throw invalid(415, 'OPERADOR_INVITACION_FORMATO_INVALIDO');
        const body = req.body;
        if (!body || Array.isArray(body) || typeof body !== 'object' ||
            Object.keys(body).sort().join(',') !== 'accessToken,confirmation,password,refreshToken,type' ||
            body.type !== 'invite' ||
            typeof body.accessToken !== 'string' || body.accessToken.length > 8192 ||
            !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.accessToken) ||
            typeof body.refreshToken !== 'string' || !/^[A-Za-z0-9._~-]{20,8192}$/.test(body.refreshToken) ||
            typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 1024 ||
            typeof body.confirmation !== 'string' || body.password !== body.confirmation ||
            JSON.stringify(body).length > 20500) throw invalid(400, 'OPERADOR_INVITACION_FORMATO_INVALIDO');
        rate(req, body.accessToken);
        await provider.acceptInvitation(body.accessToken, body.refreshToken, body.password);
        // No AGY session, cookie, scope, grant, or provider credential is returned.
        res.json({ ok: true, authorized: false });
      } catch (error) {
        res.status(error.status || 503).json({ ok: false, error: error.code || 'OPERADOR_INVITACION_NO_DISPONIBLE' });
      }
    });
  }
  return { ready, register };
}

function invalid(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

function registerInvitationRoutes(app, options) {
  return createInvitationReceiver(options).register(app);
}

module.exports = { createInvitationReceiver, registerInvitationRoutes };