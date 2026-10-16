'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mission, pc3Command, register, PREFIX } = require('../ai-local.cjs');
test('envelope survives in instruction and no tool authorization', () => {
  const m = mission('Texto ficticio');
  assert.equal(m.target, 'PC4');
  const e = JSON.parse(m.instruction.slice(PREFIX.length));
  assert.equal(e.type, 'inference'); assert.equal(e.text, 'Texto ficticio');
  assert.equal(e.model, 'qwen-sgn:latest'); assert.equal(e.tools, undefined);
});
test('PC3 encodes text as data, rejects oversized console requests', () => {
  const c = pc3Command('hola"; Remove-Item *');
  assert(!c.includes('Remove-Item'));
  assert(c.startsWith('powershell.exe -NoProfile -NonInteractive -EncodedCommand '));
  assert.throws(() => pc3Command('x'.repeat(12000)), /TOO_LONG/);
});
function response() {
  return { code: 200, set() { return this; }, status(n) { this.code = n; return this; },
    json(b) { this.body = b; return this; } };
}
test('connector creates, confirms and retrieves result without displaying credentials', async () => {
  const routes = new Map(), calls = [];
  const guard = () => {};
  register({ get: (p, ...h) => routes.set('GET ' + p, h),
    post: (p, ...h) => routes.set('POST ' + p, h) }, guard, {
    env: { YARBIS_CONSOLE_ACCESS_KEY: 'synthetic', PC4_INFERENCE_ENABLED: 'true' }, wait: async () => {},
    fetchImpl: async (url, opts) => {
      if (url.endsWith('/api/auth/login')) return {
        ok: true, headers: { getSetCookie: () => ['yarbis_console_session=synthetic; Secure'] },
      };
      if (url.endsWith('/api/inference/capabilities')) return {
        ok: true, text: async () => JSON.stringify({ protocol: PREFIX, reservationFilter: true }),
      };
      calls.push([url, opts.method]);
      const b = calls.length === 1 ? { id: '00000000-0000-4000-8000-000000000001' }
        : calls.length === 2 ? { status: 'running' } : { status: 'completed', result: 'Respuesta ficticia' };
      return { ok: true, text: async () => JSON.stringify(b) };
    },
  });
  assert.equal(routes.get('POST /api/local-ai/chat')[0], guard);
  assert.equal(routes.get('GET /api/local-ai/chat/:id')[0], guard);
  const res = response();
  routes.get('POST /api/local-ai/chat').at(-1)({ body: { node: 'PC4', text: 'Hola' } }, res);
  assert.equal(res.code, 202);
  await new Promise(resolve => setImmediate(resolve));
  const read = response();
  routes.get('GET /api/local-ai/chat/:id').at(-1)({
    params: { id: res.body.id }, headers: { 'x-inference-access': res.body.access },
  }, read);
  assert.equal(read.body.status, 'completed');
  assert.equal(read.body.text, 'Respuesta ficticia');
  const denied = response();
  routes.get('GET /api/local-ai/chat/:id').at(-1)({ params: { id: res.body.id }, headers: {} }, denied);
  assert.equal(denied.code, 404);
  assert.equal(calls.length, 3);
});
test('no credential means no dispatch', () => {
  const r = {};
  register({ get() {}, post(p, ...h) { r[p] = h.at(-1); } }, () => {}, {
    env: { PC4_INFERENCE_ENABLED: 'true' }, fetchImpl: () => { throw Error('network forbidden'); },
  });
  const res = response(); r['/api/local-ai/chat']({ body: { node: 'PC4', text: 'hola' } }, res);
  assert.equal(res.code, 503);
});
test('PC3 parses stdout without PowerShell diagnostic text', async () => {
  const routes = new Map();
  let calls = 0;
  register({ get: (p, ...h) => routes.set('GET ' + p, h.at(-1)),
    post: (p, ...h) => routes.set('POST ' + p, h.at(-1)) }, () => {}, {
    env: { AGY_IDE_PASSWORD: 'synthetic' }, wait: async () => {},
    fetchImpl: async () => {
      const body = ++calls === 1 ? { id: 'synthetic-command' }
        : { status: 'done', stdout: '{"ok":true,"text":"Respuesta ficticia"}',
          result: '{"ok":true,"text":"Respuesta ficticia"}\\n[stderr]\\n#< CLIXML' };
      return { ok: true, text: async () => JSON.stringify(body) };
    },
  });
  const res = response();
  routes.get('POST /api/local-ai/chat')({ body: { node: 'PC3', text: 'Hola' } }, res);
  await new Promise(resolve => setImmediate(resolve));
  const read = response();
  routes.get('GET /api/local-ai/chat/:id')({
    params: { id: res.body.id }, headers: { 'x-inference-access': res.body.access },
  }, read);
  assert.equal(read.body.status, 'completed');
  assert.equal(read.body.text, 'Respuesta ficticia');
});
