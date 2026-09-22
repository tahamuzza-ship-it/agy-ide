'use strict';

const assert = require('node:assert/strict');
const { registerNotebookRoutes } = require('./notebooklm-proxy.cjs');

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function repository(route = 'auto') {
  let current = route;
  return {
    async getRoute() { return current; },
    async setRoute(next) { current = next; return next; },
    async reserve() { throw new Error('not used'); },
    async claim() { return null; },
    async transition() { return false; },
    async find() { return null; },
    async findResource() { return null; },
    async mapResource() { throw new Error('not used'); }
  };
}

function store(record) {
  return {
    configured: true,
    async get() { return record; }
  };
}

function captureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

async function invoke({ pc1Record, staticPc1, fetchImpl }) {
  const mounts = [];
  const app = { use(path, ...handlers) { mounts.push({ path, handlers }); } };
  registerNotebookRoutes(app, () => {}, {
    env: {
      HUB_ENDPOINT_URL: 'https://pc2-static.example.test',
      SGN_SECRET_TOKEN: 'shared-token',
      NOTEBOOKLM_PC1_URL: staticPc1 || '',
      NOTEBOOKLM_PC1_TOKEN: 'pc1-api'
    },
    store: store(null),
    pc1Store: store(pc1Record),
    repository: repository('auto'),
    fetchImpl
  });
  const proxy = mounts.find((mount) => mount.path === '/api/notebooklm').handlers.at(-1);
  const res = captureResponse();
  await proxy({ method: 'GET', path: '/notebooks', query: {}, body: null }, res);
  return { mounts, res };
}

async function main() {
  const dynamicCalls = [];
  const dynamic = await invoke({
    pc1Record: {
      endpoint: 'https://pc1-dynamic.trycloudflare.com',
      generation: 100,
      updatedAt: new Date().toISOString(),
      transportVersion: 1
    },
    staticPc1: 'https://pc1-static.example.test',
    fetchImpl: async (url) => {
      dynamicCalls.push(String(url));
      if (String(url).startsWith('https://pc2-static')) return response(503, { error: 'offline' });
      return response(200, String(url).endsWith('/status')
        ? { configured: true, authenticated: true }
        : { notebooks: ['pc1'] });
    }
  });
  assert.equal(dynamic.res.statusCode, 200);
  assert.equal(dynamic.res.headers['X-NotebookLM-Route'], 'pc1');
  assert.equal(dynamicCalls.some((url) => url.includes('pc1-static')), false);
  assert.ok(dynamicCalls.some((url) => url.startsWith('https://pc1-dynamic.trycloudflare.com')));
  assert.equal(dynamicCalls.some((url) => url.includes('/api/misiones')), false);
  assert.deepEqual(dynamic.mounts.slice(0, 2).map((mount) => mount.path), [
    '/api/notebooklm/endpoint',
    '/api/notebooklm/pc1-endpoint'
  ]);

  const staticCalls = [];
  const fallback = await invoke({
    pc1Record: null,
    staticPc1: 'https://pc1-static.example.test',
    fetchImpl: async (url) => {
      staticCalls.push(String(url));
      if (String(url).startsWith('https://pc2-static')) return response(503, { error: 'offline' });
      return response(200, String(url).endsWith('/status')
        ? { configured: true, authenticated: true }
        : { notebooks: ['static'] });
    }
  });
  assert.equal(fallback.res.statusCode, 200);
  assert.equal(fallback.res.headers['X-NotebookLM-Route'], 'pc1');
  assert.ok(staticCalls.some((url) => url.startsWith('https://pc1-static.example.test')));

  const invalidRegistryCalls = [];
  const invalidRegistry = await invoke({
    pc1Record: {
      endpoint: 'http://not-trycloudflare.example.test',
      generation: 102,
      updatedAt: new Date().toISOString(),
      transportVersion: 1
    },
    staticPc1: 'https://pc1-static.example.test',
    fetchImpl: async (url) => {
      invalidRegistryCalls.push(String(url));
      if (String(url).startsWith('https://pc2-static')) return response(503, { error: 'offline' });
      return response(200, String(url).endsWith('/status')
        ? { configured: true, authenticated: true }
        : { notebooks: ['static-after-invalid-registry'] });
    }
  });
  assert.equal(invalidRegistry.res.statusCode, 200);
  assert.equal(invalidRegistry.res.headers['X-NotebookLM-Route'], 'pc1');
  assert.ok(invalidRegistryCalls.some((url) => url.startsWith('https://pc1-static.example.test')));

  const pc2WinsCalls = [];
  const pc2Wins = await invoke({
    pc1Record: {
      endpoint: 'https://pc1-dynamic.trycloudflare.com',
      generation: 101,
      updatedAt: new Date().toISOString(),
      transportVersion: 1
    },
    staticPc1: 'https://pc1-static.example.test',
    fetchImpl: async (url) => {
      pc2WinsCalls.push(String(url));
      if (String(url).startsWith('https://pc2-static')) {
        return response(200, String(url).endsWith('/status')
          ? { configured: true, authenticated: true }
          : { notebooks: ['pc2'] });
      }
      throw new Error('PC1 must not be contacted when PC2 is ready');
    }
  });
  assert.equal(pc2Wins.res.statusCode, 200);
  assert.equal(pc2Wins.res.headers['X-NotebookLM-Route'], 'pc2');
  assert.equal(pc2WinsCalls.some((url) => url.includes('pc1-dynamic')), false);

  console.log('test-notebooklm-proxy: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});