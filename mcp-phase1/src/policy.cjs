'use strict';
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const CALLBACK = 'http://127.0.0.1:48173/agy/oauth/callback';
const VERSION = '2025-06-18';
const SCOPES = Object.freeze(['agy.capabilities.read', 'agy.help.read']);
const PATHS = Object.freeze({
  mcp: '/api/mcp/agy',
  link: '/api/agy/link/requests',
  approve: '/api/agy/link/approve',
  token: '/api/agy/link/token',
  revoke: '/api/agy/link/revoke',
});
const LIMITS = Object.freeze({
  requestBytes: 8192, responseBytes: 16384, deadlineMs: 10000,
  perActorPerMinute: 30, perClientPerMinute: 120, concurrentPerActor: 2,
  linkSeconds: 300, codeSeconds: 60, grantSeconds: 900, idleSeconds: 300,
});
class Denied extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new Denied(status, code); }
const hash = value => createHash('sha256').update(value).digest('hex');
const challenge = value => createHash('sha256').update(value).digest('base64url');
const secret = () => randomBytes(32).toString('base64url');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function exact(value, required, optional = []) {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail(400, 'ARGUMENTOS_INVALIDOS');
}
function text(value, min = 1, max = 128) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(400, 'ARGUMENTOS_INVALIDOS');
  return value;
}
function opaque(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(401, 'AUTORIZACION_INVALIDA');
  return value;
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const SAFE_HEADERS = Object.freeze({
  'cache-control': 'no-store', 'pragma': 'no-cache',
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
});
function response(status, body, extra = {}) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  if (Buffer.byteLength(serialized) > LIMITS.responseBytes) fail(503, 'RESPUESTA_EXCESIVA');
  return { status, headers: { ...SAFE_HEADERS, 'content-type': 'application/json', ...extra }, body };
}
function errorResponse(error) {
  return response(error instanceof Denied ? error.status : 503, {
    error: error instanceof Denied ? error.code : 'AUTORIDAD_NO_DISPONIBLE',
  });
}
function trustedIssuer(issuer) {
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:' || parsed.origin !== issuer) throw Error();
    return parsed;
  } catch { fail(503, 'ISSUER_NO_CONFIGURADO'); }
}
module.exports = { CALLBACK, VERSION, SCOPES, PATHS, LIMITS, Denied, fail, hash, challenge, secret,
  object, exact, text, opaque, same, escapeHtml, response, errorResponse, trustedIssuer };