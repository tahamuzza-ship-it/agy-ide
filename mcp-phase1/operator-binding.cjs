'use strict';
const { PATHS, SCOPES, CALLBACK, opaque, fail, trustedIssuer } = require('./src/policy.cjs');

// Lazy host dependency. Never reads environment/keys or creates a DB/auth client.
// Persistence is still the provider's separately verified authority, NOT this bridge.
function createOperatorBinding({ getOperatorAuthority = () => null } = {}) {
  if (typeof getOperatorAuthority !== 'function') throw Error('OPERATOR_GETTER_REQUIRED');
  return Object.freeze({
    resolverFor({ authority, issuer } = {}) {
      trustedIssuer(issuer);
      return async req => {
        const canonical = getOperatorAuthority();
        if (!canonical || typeof canonical.ready !== 'function' || !canonical.ready() ||
            typeof canonical.resolveNativeMcpOperator !== 'function') {
          fail(503, 'OPERADOR_AUTORIDAD_NO_CONFIGURADA');
        }
        async function authenticate() {
          let session;
          try { session = await canonical.resolveNativeMcpOperator(req); }
          catch (error) {
            if ([400, 401, 403, 429, 503].includes(error?.status) &&
                /^OPERADOR_[A-Z_]+$/.test(error?.code || '')) fail(error.status, error.code);
            fail(503, 'OPERADOR_AUTORIDAD_NO_CONFIGURADA');
          }
          if (session?.audience !== 'agy-ide' || session.issuer !== issuer ||
              !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() ||
              !Array.isArray(session.scopes) || !session.scopes.length ||
              session.scopes.some(scope => !SCOPES.includes(scope))) fail(403, 'OPERADOR_NO_VERIFICADO');
          return session;
        }
        let session = await authenticate();
        const id = req.method === 'GET'
          ? req.path?.slice((PATHS.approve + '/').length) : req.body?.request_id;
        opaque(id);
        if (!authority || typeof authority.call !== 'function') fail(503, 'PERSISTENCIA_NO_DISPONIBLE');
        // The reference engine does not consume session.scopes. Enforce the
        // exact requested subset here; never turn legacy privileges into native grants.
        const link = await authority.call('link_read', {
          request_id: id, operator_id: session.operatorId, issuer, resource: issuer + PATHS.mcp,
        }, AbortSignal.timeout(8000));
        if (!link || link.request_id !== id || link.status !== 'pending' || link.issuer !== issuer ||
            link.resource !== issuer + PATHS.mcp || link.callback_uri !== CALLBACK ||
            !Number.isFinite(link.expires_at) || link.expires_at <= Date.now() ||
            !Array.isArray(link.requested_scopes) || !link.requested_scopes.length ||
            new Set(link.requested_scopes).size !== link.requested_scopes.length ||
            link.requested_scopes.some(s => !SCOPES.includes(s) || !session.scopes.includes(s))) {
          fail(403, 'PERMISO_NO_ADMITIDO');
        }
        if (req.method === 'POST') {
          // Permission may have been revoked while reading the pending link.
          // Recheck before returning a verified identity for code issuance.
          const latest = await authenticate();
          if (latest.operatorId !== session.operatorId || latest.sessionId !== session.sessionId ||
              latest.accessToken !== session.accessToken || latest.csrfToken !== session.csrfToken ||
              link.requested_scopes.some(s => !latest.scopes.includes(s))) fail(403, 'PERMISO_NO_ADMITIDO');
          session = latest;
        }
        // Only the private shape expected by the unchanged provider engine.
        return {
          sessionId: session.sessionId, accessToken: session.accessToken,
          csrfToken: session.csrfToken, csrfVerified: session.csrfVerified,
        };
      };
    },
  });
}
module.exports = { createOperatorBinding };