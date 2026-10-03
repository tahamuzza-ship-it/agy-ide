'use strict';
const { response, errorResponse, trustedIssuer } = require('./src/policy.cjs');

// Immutable release gate. No ENV switch, demo mode or fallback.
// Approved for the two existing read-only tools; authority, client and
// operator permissions are still enforced independently by the engine/RPC.
const RELEASE_APPROVED = true;
function createProvider({ operatorBinding, getAuthority = () => null, getIssuer = () => null } = {}) {
  if (typeof getAuthority !== 'function' || typeof getIssuer !== 'function') {
    throw new Error('AUTHORITY_GETTER_REQUIRED');
  }
  let current;
  function engineFor() {
    const authority = getAuthority();
    const issuer = getIssuer();
    trustedIssuer(issuer);
    if (!authority || typeof authority.call !== 'function' ||
        typeof authority.identity !== 'function' || !operatorBinding?.resolverFor) {
      throw new Error('AUTHORITY_NOT_READY');
    }
    if (!current || current.authority !== authority || current.issuer !== issuer) {
      const { createEngine } = require('./src/engine.cjs');
      current = { authority, issuer, engine: createEngine({
        authority, issuer, resolveOperator: operatorBinding.resolverFor({ authority, issuer }),
      }) };
    }
    return current.engine;
  }
  return Object.freeze({
    enabled: RELEASE_APPROVED,
    // Trusted server-side composition dependency; never returned by handle().
    operatorBinding,
    // Independent native release gate: a future operator activation alone
    // cannot reach persistence. No getter is evaluated while this gate is OFF.
    authorityFor() { return RELEASE_APPROVED ? getAuthority() : null; },
    async handle(request) {
      if (!RELEASE_APPROVED) return response(503, { error: 'PROVEEDOR_DESACTIVADO' });
      try {
        const output = await engineFor().handle(request);
        // A human without an individual session gets the actual login page,
        // not an unexplained JSON rejection. Never redirect POSTs or wrong hosts.
        const issuer = getIssuer();
        if (request?.method === 'GET'
            && /^\/api\/agy\/link\/approve\/[A-Za-z0-9_-]{43}$/.test(request.path)
            && request.headers?.host === new URL(issuer).host
            && (!request.headers.origin || request.headers.origin === issuer)
            && [401, 403].includes(output.status)) {
          return response(302, '', {
            location: '/api/agy/operator/access?next=' + encodeURIComponent(request.path),
            'referrer-policy': 'no-referrer',
          });
        }
        return output;
      }
      catch (error) { return errorResponse(error); }
    },
  });
}
module.exports = { createProvider, RELEASE_APPROVED };