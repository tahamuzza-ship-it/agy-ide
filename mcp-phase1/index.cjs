'use strict';
const { response, errorResponse, trustedIssuer } = require('./src/policy.cjs');

// Immutable release gate. No ENV switch, demo mode or fallback.
const RELEASE_APPROVED = false;
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
      try { return await engineFor().handle(request); }
      catch (error) { return errorResponse(error); }
    },
  });
}
module.exports = { createProvider, RELEASE_APPROVED };