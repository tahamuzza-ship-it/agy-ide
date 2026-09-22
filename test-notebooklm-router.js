'use strict';

const assert = require('node:assert/strict');
const {
  ROUTES,
  createNotebookRouter,
  createRouterRepository
} = require('./notebooklm-router.cjs');
const { createNotebookClient } = require('./notebooklm-client.cjs');

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeRepository(route = 'pc2') {
  let document = { version: 1, route, jobs: [], resources: [], updatedAt: new Date().toISOString() };
  return {
    async getRoute() { return document.route; },
    async setRoute(next) { document.route = next; return next; },
    async reserve({ idempotencyKey, hash, executor, operation }) {
      const existing = document.jobs.find((job) => job.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.hash !== hash || existing.operation !== operation) return { conflict: true, job: existing };
        return { existing: true, job: existing };
      }
      const job = {
        id: `nlmr_${String(document.jobs.length + 1).padStart(32, '0')}`,
        actor: 'notebooklm-router-admin-v1', idempotencyKey, hash, executor, operation,
        state: 'prepared', hubJobId: null
      };
      document.jobs.push(job);
      return { job };
    },
    async claim(id) {
      const job = document.jobs.find((item) => item.id === id);
      if (!job || job.state !== 'prepared') return null;
      job.state = 'sending';
      return { ...job };
    },
    async transition(id, from, state, extra = {}) {
      const job = document.jobs.find((item) => item.id === id);
      if (!job || !from.includes(job.state)) return false;
      Object.assign(job, extra, { state });
      return true;
    },
    async find(id) { return document.jobs.find((job) => job.id === id) || null; },
    async findResource() { return null; },
    async mapResource() { throw new Error('not used'); }
  };
}

function router(repository, fetchImpl, resolvePc2Base = async () => 'https://pc2.example.test', extraEnv = {}) {
  return createNotebookRouter({
    env: {
      NOTEBOOKLM_CLOUD_ENABLED: 'true',
      NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test',
      SGN_SECRET_TOKEN: 'test',
      NOTEBOOKLM_PC1_URL: 'https://pc1.example.test',
      NOTEBOOKLM_PC1_TOKEN: 'pc1-test',
      ...extraEnv
    },
    repository,
    fetchImpl,
    resolvePc2Base
  });
}

