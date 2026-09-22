'use strict';

const assert = require('node:assert/strict');
const {
  ENDPOINT_PATH,
  REGISTRY_ID,
  REGISTRY_PROJECT,
  PC1_ENDPOINT_PATH,
  PC1_REGISTRY_ID,
  PC1_REGISTRY_PROJECT,
  createPc1SupabaseStore,
  registerPc1NotebookEndpointRoutes,
  rowFor,
  validatePayload,
  commitCandidate
} = require('./notebooklm-endpoint.cjs');

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function resCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function memoryStore(initial = null) {
  let value = initial;
  return {
    configured: true,
    async get() { return value && structuredClone(value); },
    async insert(next) { value = structuredClone(next); },
    async compareAndSet(previous, next) {
      if (!value || value.updatedAt !== previous.updatedAt
          || value.generation !== previous.generation) return false;
      value = structuredClone(next);
      return true;
    }
  };
}

async function main() {
  assert.notEqual(ENDPOINT_PATH, PC1_ENDPOINT_PATH);
  assert.notEqual(REGISTRY_ID, PC1_REGISTRY_ID);
  assert.notEqual(REGISTRY_PROJECT, PC1_REGISTRY_PROJECT);
  assert.equal(rowFor({
    endpoint: 'https://pc2.trycloudflare.com',
    generation: 1,
    updatedAt: new Date().toISOString()
  }).id, REGISTRY_ID);
  assert.equal(rowFor({
    endpoint: 'https://pc1.trycloudflare.com',
    generation: 1,
    updatedAt: new Date().toISOString()
  }, {
    id: PC1_REGISTRY_ID,
    project: PC1_REGISTRY_PROJECT,
    title: 'NotebookLM PC1 endpoint registry'
  }).project, PC1_REGISTRY_PROJECT);

  const isolatedCalls = [];
  const fakeClient = {
    from() {
      const chain = {
        select() { return chain; },
        eq(field, value) { isolatedCalls.push(['eq', field, value]); return chain; },
        maybeSingle: async () => ({ data: null }),
        insert: async () => ({ error: null }),
        update() { return chain; },
        filter() { return chain; }
      };
      return chain;
    }
  };
  const pc1Store = createPc1SupabaseStore({
    SUPABASE_URL_2: 'https://supabase.example.test',
    SUPABASE_KEY_2: 'key'
  }, { supabaseClient: fakeClient });
  await pc1Store.get();
  assert.ok(isolatedCalls.some(([, field, value]) => field === 'id' && value === PC1_REGISTRY_ID));
  assert.ok(isolatedCalls.some(([, field, value]) => field === 'project' && value === PC1_REGISTRY_PROJECT));
  assert.equal(isolatedCalls.some(([, field, value]) => value === REGISTRY_ID || value === REGISTRY_PROJECT), false);

  const current = {
    endpoint: 'https://pc1-old.trycloudflare.com',
    generation: 20,
    updatedAt: new Date().toISOString(),
    transportVersion: 1
  };
  const stale = await commitCandidate(memoryStore(current), {
    endpoint: 'https://pc1-stale.trycloudflare.com',
    generation: 19
  }, 'pc1-api', async () => response(200, { configured: true, authenticated: true }));
  assert.equal(stale.conflict, 'stale');
  const sameGeneration = await commitCandidate(memoryStore(current), {
    endpoint: 'https://pc1-other.trycloudflare.com',
    generation: 20
  }, 'pc1-api', async () => response(200, { configured: true, authenticated: true }));
  assert.equal(sameGeneration.conflict, 'generation');

  let healthCalls = 0;
  const failedStore = memoryStore();
  await assert.rejects(() => commitCandidate(failedStore, {
    endpoint: 'https://pc1-unhealthy.trycloudflare.com',
    generation: 30
  }, 'pc1-api', async (_url, options) => {
    healthCalls += 1;
    assert.equal(options.headers['X-SGN-Token'], 'pc1-api');
    return response(503, { configured: false });
  }));
  assert.equal(healthCalls, 1);
  assert.equal(await failedStore.get(), null, 'unhealthy endpoint must not commit');
  await assert.rejects(() => commitCandidate(memoryStore(), {
    endpoint: 'https://pc1-unauthenticated.trycloudflare.com',
    generation: 31
  }, 'pc1-api', async () => response(200, { configured: true, authenticated: false })));
  assert.deepEqual(validatePayload({
    endpoint: 'https://pc1-supervisor.trycloudflare.com',
    generation: 32
  }), {
    endpoint: 'https://pc1-supervisor.trycloudflare.com',
    generation: 32
  });
  assert.throws(() => validatePayload({
    endpoint: 'https://pc1-supervisor.trycloudflare.com',
    generation: '32'
  }));
  assert.throws(() => validatePayload({
    endpoint: 'https://pc1-supervisor.trycloudflare.com',
    generation: 33,
    state: 'registered'
  }));

  const handlers = [];
  const app = { use(path, handler) { handlers.push({ path, handler }); } };
  const registrationStore = memoryStore();
  let healthToken;
  registerPc1NotebookEndpointRoutes(app, {
    env: {
      NOTEBOOKLM_PC1_REGISTRY_TOKEN: 'pc1-registry',
      NOTEBOOKLM_PC1_TOKEN: 'pc1-api'
    },
    store: registrationStore,
    fetchImpl: async (_url, options) => {
      healthToken = options.headers['X-SGN-Token'];
      return response(200, { configured: true, authenticated: true });
    }
  });
  assert.equal(handlers[0].path, PC1_ENDPOINT_PATH);
  const wrong = resCapture();
  await handlers[0].handler({
    path: '/',
    method: 'POST',
    headers: { 'x-sgn-token': 'pc1-api' },
    body: { endpoint: 'https://pc1-new.trycloudflare.com', generation: 40 }
  }, wrong);
  assert.equal(wrong.statusCode, 401);
  const accepted = resCapture();
  await handlers[0].handler({
    path: '/',
    method: 'POST',
    headers: { 'x-sgn-token': 'pc1-registry' },
    body: { endpoint: 'https://pc1-new.trycloudflare.com', generation: 40 }
  }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(healthToken, 'pc1-api', 'registry and API tokens must remain separate');
  assert.equal(JSON.stringify(accepted.body).includes('pc1-registry'), false);

  console.log('test-notebooklm-endpoint: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});