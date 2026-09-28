'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const { createInvitationReceiver } = require(path.join(ROOT, 'operator-invitation.cjs'));
const { invitationPage } = require(path.join(ROOT, 'operator-invitation-page.cjs'));
const express = require('express');
const ORIGIN = 'https://agy-ide-production.up.railway.app';
const URL2 = 'https://lxlcivzuevowckbcxczc.supabase.co';
// Opaque synthetic strings, never credentials. Pins substituted ONLY inside this VM.
const PUBLIC_KEY = 'sb_publishable_fixture_only_no_real_key_A001';
const ENV = { AGY_OPERATOR_INVITATIONS_ENABLED: 'true', AGY_OPERATOR_ORIGIN: ORIGIN,
  SUPABASE_URL_2: URL2, SUPABASE_PUBLISHABLE_KEY_2: PUBLIC_KEY };
function trapLegacy(env) {
  for (const name of ['SUPABASE_ANON_KEY_2', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_2',
    'SUPABASE_SECRET_KEY_2']) {
    Object.defineProperty(env, name, {
      get() { throw Error('Invitation must not read other key: ' + name); },
    });
  }
  return env;
}
function isolatedReceiver({ pin = false, pinnedKey = PUBLIC_KEY, sdk } = {}) {
  const filename = path.join(ROOT, 'operator-invitation.cjs');
  let source = readFileSync(filename, 'utf8');
  if (pin) {
    const marker = 'const VERIFIED_PUBLISHABLE_KEY_2_SHA256 = null;';
    assert.ok(source.includes(marker));
    source = source.replace(marker, 'const VERIFIED_PUBLISHABLE_KEY_2_SHA256 = ' +
      JSON.stringify(createHash('sha256').update(pinnedKey).digest('hex')) + ';');
  }
  const counters = { sdkLoads: 0, network: 0 };
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, Buffer, URL, AbortSignal, process: { env: {} },
    require(name) {
      if (name === '@supabase/supabase-js') {
        counters.sdkLoads++;
        if (!sdk) throw Error('SDK must not load for invalid configuration');
        return sdk;
      }
      return localRequire(name);
    },
    fetch() { counters.network++; throw Error('external network forbidden'); },
  }, { filename });
  return { create: module.exports.createInvitationReceiver, counters };
}
const invite = { type: 'invite', accessToken: 'eyJ.fixture.invited',
  refreshToken: 'test-only-invitation-refresh-token', password: 'Controlled-test-password-47',
  confirmation: 'Controlled-test-password-47' };

