'use strict';

const assert = require('node:assert/strict');
const { createNotebookRouter, createRouterRepository, ROUTES } = require('./notebooklm-router.cjs');

function repository(route = 'cloud') {
  let sequence = 0;
  return {
    async getRoute() { return route; },
    async setRoute() { throw new Error('setRoute must not be called for rejected routes'); },
    async find() { return null; },
    async findResource() { return null; },
    async reserve({ executor }) {
      sequence += 1;
      return { job: {
        id: `nlmr_${String(sequence).padStart(32, '0')}`,
        executor, state: 'prepared', hubJobId: null
      }};
    },
    async claim() { return true; },
    async transition() { return true; }
  };
}
function upstreamResponse(status, payload = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    clone() { return { json: async () => payload }; },
    async text() { return JSON.stringify(payload); }
  };
}

async function main() {
  assert.deepStrictEqual([...ROUTES], ['cloud']);

  const legacyDocument = {
    version: 1, route: 'pc2',
    jobs: [{ id: 'legacy-job', executor: 'pc2' }],
    resources: [{ id: 'legacy-resource', executor: 'pc2' }],
    updatedAt: '2026-09-21T00:00:00.000Z'
  };
  let persistedDocument = structuredClone(legacyDocument);
  let casWrites = 0;
  const migrationStore = {
    configured: true,
    async get() { return structuredClone(persistedDocument); },
    async compareAndSet(previous, document) {
      assert.equal(previous.route, 'pc2');
      casWrites += 1;
      persistedDocument = structuredClone(document);
      return true;
    }
  };
  const migratedRepository = createRouterRepository(migrationStore);
  assert.equal(await migratedRepository.getRoute(), 'cloud');
  assert.equal(casWrites, 1);
  assert.equal(persistedDocument.route, 'cloud');
  assert.deepEqual(persistedDocument.jobs, legacyDocument.jobs);
  assert.deepEqual(persistedDocument.resources, legacyDocument.resources);
  const failingMigration = createNotebookRouter({
    repository: createRouterRepository({
      configured: true,
      async get() { return structuredClone(legacyDocument); },
      async compareAndSet() { throw new Error('CAS unavailable'); }
    })
  });
  const migrationFailure = await failingMigration.dispatch({
    method: 'GET', suffix: '/routing', query: {}, body: null
  });
  assert.equal(migrationFailure.status, 503);
  assert.equal(migrationFailure.data.code, 'ROUTER_MIGRATION_FAILED');

  let calls = 0;
  const router = createNotebookRouter({
    env: {
      NOTEBOOKLM_CLOUD_ENABLED: 'true',
      NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test',
      SGN_SECRET_TOKEN: 'test'
    },
    repository: repository('cloud'),
    resolvePc2Base() {
      throw new Error('PC2 fallback was contacted');
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error('cloud unavailable');
    }
  });

  const unavailable = await router.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.data.code, 'CLOUD_UNAVAILABLE');
  assert.equal(unavailable.route, 'cloud');
  assert.equal(calls, 1);

  const unsupported = await router.dispatch({
    method: 'POST', suffix: '/sources', query: {}, body: { title: 'not-supported' }
  });
  assert.equal(unsupported.status, 409);
  assert.equal(unsupported.data.code, 'CLOUD_OPERATION_UNSUPPORTED');
  assert.equal(calls, 1, 'unsupported operation must not contact any executor');

  const research = await router.dispatch({
    method: 'POST', suffix: '/jobs', query: {}, body: { action: 'notebook_research', topic: 'cloud-only' }
  });
  assert.equal(research.status, 502);
  assert.equal(research.data.code, 'ACCEPTANCE_UNKNOWN');
  assert.equal(research.route, 'cloud');
  assert.equal(calls, 2, 'research must use cloud and never fall back');

  const rejected = await router.dispatch({
    method: 'PUT', suffix: '/routing', query: {}, body: { route: 'pc2' }
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'ROUTE_INVALID');

  const autoRejected = await router.dispatch({
    method: 'PUT', suffix: '/routing', query: {}, body: { route: 'auto' }
  });
  assert.equal(autoRejected.status, 400);
  assert.equal(autoRejected.data.code, 'ROUTE_INVALID');

  const legacy = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'false' },
    repository: repository('pc2'),
    fetchImpl: async () => { throw new Error('must not contact any fallback'); }
  });
  const routing = await legacy.dispatch({ method: 'GET', suffix: '/routing', query: {}, body: null });
  assert.equal(routing.status, 200);
  assert.equal(routing.data.route, 'cloud');

  let pcCalls = 0;
  const pcJob = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'true', NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test' },
    repository: {
      ...repository(),
      async reserve() { return { existing: true, job: { executor: 'pc2', state: 'accepted' } }; },
      async find() { return { executor: 'pc2', state: 'accepted', hubJobId: 'pc-job' }; },
      async findResource() { return { kind: 'file', executor: 'pc2', upstreamId: 'pc-file' }; }
    },
    fetchImpl: async () => { pcCalls += 1; throw new Error('no PC route'); }
  });
  const retry = await pcJob.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', notebookId: 'nb', question: 'q', requestId: 'same' }
  });
  assert.equal(retry.status, 409);
  assert.equal(retry.data.code, 'CLOUD_ONLY_ROUTE_REQUIRED');
  const resource = await pcJob.dispatch({
    method: 'GET', suffix: '/files/nlmr_00000000000000000000000000000001', query: {}, body: null
  });
  assert.equal(resource.status, 409);
  assert.equal(resource.data.code, 'CLOUD_ONLY_ROUTE_REQUIRED');
  assert.equal(pcCalls, 0);

  let authCalls = 0;
  const authRouter = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'true', NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test' },
    repository: repository(),
    fetchImpl: async () => {
      authCalls += 1;
      return upstreamResponse(401, { code: 'SESSION_EXPIRED' });
    }
  });
  const auth = await authRouter.dispatch({ method: 'GET', suffix: '/notebooks', query: {}, body: null });
  assert.equal(auth.status, 401);
  assert.equal(auth.data.code, 'CLOUD_SESSION_EXPIRED');
  assert.equal(authCalls, 1);

  let serverCalls = 0;
  const serverRouter = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'true', NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test' },
    repository: repository(),
    fetchImpl: async () => { serverCalls += 1; return upstreamResponse(503, { error: 'busy' }); }
  });
  const serverError = await serverRouter.dispatch({ method: 'GET', suffix: '/sources', query: {}, body: null });
  assert.equal(serverError.response.status, 503);
  assert.equal(serverCalls, 1, '5xx must not trigger a fallback fetch');

  const conflictRouter = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'true', NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test' },
    repository: {
      ...repository(),
      async reserve() {
        return { conflict: true, job: { executor: 'cloud' } };
      }
    },
    fetchImpl: async () => { throw new Error('conflict must not send'); }
  });
  const conflict = await conflictRouter.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', requestId: 'conflicting' }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(conflict.route, 'cloud');

  let ackTransitions = 0;
  const ackRouter = createNotebookRouter({
    env: { NOTEBOOKLM_CLOUD_ENABLED: 'true', NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test' },
    repository: {
      ...repository(),
      async reserve({ executor }) {
        return { job: { id: 'nlmr_00000000000000000000000000000002', executor, state: 'prepared' } };
      },
      async transition() { ackTransitions += 1; return false; }
    },
    fetchImpl: async () => upstreamResponse(200, { id: 'cloud-job-1' })
  });
  const ack = await ackRouter.dispatch({
    method: 'POST', suffix: '/jobs', query: {},
    body: { action: 'notebook_ask', requestId: 'ack-test' }
  });
  assert.equal(ack.status, 503);
  assert.equal(ack.data.code, 'ACK_PERSIST_FAILED');
  assert.equal(ackTransitions, 2, 'failed acceptance persistence must not claim success');

  console.log('test-notebooklm-router-cloud-only: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});