async function main() {
  assert.deepEqual([...ROUTES].sort(), ['auto', 'cloud', 'pc1', 'pc2']);
  const defaultRepository = createRouterRepository({
    configured: true,
    async get() { return null; },
    async insert() {},
    async compareAndSet() { return true; }
  });
  assert.equal(await defaultRepository.getRoute(), 'auto');

  const existing = makeRepository('pc2');
  const existingRouter = router(existing, async () => response(200, { configured: true, authenticated: true }));
  const before = await existing.getRoute();
  await existingRouter.dispatch({ method: 'GET', suffix: '/routing', query: {}, body: null });
  assert.equal(await existing.getRoute(), before, 'existing pc2 route must not be migrated');

  let cloudCalls = 0;
  const cloudRouter = router(makeRepository('cloud'), async (url) => {
    cloudCalls += 1;
    assert.match(String(url), /^https:\/\/cloud\.example\.test\//);
    return response(200, { notebooks: [] });
  });
  const cloudRead = await cloudRouter.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(cloudRead.response.status, 200);
  assert.equal(cloudRead.route, 'cloud');
  assert.equal(cloudCalls, 1);

  const autoCalls = [];
  const autoRouter = router(makeRepository('auto'), async (url) => {
    autoCalls.push(String(url));
    if (String(url).startsWith('https://pc2.example.test')) return response(503, { error: 'offline' });
    if (String(url).startsWith('https://pc1.example.test')) return response(401, { code: 'SESSION_REQUIRED' });
    return response(200, { notebooks: ['cloud-result'] });
  });
  const autoRead = await autoRouter.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(autoRead.response.status, 200);
  assert.equal(autoRead.route, 'cloud');
  assert.deepEqual(autoCalls, [
    'https://pc2.example.test/api/notebooklm/notebooks',
    'https://pc1.example.test/api/notebooklm/notebooks',
    'https://cloud.example.test/api/notebooklm/notebooks'
  ]);

  const ordinaryErrorCalls = [];
  const ordinaryErrorRouter = router(makeRepository('auto'), async (url) => {
    ordinaryErrorCalls.push(String(url));
    return response(404, { error: 'not found' });
  });
  const ordinaryError = await ordinaryErrorRouter.dispatch({
    method: 'GET', suffix: '/notebooks', query: {}, body: null
  });
  assert.equal(ordinaryError.response.status, 404);
  assert.equal(ordinaryError.route, 'pc2');
  assert.deepEqual(ordinaryErrorCalls, ['https://pc2.example.test/api/notebooklm/notebooks']);

  let explicitPc2Url = '';
  const pc2Router = router(makeRepository('pc2'), async (url) => {
    explicitPc2Url = String(url);
    return response(200, { notebooks: [] });
  });
  const pc2Read = await pc2Router.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(pc2Read.response.status, 200);
  assert.match(explicitPc2Url, /^https:\/\/pc2\.example\.test\//);

  let explicitPc1Url = '';
  const pc1Router = router(makeRepository('pc1'), async (url) => {
    explicitPc1Url = String(url);
    return response(200, { notebooks: [] });
  });
  const pc1Read = await pc1Router.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(pc1Read.response.status, 200);
  assert.match(explicitPc1Url, /^https:\/\/pc1\.example\.test\//);

  const priorityCalls = [];
  const priorityRouter = router(makeRepository('auto'), async (url, options) => {
    const target = String(url);
    priorityCalls.push(target);
    if (target.startsWith('https://pc2.example.test')) return response(503, { error: 'offline' });
    if (target.startsWith('https://pc1.example.test') && options.method === 'GET') {
      return response(200, { configured: true, authenticated: true });
    }
    if (target.startsWith('https://pc1.example.test')) return response(202, { id: 'pc1-job' });
    return response(503, { error: 'cloud should not be reached' });
  });
  const priorityJob = await priorityRouter.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', notebookId: 'nb', question: 'q', requestId: 'priority-1' }
  });
  assert.equal(priorityJob.status, 202);
  assert.equal(priorityJob.route, 'pc1');
  assert.deepEqual(priorityCalls, [
    'https://pc2.example.test/api/notebooklm/status',
    'https://pc1.example.test/api/notebooklm/status',
    'https://pc1.example.test/api/notebooklm/jobs'
  ]);

  let mutationCalls = 0;
  const mutationRouter = router(makeRepository('auto'), async (url, options) => {
    mutationCalls += 1;
    if (options.method === 'GET') return response(200, { configured: true, authenticated: true });
    assert.match(String(url), /^https:\/\/pc2\.example.test\//);
    return response(503, { error: 'busy' });
  });
  const mutation = await mutationRouter.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', requestId: 'ambiguous-1', question: 'q' }
  });
  assert.equal(mutation.status, 502);
  assert.equal(mutation.data.code, 'ACCEPTANCE_UNKNOWN');
  assert.equal(mutationCalls, 2, 'unsafe mutation ambiguity must never fall back');

  const missingRequestId = await mutationRouter.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', notebookId: 'nb', question: 'q' }
  });
  assert.equal(missingRequestId.status, 400);
  assert.equal(missingRequestId.data.code, 'REQUEST_ID_REQUIRED');

  const invalidPc1 = router(makeRepository('pc1'), async () => {
    throw new Error('invalid PC1 must not be contacted');
  }, async () => 'https://pc2.example.test', {
    NOTEBOOKLM_PC1_URL: 'http://pc1.example.test',
    NOTEBOOKLM_PC1_TOKEN: ''
  });
  const invalid = await invalidPc1.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.data.code, 'ROUTE_UNAVAILABLE');

  const noPc1Calls = [];
  const noPc1Router = router(makeRepository('auto'), async (url, options) => {
    noPc1Calls.push({ url: String(url), token: options.headers['X-SGN-Token'] });
    return response(200, { notebooks: [] });
  }, async () => { throw new Error('pc2 unavailable'); }, {
    NOTEBOOKLM_PC1_TOKEN: ''
  });
  const noPc1 = await noPc1Router.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(noPc1.route, 'cloud');
  assert.deepEqual(noPc1Calls, [{ url: 'https://cloud.example.test/api/notebooklm/notebooks', token: 'test' }],
    'missing PC1 token must skip PC1 entirely');

  const noSharedCalls = [];
  const noSharedRouter = router(makeRepository('auto'), async (url, options) => {
    noSharedCalls.push({ url: String(url), token: options.headers['X-SGN-Token'] });
    return response(200, { notebooks: [] });
  }, async () => { throw new Error('PC2 must not be contacted without shared token'); }, {
    SGN_SECRET_TOKEN: '',
    CONEXION_NOTEBOOK_PUENTE: ''
  });
  const noShared = await noSharedRouter.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(noShared.route, 'pc1');
  assert.deepEqual(noSharedCalls, [{ url: 'https://pc1.example.test/api/notebooklm/notebooks', token: 'pc1-test' }],
    'missing shared token must skip PC2 and cloud');

  const integrationRouter = router(makeRepository('cloud'), async (url, options) => {
    upstreamPosts += 1;
    assert.match(String(url), /^https:\/\/cloud\.example\.test\/api\/notebooklm\/jobs$/);
    assert.equal(options.method, 'POST');
    return response(503, { error: 'upstream timeout' });
  });
  let gatewayAttempts = 0;
  let upstreamPosts = 0;
  const client = createNotebookClient({
    port: 3000,
    password: 'test',
    timeoutSignal: () => undefined,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      gatewayAttempts += 1;
      const routed = await integrationRouter.dispatch({
        method: 'POST', suffix: '/jobs', query: {}, body
      });
      return response(routed.local ? routed.status : routed.response.status, routed.local ? routed.data : {});
    }
  });
  let firstError;
  try {
    await client.ask('nb', 'question');
  } catch (error) {
    firstError = error;
  }
  assert.ok(firstError && firstError.requestId);
  await assert.rejects(() => client.ask('nb', 'question', firstError.requestId));
  assert.equal(gatewayAttempts, 2);
  assert.equal(upstreamPosts, 1, 'retry of acceptance_unknown must not POST upstream again');

  console.log('test-notebooklm-router: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});