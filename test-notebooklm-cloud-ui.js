'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { allowedPath } = require('./notebooklm-proxy.cjs');

const panel = fs.readFileSync('public/notebooklm.js', 'utf8');
const admin = fs.readFileSync('public/notebooklm-cloud-admin.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const proxy = fs.readFileSync('notebooklm-proxy.cjs', 'utf8');

assert.match(panel, /ACTIVAR SESION CLOUD/);
assert.match(panel, /notebooklm-cloud-state/);
assert.match(panel, /SIN SESION/);
assert.match(admin, /state = 'SIN SESION'/);
assert.match(admin, /setState\('ESPERANDO LOGIN'\)/);
assert.match(admin, /setState\('CLOUD LISTO', 'ok'\)/);
assert.match(admin, /setState\('SIN SESION'\)/);
assert.match(admin, /body: JSON\.stringify\(\{ confirmed: true \}\)/);
assert.match(admin, /X-AGY-Admin-CSRF/);
assert.match(admin, /credentials: 'same-origin'/);
assert.match(admin, /keepalive: true/);
assert.match(admin, /method: 'POST'/);
assert.match(admin, /var currentCsrf = csrf/);
assert.equal(admin.includes('sendBeacon'), false);
for (const forbidden of [/Automática/, /\bPC2\b/, /\bpc2\b/, /\bauto\b/, /\bfallback\b/]) {
  assert.equal(forbidden.test(admin), false, `legacy cloud-admin text remains: ${forbidden}`);
}
assert.match(index, /notebooklm-cloud-admin\.css/);
assert.match(index, /notebooklm-cloud-admin\.js/);
assert.match(proxy, /suffix === '\/routing'/);
assert.match(proxy, /resolvePc2Base/);
assert.match(proxy, /registeredEndpoint/);
assert.equal(allowedPath('PUT', '/routing'), false);

console.log('test-notebooklm-cloud-ui: ok');