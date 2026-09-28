'use strict';
// Isolated fixtures only: this module is never imported from production.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const express = require('express');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://agy-ide-production.up.railway.app';
const URL2 = 'https://lxlcivzuevowckbcxczc.supabase.co';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'operator@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z' };
const NOGRANT = { id: '22222222-2222-4222-8222-222222222222', email: 'nogrant@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z' };
const PASSWORD = 'controlled-fixture-password-not-a-secret';
const PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ role: 'anon', ref: 'lxlcivzuevowckbcxczc' })).toString('base64url') + '.synthetic_signature';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ role: 'service_role', ref: 'lxlcivzuevowckbcxczc' })).toString('base64url') +
  '.synthetic_service_signature';
const ENV = { AGY_OPERATOR_AUTH_ENABLED: 'true', AGY_OPERATOR_ORIGIN: ORIGIN,
  SUPABASE_URL_2: URL2, SUPABASE_ANON_KEY_2: PUBLIC_KEY,
  SUPABASE_SERVICE_ROLE_KEY_2: SERVICE_KEY };

function loadInMemory({ sdk, pin = true, privilegedPin = true, privilegedKey = SERVICE_KEY, unlock = true } = {}) {
  const filename = path.join(ROOT, 'operator-auth.cjs');
  let source = fs.readFileSync(filename, 'utf8');
  if (unlock) {
    const marker = 'const OPERATOR_AUTH_RELEASE_ENABLED = false;';
    if (!source.includes(marker)) throw Error('Production safety lock changed');
    source = source.replace(marker, 'const OPERATOR_AUTH_RELEASE_ENABLED = true;');
  }
  if (pin) {
    const marker = 'const VERIFIED_AUTH_ANON_KEY_SHA256 = null;';
    if (!source.includes(marker)) throw Error('Production public-key pin changed');
    source = source.replace(marker, 'const VERIFIED_AUTH_ANON_KEY_SHA256 = ' +
      JSON.stringify(createHash('sha256').update(PUBLIC_KEY).digest('hex')) + ';');
  }
  if (privilegedPin) {
    const marker = 'const VERIFIED_SERVICE_ROLE_KEY_2_SHA256 = null;';
    if (!source.includes(marker)) throw Error('Production privileged-key pin changed');
    source = source.replace(marker, 'const VERIFIED_SERVICE_ROLE_KEY_2_SHA256 = ' +
      JSON.stringify(createHash('sha256').update(privilegedKey).digest('hex')) + ';');
  }
  const counters = { sdk: 0, network: 0 };
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, Buffer, URL, AbortSignal, Date, Map,
    require(name) {
      if (name === '@supabase/supabase-js') {
        counters.sdk++;
        if (!sdk) throw Error('Unexpected SDK load');
        return sdk;
      }
      return originalRequire(name);
    },
    process: { env: {} },
    fetch() { counters.network++; throw Error('External network is forbidden in tests'); },
  }, { filename });
  return { ...module.exports, counters };
}

function fixture({ filename } = {}) {
  const dir = filename ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'agy-operators-review-'));
  const file = filename || path.join(dir, 'state.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = state => fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  if (!fs.existsSync(file)) write({ sessions: {}, grants: { [USER.id]: {
    user_id: USER.id, application: 'agy-ide', scopes: ['memory.read'],
    expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null,
  } } });
  const controls = { providerFail: false, storeFail: false, checks: 0 };
  const store = {
    async session(hash) { if (controls.storeFail) throw Error('Fixture store failure'); return read().sessions[hash] || null; },
    async grant(id) { if (controls.storeFail) throw Error('Fixture store failure'); return read().grants[id] || null; },
    async insert(row) { if (controls.storeFail) throw Error('Fixture store failure'); const s = read(); s.sessions[row.id_hash] = row; write(s); },
    async revoke(hash) { if (controls.storeFail) throw Error('Fixture store failure'); const s = read(); if (s.sessions[hash]) s.sessions[hash].revoked_at = new Date().toISOString(); write(s); },
  };
  const provider = {
    async login(email, password) {
      const user = [USER, NOGRANT].find(x => x.email === email);
      if (!user || password !== PASSWORD) throw new Error('Fixture login failure');
      return { accessToken: 'controlled-token-' + user.id, expiresAt: Date.now() + 3600000 };
    },
    async user(token) {
      controls.checks++;
      if (controls.providerFail) throw Error('Fixture provider failure');
      return [USER, NOGRANT].find(u => token === 'controlled-token-' + u.id) || null;
    },
  };
  const authority = loadInMemory().createOperatorAuthority({ adapters: { provider, store }, env: ENV });
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  const requirePwd = (req, res, next) => req.headers['x-agyide-pwd'] === 'synthetic-legacy-phrase' ?
    next() : res.status(401).json({ error: 'IDE_AUTH_REQUIRED' });
  authority.routes(app, requirePwd);
  // Test-only, never in server.js: exercise the unconnected authorization helper.
  app.get('/__fixture/check', requirePwd, async (req, res) => {
    try { res.json(await authority.verifyOperator(req)); }
    catch (error) { res.status(error.status || 503).json({ error: error.code || 'UNAVAILABLE' }); }
  });
  return { app, authority, controls, file, read, write, USER, NOGRANT,
    cleanup() { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } };
}
module.exports = { loadInMemory, fixture, ENV, USER, NOGRANT, PASSWORD, PUBLIC_KEY, SERVICE_KEY, ORIGIN, URL2 };