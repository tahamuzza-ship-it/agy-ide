'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperatorAuthority, createSupabaseAdapters } = require('../operator-auth.cjs');
const { loadInMemory, fixture, ENV, USER, NOGRANT, PASSWORD, PUBLIC_KEY, SERVICE_KEY, ORIGIN, URL2 } = require('./operator-fixture.cjs');
const withLegacyTrap = env => Object.defineProperty(env, 'SUPABASE_SERVICE_ROLE_KEY', {
  get() { throw Error('Legacy service-role key must NEVER be read'); },
});
const syntheticService = (role, ref) => 'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ role, ref })).toString('base64url') + '.synthetic_service_signature';

async function serve(f) {
  const server = await new Promise(resolve => { const s = f.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port;
  let jar = '', csrf = '';
  return {
    get jar() { return jar; }, set jar(value) { jar = value; },
    async call(path, body, headers = {}) {
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-agyide-pwd': 'synthetic-legacy-phrase',
          origin: ORIGIN, 'x-agy-operator-request': '1', 'x-agy-csrf': csrf, cookie: jar, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const set = response.headers.getSetCookie();
      if (set.length) jar = set.map(c => c.split(';')[0]).join('; ');
      const data = await response.json();
      if (data.csrf) csrf = data.csrf;
      return { status: response.status, data, cookies: set };
    },
    login(email = USER.email, password = PASSWORD) { return this.call('/api/agy/operator/login', { email, password }); },
    session() { return this.call('/api/agy/operator/session'); },
    check(headers) { return this.call('/__fixture/check', undefined, headers); },
    close() { return new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); },
  };
}

test('production lock is immutable: all envs, injected adapters and public key disabled', async () => {
  let accesses = 0, projectAccesses = 0;
  const env = { ...ENV,
    get SUPABASE_SERVICE_ROLE_KEY_2() { projectAccesses++; throw Error('production lock must not read key'); } };
  Object.defineProperty(env, 'SUPABASE_SERVICE_ROLE_KEY', {
    get() { accesses++; throw Error('legacy key must never be read'); },
  });
  assert.equal(createSupabaseAdapters(env), null);
  const authority = createOperatorAuthority({ env, adapters: { provider: {}, store: {} } });
  assert.equal(authority.ready(), false);
  const f = fixture(), app = require('express')();
  app.use(require('express').json());
  authority.routes(app, (_req, _res, next) => next());
  const s = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    const url = `http://127.0.0.1:${s.address().port}`;
    assert.equal((await fetch(url + '/api/agy/operator/login', { method: 'POST', headers: { origin: ORIGIN }, body: '{}' })).status, 503);
    assert.equal((await fetch(url + '/api/agy/operator/logout', { method: 'POST' })).status, 503);
    const session = await (await fetch(url + '/api/agy/operator/session')).json();
    assert.deepEqual(session, { ok: true, configured: false, authenticated: false, authorized: false });
    assert.equal(accesses, 0);
    assert.equal(projectAccesses, 0);
  } finally { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); f.cleanup(); }
});

test('VM-only synthetic pin and lock: wrong URL, role, ref, origin, env and key all fail before SDK', () => {
  let sdkCalls = 0;
  const sdk = { createClient() { sdkCalls++; return { auth: {} }; } };
  const { createSupabaseAdapters: create, counters } = loadInMemory({ sdk });
  for (const overrides of [
    { AGY_OPERATOR_AUTH_ENABLED: 'TRUE' }, { SUPABASE_URL_2: URL2 + '/' },
    { SUPABASE_URL_2: 'https://other.supabase.co' }, { AGY_OPERATOR_ORIGIN: 'http://agy-ide-production.up.railway.app' },
    { AGY_OPERATOR_ORIGIN: ORIGIN + '/' }, { SUPABASE_ANON_KEY_2: 'sb_secret_not-a-real-key' },
    { SUPABASE_ANON_KEY_2: PUBLIC_KEY + 'altered' }, { SUPABASE_ANON_KEY_2: undefined },
    { SUPABASE_ANON_KEY_2: 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ role: 'service_role', ref: 'lxlcivzuevowckbcxczc' })).toString('base64url') +
      '.synthetic_signature' },
    { SUPABASE_ANON_KEY_2: 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ role: 'anon', ref: 'different-project' })).toString('base64url') +
      '.synthetic_signature' },
    { SUPABASE_SERVICE_ROLE_KEY_2: '' }, { SUPABASE_SERVICE_ROLE_KEY_2: undefined },
    { SUPABASE_SERVICE_ROLE_KEY_2: 'sb_secret_not-a-real-key' },
    { SUPABASE_SERVICE_ROLE_KEY_2: SERVICE_KEY + 'altered' },
    { SUPABASE_SERVICE_ROLE_KEY_2: PUBLIC_KEY },
  ]) assert.equal(create(withLegacyTrap({ ...ENV, ...overrides })), null);
  assert.equal(sdkCalls, 0);
  assert.deepEqual(counters, { sdk: 0, network: 0 });
  const adapters = create(withLegacyTrap({ ...ENV }));
  assert.ok(adapters);
  assert.equal(counters.sdk, 1);
  assert.equal(sdkCalls, 1); // DB client only; public Auth client created on first login/verification.
});