async function serve(receiver) {
  const app = express();
  app.use(express.json());
  receiver.register(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
function post(url, body = invite, headers = {}) {
  return fetch(url + '/api/agy/operator/invitation', { method: 'POST',
    headers: { origin: ORIGIN, 'x-agy-operator-request': '1', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body) });
}

test('disabled independently of operator auth and explicit credentials; never calls provider', async () => {
  let calls = 0;
  const provider = { acceptInvitation() { calls++; } };
  for (const env of [{}, { AGY_OPERATOR_AUTH_ENABLED: 'true', AGY_OPERATOR_ORIGIN: ORIGIN },
    { AGY_OPERATOR_INVITATIONS_ENABLED: 'TRUE', AGY_OPERATOR_ORIGIN: ORIGIN },
    { AGY_OPERATOR_INVITATIONS_ENABLED: 'true', AGY_OPERATOR_ORIGIN: 'http://agy-fixture.example.test' }]) {
    const h = await serve(createInvitationReceiver({ env, provider }));
    try {
      assert.equal((await post(h.url)).status, 503);
      assert.equal((await fetch(h.url + '/api/agy/operator/invitation')).status, 503);
    } finally { await h.close(); }
  }
  assert.equal(calls, 0);
  for (const bad of [undefined, 'https://other.supabase.co', URL2 + '/auth/v1', URL2 + '?x=1']) {
    assert.equal(createInvitationReceiver({ env: { AGY_OPERATOR_INVITATIONS_ENABLED: 'true',
      AGY_OPERATOR_ORIGIN: ORIGIN, SUPABASE_URL_2: bad } }).ready(), false);
  }
  assert.equal(createInvitationReceiver({ env: { AGY_OPERATOR_INVITATIONS_ENABLED: 'true',
    AGY_OPERATOR_ORIGIN: ORIGIN, SUPABASE_URL_2: URL2 } }).ready(), false);
});

test('missing, wrong type, same-type other-project string, unattested or wrong origin blocks before SDK/network', async () => {
  const invalid = [
    { SUPABASE_PUBLISHABLE_KEY_2: undefined },
    { SUPABASE_PUBLISHABLE_KEY_2: '' },
    { SUPABASE_PUBLISHABLE_KEY_2: 'sb_secret_fixture_only_no_real_key_B002' },
    { SUPABASE_PUBLISHABLE_KEY_2: PUBLIC_KEY + '_simulated_other_project' },
    { SUPABASE_PUBLISHABLE_KEY_2: 'sb_publishable_unattested_test_only' },
    { SUPABASE_PUBLISHABLE_KEY_2: 'eyJ.fixture.jwt' },
    { SUPABASE_PUBLISHABLE_KEY_2: 'sb_publishable_short' },
    { SUPABASE_PUBLISHABLE_KEY_2: 'invalid' },
    { SUPABASE_URL_2: undefined },
    { SUPABASE_URL_2: 'https://other.supabase.co' },
    { SUPABASE_URL_2: URL2 + '/' },
    { AGY_OPERATOR_ORIGIN: undefined },
    { AGY_OPERATOR_ORIGIN: 'https://other.example.test' },
    { AGY_OPERATOR_ORIGIN: ORIGIN + '/' },
    { AGY_OPERATOR_ORIGIN: ORIGIN.replace('https:', 'http:') },
    { AGY_OPERATOR_INVITATIONS_ENABLED: 'false' },
  ];
  // With no real attestation, even well-formed prefix must stay disabled.
  for (const pin of [false, true]) {
    const { create, counters } = isolatedReceiver({ pin });
    for (const overrides of pin ? invalid : [{}, ...invalid]) {
      const env = trapLegacy({ ...ENV, ...overrides });
      assert.equal(create({ env }).ready(), false);
      let providerCalls = 0;
      const receiver = create({ env, provider: {
        async acceptInvitation() { providerCalls++; },
      } });
      assert.equal(receiver.ready(), false);
      const h = await serve(receiver);
      try {
        assert.equal((await post(h.url)).status, 503);
      } finally { await h.close(); }
      assert.equal(providerCalls, 0);
    }
    assert.deepEqual(counters, { sdkLoads: 0, network: 0 });
  }
});

test('even an independently pinned wrong syntactic type fails before SDK', () => {
  let sdkLoads = 0;
  const invalidKey = 'sb_secret_fixture_only_no_real_key_B002';
  const { create, counters } = isolatedReceiver({
    pin: true, pinnedKey: invalidKey,
    sdk: { createClient() { sdkLoads++; throw Error('SDK must not load'); } },
  });
  assert.equal(create({ env: trapLegacy({ ...ENV, SUPABASE_PUBLISHABLE_KEY_2: invalidKey }) }).ready(), false);
  assert.equal(sdkLoads, 0);
  assert.deepEqual(counters, { sdkLoads: 0, network: 0 });
});

test('isolated attested fixture uses only public key and invited user session', async () => {
  const user = { id: '11111111-1111-4111-8111-111111111111',
    email: 'invite@example.test', email_confirmed_at: '2026-01-01T00:00:00Z',
    invited_at: '2026-01-01T00:00:00Z' };
  const steps = [];
  const { create, counters } = isolatedReceiver({ pin: true, sdk: {
    createClient(url, key, options) {
      assert.equal(url, URL2);
      assert.equal(key, PUBLIC_KEY);
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.autoRefreshToken, false);
      return { auth: {
        async getUser(token) {
          steps.push('verify'); assert.equal(token, invite.accessToken);
          return { data: { user } };
        },
        async setSession(tokens) {
          steps.push('session');
          assert.equal(tokens.access_token, invite.accessToken);
          assert.equal(tokens.refresh_token, invite.refreshToken);
          return { data: { user, session: { access_token: invite.accessToken } } };
        },
        async updateUser(input) {
          steps.push('password'); assert.equal(input.password, invite.password);
          return { data: { user } };
        },
      } };
    },
  } });
  const env = trapLegacy({ ...ENV });
  const h = await serve(create({ env }));
  try {
    const response = await post(h.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { ok: true, authorized: false });
  } finally { await h.close(); }
  assert.deepEqual(steps, ['verify', 'session', 'password']);
  assert.deepEqual(counters, { sdkLoads: 1, network: 0 });
});

test('controlled invitation has no MCP, SQL, grant, session or cookies; rejects query/code and wrong origin', async () => {
  let calls = 0;
  const { create } = isolatedReceiver({ pin: true });
  const h = await serve(create({
    env: trapLegacy({ ...ENV }),
    provider: { async acceptInvitation(access, refresh, password) {
      calls++;
      assert.equal(access, invite.accessToken);
      assert.equal(refresh, invite.refreshToken);
      assert.equal(password, invite.password);
    } },
  }));
  try {
    const endpoint = '/api/agy/operator/invitation';
    const page = await fetch(h.url + endpoint);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await fetch(h.url + endpoint + '?code=pkce')).status, 400);
    assert.equal((await fetch(h.url + endpoint + '?token_hash=secret')).status, 400);
    assert.equal((await post(h.url, invite, { origin: 'https://wrong.example' })).status, 403);
    assert.equal((await fetch(h.url + endpoint + '?code=pkce', { method: 'POST',
      headers: { origin: ORIGIN, 'x-agy-operator-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(invite) })).status, 400);
    assert.equal((await post(h.url, { ...invite, code: 'pkce' })).status, 400);
    assert.equal(calls, 0);
    const result = await post(h.url);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, authorized: false });
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(calls, 1);
    for (const route of ['/api/agy/operator/session', '/api/agy/operator/login',
      '/api/agy/yarbis-mcp/call']) {
      assert.equal((await fetch(h.url + route)).status, 404);
    }
  } finally { await h.close(); }
});

function pageState(url) {
  const { html } = invitationPage(true, !url.includes('?'));
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const location = new URL(url);
  const status = { textContent: '' };
  const form = { hidden: true, reset() {}, addEventListener() {} };
  const history = { replaceState(_state, _title, clean) {
    assert.equal(clean, '/api/agy/operator/invitation');
  } };
  vm.runInNewContext(script, { location, history, URLSearchParams,
    document: { getElementById(id) { return id === 'status' ? status : form; } },
    window: { addEventListener() {} }, fetch() { throw Error('no network on page load'); } });
  return { status: status.textContent, form: form.hidden };
}

test('browser parser admits exact documented fragment and v2.197.0 empty sb; rejects malformed links', () => {
  const base = 'https://agy-fixture.example.test/api/agy/operator/invitation';
  const fields = 'access_token=eyJ.fixture.invited&refresh_token=test-only-invitation-refresh-token&type=invite&token_type=bearer&expires_in=3600&expires_at=1999999999';
  assert.equal(pageState(base + '#' + fields).form, false);
  assert.equal(pageState(base + '#' + fields + '&sb=').form, false);
  for (const url of [base + '?code=pkce', base + '?token_hash=hash&type=invite',
    base + '?code=pkce#' + fields, base + '#code=pkce',
    base + '#' + fields + '&sb=unexpected', base + '#' + fields + '&access_token=duplicate',
    base + '#' + fields.replace('type=invite', 'type=recovery')]) {
    const state = pageState(url);
    assert.equal(state.form, true, url);
    assert.match(state.status, /PKCE|invitación/i);
  }
  assert.match(pageState(base + '?code=pkce').status, /verificador PKCE iniciado localmente/);
});