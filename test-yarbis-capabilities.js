'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const {
  capabilitiesResult,
  createYarbisReadClient,
} = require('./yarbis-read-client.cjs');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://yarbis-autonomous-control-production.up.railway.app/api/agent-capabilities',
    text: async () => JSON.stringify(payload),
  };
}

function knownCapabilities() {
  const readIds = [
    'capabilities.read', 'release.read', 'memory.status', 'memory.search', 'memory.get',
    'mailbox.read', 'pc1.sync.read', 'notebooklm.list', 'notebooklm.search',
    'notebooklm.sources', 'notebooklm.job-status', 'mission.status',
  ];
  return [
    ...readIds.map((id) => ({ id, mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false })),
    { id: 'notebooklm.ask', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: true },
    { id: 'notebooklm.research', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: true },
    { id: 'mission.draft', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: false },
    { id: 'mission.confirm', mode: 'action', enabled: true, requiresConfirmation: true, evidenceRequired: true },
  ];
}

function knownManifest(overrides = {}) {
  return {
    schemaVersion: '1',
    policyVersion: '1',
    client: 'AGY-IDE',
    yarbisVersion: 'test-version',
    capabilities: knownCapabilities(),
    ...overrides,
  };
}

async function testReadClientFixedRouteAndAuth() {
  const calls = [];
  const client = createYarbisReadClient({
    env: {
      YARBIS_READ_BASE_URL: 'https://yarbis-autonomous-control-production.up.railway.app',
      YARBIS_READ_TOKEN: 'test-read-token',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(knownManifest());
    },
  });
  const result = await client.yarbis_capabilities();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.synchronized, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://yarbis-autonomous-control-production.up.railway.app/api/agent-capabilities');
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer test-read-token');
  assert.strictEqual(calls[0].options.headers['X-Yarbis-Node-Id'], 'AGY-IDE');
  assert.strictEqual(calls[0].options.headers['X-Yarbis-Client-Id'], 'AGY-IDE');
}

