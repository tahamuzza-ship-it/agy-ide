'use strict';
const { fail } = require('./policy.cjs');

// The existing project's @supabase/supabase-js clients must be supplied by the host.
// No environment reads, credentials, SQL, table creation, fallback store or cache.
const ACTIONS = new Set([
  'health', 'client', 'operator_session', 'link_create', 'link_read', 'link_approve',
  'code_redeem', 'authorize', 'session_create', 'session_read', 'session_ready',
  'session_close', 'enter', 'leave', 'revoke',
]);
function createSupabaseAuthority({ db, auth } = {}) {
  return {
    async call(action, args, signal) {
      if (!ACTIONS.has(action) || !db || typeof db.rpc !== 'function') fail(503, 'PERSISTENCIA_NO_DISPONIBLE');
      let result;
      try {
        let query = db.rpc('agy_mcp_phase1_authority', { operation: action, payload: args });
        if (signal && typeof query?.abortSignal === 'function') query = query.abortSignal(signal);
        result = await query;
      } catch { fail(503, 'PERSISTENCIA_NO_DISPONIBLE'); }
      if (result?.error || !result?.data || result.data.ok !== true) {
        const reason = result?.data?.reason;
        if (reason === 'invalid_grant') fail(400, 'invalid_grant');
        if (reason === 'denied') fail(403, 'AUTORIZACION_DENEGADA');
        if (reason === 'rate_limited') fail(429, 'LIMITE_EXCEDIDO');
        fail(503, 'PERSISTENCIA_NO_DISPONIBLE');
      }
      return result.data;
    },
    async identity(accessToken) {
      if (!auth?.auth || typeof auth.auth.getUser !== 'function' || typeof accessToken !== 'string') {
        fail(503, 'AUTORIDAD_NO_DISPONIBLE');
      }
      let result;
      try { result = await auth.auth.getUser(accessToken); }
      catch { fail(503, 'AUTORIDAD_NO_DISPONIBLE'); }
      if (result?.error || !result?.data?.user?.id) fail(401, 'OPERADOR_INVALIDO');
      return { id: result.data.user.id };
    },
  };
}
module.exports = { createSupabaseAuthority };