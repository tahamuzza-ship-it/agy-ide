'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  COOKIE,
  createNotebookCloudAdmin,
  attachNotebookCloudAdminWs,
} = require('./notebooklm-cloud-admin.cjs');

class FakeSocket extends EventEmitter {
  constructor() { super(); this.destroyed = false; }
  destroy() { this.destroyed = true; }
}

class FakeUpstream extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeUpstream.CONNECTING;
    FakeUpstream.instances.push(this);
  }
  close() { this.readyState = FakeUpstream.CLOSING; this.emit('close', 1000); }
}
FakeUpstream.CONNECTING = 0;
FakeUpstream.OPEN = 1;
FakeUpstream.CLOSING = 2;
FakeUpstream.instances = [];

class FakeBrowser extends EventEmitter {
  constructor() { super(); this.readyState = FakeUpstream.OPEN; }
  close() { this.readyState = FakeUpstream.CLOSING; this.emit('close', 1000); }
}

class FakeWebSocketServer extends EventEmitter {
  constructor() { super(); }
  handleUpgrade(req, socket, head, callback) { upgrades += 1; callback(new FakeBrowser()); }
  close() {}
}

let upgrades = 0;

function session(token) {
  return {
    token,
    csrf: 'csrf-token',
    actor: 'test',
    authenticatedAt: Date.now(),
    expiresAt: Date.now() + 300000,
    upstreamCookie: '__Secure-notebooklm-admin=upstream',
    upstreamCsrf: 'upstream-csrf',
    desktopGrant: true,
    socket: null,
    socketPending: false,
    pendingSocket: null,
    pendingGeneration: 0,
    socketGeneration: 0,
  };
}

function request(token, csrf) {
  return {
    url: '/api/notebooklm/admin/desktop',
    headers: {
      origin: 'https://agy.example.test',
      cookie: `${COOKIE}=${token}`,
      'x-agy-admin-csrf': csrf || 'csrf-token',
      'sec-fetch-site': 'same-origin',
    },
  };
}

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.value = value; return this; },
  };
}

async function main() {
  const admin = createNotebookCloudAdmin({
    env: {
      NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test',
      AGY_PUBLIC_ORIGIN: 'https://agy.example.test',
      NOTEBOOKLM_CLOUD_ADMIN_KEY: 'a'.repeat(40),
      SGN_SECRET_TOKEN: 'different-secret',
    },
    fetchImpl: async () => { throw new Error('not used'); },
  });
  const token = 'session-token';
  admin.sessions.set(token, session(token));

  const server = new EventEmitter();
  const ws = attachNotebookCloudAdminWs(server, {
    admin,
    wsModule: { WebSocket: FakeUpstream, WebSocketServer: FakeWebSocketServer },
  });
  const upgradeRequest = request(token);
  const first = new FakeSocket();
  const second = new FakeSocket();
  server.emit('upgrade', upgradeRequest, first, Buffer.alloc(0));
  assert.equal(admin.sessions.get(token).socketPending, true);
  server.emit('upgrade', upgradeRequest, second, Buffer.alloc(0));
  assert.equal(second.destroyed, true, 'concurrent upgrade must be rejected');
  assert.equal(FakeUpstream.instances.length, 1, 'only one upstream socket may be opened');

  FakeUpstream.instances[0].readyState = FakeUpstream.OPEN;
  FakeUpstream.instances[0].emit('open');
  assert.equal(admin.sessions.get(token).socketPending, false);
  assert.ok(admin.sessions.get(token).socket);
  ws.close();

  FakeUpstream.instances = [];
  upgrades = 0;
  const revokeAdmin = createNotebookCloudAdmin({
    env: {
      NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test',
      AGY_PUBLIC_ORIGIN: 'https://agy.example.test',
      NOTEBOOKLM_CLOUD_ADMIN_KEY: 'a'.repeat(40),
      SGN_SECRET_TOKEN: 'different-secret',
    },
    fetchImpl: async () => ({
      ok: true, status: 200,
      async json() { return {}; },
    }),
  });
  const revokeToken = 'revoke-token';
  revokeAdmin.sessions.set(revokeToken, session(revokeToken));
  const revokeServer = new EventEmitter();
  const revokeWs = attachNotebookCloudAdminWs(revokeServer, {
    admin: revokeAdmin,
    wsModule: { WebSocket: FakeUpstream, WebSocketServer: FakeWebSocketServer },
  });
  const revokeSocket = new FakeSocket();
  const revokeRequest = request(revokeToken);
  revokeServer.emit('upgrade', revokeRequest, revokeSocket, Buffer.alloc(0));
  const revokeResponse = response();
  await revokeAdmin.end(revokeRequest, revokeResponse, false);
  assert.equal(revokeAdmin.sessions.has(revokeToken), false);
  assert.equal(FakeUpstream.instances[0].readyState, FakeUpstream.CLOSING);
  FakeUpstream.instances[0].readyState = FakeUpstream.OPEN;
  FakeUpstream.instances[0].emit('open');
  assert.equal(upgrades, 0, 'revoked pending session must never upgrade');
  assert.equal(revokeSocket.destroyed, true);
  revokeWs.close();

  FakeUpstream.instances = [];
  upgrades = 0;
  let clock = 1000;
  const ttlAdmin = createNotebookCloudAdmin({
    now: () => clock,
    env: {
      NOTEBOOKLM_CLOUD_URL: 'https://cloud.example.test',
      AGY_PUBLIC_ORIGIN: 'https://agy.example.test',
      NOTEBOOKLM_CLOUD_ADMIN_KEY: 'a'.repeat(40),
      SGN_SECRET_TOKEN: 'different-secret',
    },
    fetchImpl: async () => { throw new Error('not used'); },
  });
  const ttlToken = 'ttl-token';
  const ttlSession = session(ttlToken);
  ttlSession.authenticatedAt = clock;
  ttlSession.expiresAt = clock + 100;
  ttlAdmin.sessions.set(ttlToken, ttlSession);
  const ttlServer = new EventEmitter();
  const ttlWs = attachNotebookCloudAdminWs(ttlServer, {
    admin: ttlAdmin,
    wsModule: { WebSocket: FakeUpstream, WebSocketServer: FakeWebSocketServer },
  });
  const ttlSocket = new FakeSocket();
  const ttlRequest = request(ttlToken);
  ttlServer.emit('upgrade', ttlRequest, ttlSocket, Buffer.alloc(0));
  clock = 1200;
  assert.equal(ttlAdmin.sessionFor(ttlRequest), null);
  assert.equal(FakeUpstream.instances[0].readyState, FakeUpstream.CLOSING);
  FakeUpstream.instances[0].readyState = FakeUpstream.OPEN;
  FakeUpstream.instances[0].emit('open');
  assert.equal(upgrades, 0, 'expired pending session must never upgrade');
  assert.equal(ttlSocket.destroyed, true);
  ttlWs.close();
  console.log('test-notebooklm-cloud-admin-ws: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});