async function testInvalidAndDuplicateManifestRejected() {
  const base = knownManifest();
  assert.throws(
    () => capabilitiesResult({ ...base, capabilities: [...base.capabilities, ...base.capabilities] }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({ ...base, extra: true }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({ ...base, schemaVersion: 1 }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({ ...base, policyVersion: 1 }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({
      ...base,
      capabilities: knownCapabilities().map((entry) => entry.id === 'notebooklm.ask'
        ? { ...entry, evidenceRequired: false }
        : entry),
    }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({
      ...base,
      capabilities: knownCapabilities().filter((entry) => entry.id !== 'mission.status'),
    }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({
      ...base,
      capabilities: knownCapabilities().map((entry) => entry.id === 'mission.confirm'
        ? { ...entry, requiresConfirmation: false }
        : entry),
    }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
  assert.throws(
    () => capabilitiesResult({
      ...base,
      capabilities: [...knownCapabilities(), { id: 'https://evil.example/run', mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false }],
    }, 'token'),
    (error) => error.code === 'YARBIS_READ_INVALID_RESPONSE',
  );
}

function loadRuntimeHelpers() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'ws') {
      return {
        WebSocket: { OPEN: 1, CLOSING: 2, CONNECTING: 0 },
        WebSocketServer: class {},
      };
    }
    if (request === './notebooklm-client.cjs') {
      return {
        createNotebookClient: () => ({}),
        createJobPoller: () => ({ close() {}, watch() {} }),
        deriveResearchRequestId: () => 'test',
        publicFailure: () => ({ ok: false }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('./yarbis-runtime.source.js');
  } finally {
    Module._load = originalLoad;
  }
}

function testUnknownCapabilityNeverBecomesTool() {
  const { localToolsForCapabilities, capabilityStateText } = loadRuntimeHelpers();
  const result = localToolsForCapabilities({
    status: 'synchronized',
    capabilities: [
      { id: 'memory.search', mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false },
      { id: 'memory.status', mode: 'read', enabled: true, requiresConfirmation: true, evidenceRequired: false },
      { id: 'unknown.remote.execute', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: false },
      { id: 'notebooklm.list', mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false },
      { id: 'notebooklm.search', mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false },
      { id: 'notebooklm.sources', mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false },
    ],
  });
  assert.deepStrictEqual(result.activeIds, [
    'memory.search',
    'notebooklm.list',
    'notebooklm.search',
    'notebooklm.sources',
  ]);
  assert.ok(!result.names.has('unknown.remote.execute'));
  assert.ok(result.names.has('notebooklm_list_notebooks'));
  assert.ok(result.names.has('notebooklm_search_notebooks'));
  assert.ok(result.names.has('notebooklm_list_sources'));
  assert.ok(!result.names.has('notebooklm_ask'));
  assert.match(capabilityStateText({ status: 'unavailable' }), /no disponible/i);
}

function testExactCrossContractManifest() {
  const readIds = [
    'capabilities.read', 'release.read', 'memory.status', 'memory.search', 'memory.get',
    'mailbox.read', 'pc1.sync.read', 'notebooklm.list', 'notebooklm.search',
    'notebooklm.sources', 'notebooklm.job-status', 'mission.status',
  ];
  const actionIds = ['notebooklm.ask', 'notebooklm.research', 'mission.draft', 'mission.confirm'];
  const manifest = {
    schemaVersion: '1',
    policyVersion: '1',
    client: 'AGY-IDE',
    yarbisVersion: 'test-version',
    capabilities: [
      ...readIds.map((id) => ({ id, mode: 'read', enabled: true, requiresConfirmation: false, evidenceRequired: false })),
      { id: 'notebooklm.ask', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: true },
      { id: 'notebooklm.research', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: true },
      { id: 'mission.draft', mode: 'action', enabled: true, requiresConfirmation: false, evidenceRequired: false },
      { id: 'mission.confirm', mode: 'action', enabled: true, requiresConfirmation: true, evidenceRequired: true },
    ],
  };
  const result = capabilitiesResult(manifest, 'token');
  assert.strictEqual(result.capabilities.length, 16);
  assert.deepStrictEqual(result.capabilities.map((entry) => entry.id), [...readIds, ...actionIds]);
}

function testValidatedResultActivatesAllKnownCapabilities() {
  const { localToolsForCapabilities } = loadRuntimeHelpers();
  const validated = capabilitiesResult(knownManifest(), 'token');
  const active = localToolsForCapabilities(validated);
  assert.strictEqual(validated.synchronized, true);
  assert.deepStrictEqual([...active.activeIds].sort(), validated.capabilities.map((entry) => entry.id).sort());
  assert.strictEqual(active.activeIds.length, 16);
  const changed = {
    ...validated,
    capabilities: validated.capabilities.map((entry) => entry.id === 'mission.confirm'
      ? { ...entry, requiresConfirmation: false }
      : entry),
  };
  const safelyGated = localToolsForCapabilities(changed);
  assert.ok(!safelyGated.activeIds.includes('mission.confirm'));
  assert.strictEqual(safelyGated.activeIds.length, 15);
}

function testMissionUiGates() {
  const ui = fs.readFileSync('./public/yarbis.js', 'utf8');
  for (const id of ['mission.draft', 'mission.confirm', 'mission.status']) {
    assert.ok(ui.includes(`requireCapability('${id}'`), `missing UI gate for ${id}`);
  }
  assert.ok(ui.includes('No se creará ningún borrador.'));
  assert.ok(ui.includes('La misión no fue enviada.'));
}

async function testUnavailableState() {
  const client = createYarbisReadClient({
    env: {
      YARBIS_READ_BASE_URL: 'https://yarbis-autonomous-control-production.up.railway.app',
      YARBIS_READ_TOKEN: 'test-read-token',
    },
    fetchImpl: async () => response({ error: 'offline' }, 503),
  });
  await assert.rejects(
    () => client.yarbis_capabilities(),
    (error) => error.code === 'YARBIS_READ_HTTP',
  );
}

Promise.resolve()
  .then(testReadClientFixedRouteAndAuth)
  .then(testInvalidAndDuplicateManifestRejected)
  .then(testExactCrossContractManifest)
  .then(testValidatedResultActivatesAllKnownCapabilities)
  .then(testMissionUiGates)
  .then(testUnknownCapabilityNeverBecomesTool)
  .then(testUnavailableState)
  .then(() => console.log('test-yarbis-capabilities: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });