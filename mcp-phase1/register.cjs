'use strict';
const { createProvider, RELEASE_APPROVED } = require('./index.cjs');
const { PATHS } = require('./src/policy.cjs');
const { createOperatorBinding } = require('./operator-binding.cjs');

// No engine, fixture, SDK client or native Mark 51 component is instantiated.
// Locked requests are answered without parsing/logging their potentially secret body.
function registerProviderReview(app, { getOperatorAuthority, getIssuer = () => null } = {}) {
  const provider = createProvider({
    operatorBinding: createOperatorBinding({ getOperatorAuthority }),
    getAuthority: () => getOperatorAuthority?.()?.getNativeMcpAuthority?.() ?? null,
    getIssuer,
  });
  // The original bounded HTTP adapter is loaded only in a separately approved
  // build. The OFF handler does not parse a body or inspect credentials.
  const nativeHandler = RELEASE_APPROVED
    ? require('./src/http-adapter.cjs').nodeHandler(provider) : null;
  const reply = async (_req, res) => {
    if (nativeHandler) return nativeHandler(_req, res);
    const output = await provider.handle();
    res.status(output.status).set(output.headers).json(output.body);
  };
  for (const route of Object.values(PATHS)) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    app.all(new RegExp('^' + escaped + '$'), reply);
  }
  app.all(/^\/api\/agy\/link\/approve\/[A-Za-z0-9_-]{43}$/, reply);
  return provider;
}
module.exports = { registerProviderReview };