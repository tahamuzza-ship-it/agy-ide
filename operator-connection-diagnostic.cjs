'use strict';
// TEMPORARY read-only diagnostic; remove immediately after the approved verification.
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_ORIGIN = 'https://lxlcivzuevowckbcxczc.supabase.co';
const APP_ORIGIN = 'https://agy-ide-production.up.railway.app';
const EXPIRES_AT = Date.parse('2026-09-28T22:32:49.439Z');
const safeFetch = (url, init = {}) => fetch(url, {
  ...init, redirect: 'error', signal: AbortSignal.timeout(8000)
});
const keyShape = (value, prefix) => typeof value === 'string' &&
  value.length <= 8192 && new RegExp('^' + prefix + '[A-Za-z0-9_-]{8,}$').test(value);

function registerOperatorConnectionDiagnostic(app, requirePwd) {
  let used = false;
  app.post('/api/agy/operator/connection-diagnostic', requirePwd, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (Date.now() >= EXPIRES_AT) return res.status(410).json({ status: 'expired' });
    if (req.headers.origin !== APP_ORIGIN || req.headers['x-agy-operator-diagnostic'] !== 'read-only') {
      return res.status(403).json({ status: 'forbidden' });
    }
    if (used) return res.status(409).json({ status: 'already_run' });
    used = true;
    const env = process.env;
    if (env.SUPABASE_URL_2 !== SUPABASE_ORIGIN ||
        !keyShape(env.SUPABASE_PUBLISHABLE_KEY_2, 'sb_publishable_') ||
        !keyShape(env.SUPABASE_SECRET_KEY_2, 'sb_secret_')) {
      return res.json({ status: 'configuration_rejected' });
    }
    try {
      const authStatus = async key => {
        const response = await safeFetch(SUPABASE_ORIGIN + '/auth/v1/settings', {
          method: 'GET', headers: { apikey: key }
        });
        await response.body?.cancel();
        return response.status;
      };
      const [publishableStatus, invalidControlStatus] = await Promise.all([
        authStatus(env.SUPABASE_PUBLISHABLE_KEY_2),
        authStatus('sb_publishable_invalidcontrol00000000')
      ]);
      const db = createClient(SUPABASE_ORIGIN, env.SUPABASE_SECRET_KEY_2, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: safeFetch }
      });
      const grants = await db.from('agy_operator_grants').select('*', { head: true }).limit(0);
      const sessions = await db.from('agy_operator_sessions').select('*', { head: true }).limit(0);
      return res.json({
        status: 'complete',
        publishableAuth: {
          accepted: publishableStatus === 200 && invalidControlStatus !== 200,
          status: publishableStatus, controlStatus: invalidControlStatus
        },
        secretSelect: {
          grants: { ok: !grants.error, status: grants.status },
          sessions: { ok: !sessions.error, status: sessions.status }
        }
      });
    } catch {
      return res.status(503).json({ status: 'diagnostic_unavailable' });
    }
  });
}
module.exports = { registerOperatorConnectionDiagnostic };