test('VM-only privileged key: unpinned, wrong ref or wrong role rejected before SDK/network, no legacy fallback', () => {
  const wrongRef = syntheticService('service_role', 'other-project');
  const wrongRole = syntheticService('anon', 'lxlcivzuevowckbcxczc');
  for (const [label, privilegedKey, privilegedPin] of [
    ['unpinned', SERVICE_KEY, false],
    ['foreign project independently pinned in fixture', wrongRef, true],
    ['anon independently pinned in fixture', wrongRole, true],
  ]) {
    let sdkLoads = 0;
    const { createSupabaseAdapters: create, counters } = loadInMemory({
      privilegedPin, privilegedKey,
      sdk: { createClient() { sdkLoads++; throw Error('SDK must not load: ' + label); } },
    });
    assert.equal(create(withLegacyTrap({ ...ENV, SUPABASE_SERVICE_ROLE_KEY_2: privilegedKey })), null, label);
    assert.deepEqual(counters, { sdk: 0, network: 0 }, label);
    assert.equal(sdkLoads, 0, label);
  }
  const { createSupabaseAdapters: create, counters } = loadInMemory({
    sdk: { createClient() { throw Error('Missing project key must not load SDK'); } },
  });
  assert.equal(create(withLegacyTrap({ ...ENV, SUPABASE_SERVICE_ROLE_KEY_2: undefined })), null);
  assert.deepEqual(counters, { sdk: 0, network: 0 });
});

test('VM-only adapter: public Auth key is never service role; DB key never authenticates', async () => {
  const calls = [];
  const { createSupabaseAdapters: create } = loadInMemory({ sdk: { createClient(url, key) {
    calls.push({ url, key });
    if (key === SERVICE_KEY) return { from() { throw Error('unexpected DB operation'); } };
    return { auth: {
      async signInWithPassword() { return { data: { session: { access_token: 'synthetic-token', expires_at: Date.now() / 1000 + 3600 } } }; },
      async getUser() { return { data: { user: USER } }; },
    } };
  } } });
  const adapter = create(withLegacyTrap({ ...ENV }));
  const logged = await adapter.provider.login(USER.email, PASSWORD);
  assert.equal(logged.user.id, USER.id);
  assert.deepEqual(calls.map(x => x.key), [SERVICE_KEY, PUBLIC_KEY, PUBLIC_KEY]);
  assert.ok(calls.every(x => x.url === URL2));
});

test('HTTP: anonymous, shared password only, grantless, real scope, CSRF and logout', async () => {
  const f = fixture(), h = await serve(f);
  try {
    assert.equal((await h.session()).status, 401);
    assert.equal((await h.login(USER.email, 'synthetic-legacy-phrase')).status, 503);
    assert.equal((await h.call('/api/agy/operator/login', { email: USER.email, password: PASSWORD }, { 'x-agyide-pwd': '' })).status, 401);
    assert.equal((await h.login(NOGRANT.email)).status, 200);
    assert.equal((await h.session()).data.authorized, false);
    assert.equal((await h.check()).status, 403);
    const login = await h.login();
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.data), ['ok']);
    assert.ok(login.cookies.every(c => /HttpOnly; Secure; SameSite=Strict/.test(c)));
    const session = await h.session();
    assert.equal(session.data.authorized, true);
    assert.equal(session.data.user.id, USER.id);
    assert.equal((await h.check({ 'x-agy-csrf': 'spoof' })).status, 403);
    assert.equal((await h.check({ origin: 'https://wrong.example.test' })).status, 403);
    const check = await h.check();
    assert.equal(check.status, 200);
    assert.deepEqual(check.data.scopes, ['memory.read']);
    const oldCookie = h.jar;
    assert.equal((await h.call('/api/agy/operator/logout', {})).status, 200);
    h.jar = oldCookie;
    assert.equal((await h.check()).status, 401);
  } finally { await h.close(); f.cleanup(); }
});

test('durable revocation, provider/store outage, expiry, cross-app and scope checks', async () => {
  const f = fixture(), h = await serve(f);
  let second;
  try {
    await h.login(); await h.session();
    assert.equal((await h.check()).status, 200);
    f.controls.storeFail = true; assert.equal((await h.check()).status, 503); f.controls.storeFail = false;
    f.controls.providerFail = true; assert.equal((await h.check()).status, 503); f.controls.providerFail = false;
    for (const change of [{ application: 'different-app' }, { scopes: ['admin'] }, { expires_at: '2000-01-01' }]) {
      const state = f.read(), original = { ...state.grants[USER.id] };
      Object.assign(state.grants[USER.id], change); f.write(state);
      assert.equal((await h.check()).status, 403);
      state.grants[USER.id] = original; f.write(state);
    }
    const state = f.read(); state.grants[USER.id].revoked_at = new Date().toISOString(); f.write(state);
    second = fixture({ filename: f.file });
    const h2 = await serve(second);
    try { h2.jar = h.jar; assert.equal((await h2.check({ 'x-agy-csrf': (await h.session()).data.csrf })).status, 403); }
    finally { await h2.close(); }
    const s2 = f.read(); Object.values(s2.sessions).forEach(s => { s.expires_at = '2000-01-01'; }); f.write(s2);
    assert.equal((await h.check()).status, 401);
  } finally { await h.close(); f.cleanup(); }
});

test('login origin, rate limit, malformed fields and failed logout fail closed', async () => {
  const f = fixture(), h = await serve(f);
  try {
    assert.equal((await h.call('/api/agy/operator/login', { email: USER.email, password: PASSWORD }, { origin: 'https://wrong.example.test' })).status, 403);
    assert.equal((await h.call('/api/agy/operator/login', { email: USER.email, password: PASSWORD, scopes: ['admin'] })).status, 400);
    await h.login(); await h.session();
    f.controls.storeFail = true;
    assert.equal((await h.call('/api/agy/operator/logout', {})).status, 503);
    f.controls.storeFail = false;
    assert.equal((await h.call('/api/agy/operator/logout', {})).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await h.login(USER.email, 'wrong')).status, 503);
    assert.equal((await h.login(USER.email, 'wrong')).status, 429);
    assert.equal(Object.keys(f.read().grants).length, 1);
  } finally { await h.close(); f.cleanup(); }
});