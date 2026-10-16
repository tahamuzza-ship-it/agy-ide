'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/local-ai.js'), 'utf8');

function harness({ emptyPost = false } = {}) {
  const elements = Object.fromEntries(['pwd','pwd-toggle','pwd-toggle-label','node','text','mic','send','read','stop','status','answer','voice-status','pc4-note']
    .map(id => [id, { value: '', textContent: '', disabled: false, options: [{}, {}],
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }]));
  elements.pwd.value = 'synthetic';
  elements.pwd.type = 'password';
  elements.node.value = 'PC4';
  let posts = 0, reads = 0;
  class Recognition {
    start() { this.onstart?.(); }
    abort() { throw Error('Synthetic audio failure'); }
  }
  const window = { SpeechRecognition: Recognition, isSecureContext: true,
    speechSynthesis: { cancel() { throw Error('Synthetic audio failure'); } },
    addEventListener() {} };
  const context = {
    window, document: { getElementById: id => elements[id] }, AbortController, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms < 3000 ? 0 : ms), clearTimeout,
    setInterval: () => 1, clearInterval() {},
    fetch: async (url, options = {}) => {
      let raw;
      if (url.endsWith('/config')) raw = JSON.stringify({ authMode: 'agy', pc4Enabled: true });
      else if (options.method === 'POST') {
        posts++;
        raw = emptyPost ? '' : JSON.stringify({ id: 'synthetic-' + posts, access: 'synthetic' });
      } else {
        reads++;
        raw = reads % 2 ? '' : JSON.stringify({ status: 'completed', text: 'Respuesta ' + posts });
      }
      return { ok: true, status: 200, text: async () => raw };
    },
  };
  vm.runInNewContext(source, context);
  return { elements, counts: () => ({ posts, reads }) };
}
test('empty polling response is recovered; second send survives audio errors without duplicate POST', async () => {
  const h = harness();
  h.elements.text.value = 'Primera';
  await h.elements.send.onclick();
  assert.equal(h.elements.answer.textContent, 'Respuesta 1');
  assert.equal(h.elements.send.disabled, false);
  h.elements.mic.onclick();
  h.elements.text.value = 'Segunda';
  await h.elements.send.onclick();
  assert.equal(h.elements.answer.textContent, 'Respuesta 2');
  assert.equal(h.elements.send.disabled, false);
  assert.deepEqual(h.counts(), { posts: 2, reads: 4 });
});
test('empty POST is never retried and form unlocks with delivery uncertainty', async () => {
  const h = harness({ emptyPost: true });
  h.elements.text.value = 'Consulta';
  await h.elements.send.onclick();
  assert.equal(h.counts().posts, 1);
  assert.equal(h.elements.send.disabled, false);
  assert.match(h.elements.status.textContent, /podría haber llegado/);
});
test('eye shows and hides the same password without sending a request', () => {
  const h = harness();
  assert.equal(h.elements.pwd.type, 'password');
  h.elements['pwd-toggle'].onclick();
  assert.equal(h.elements.pwd.type, 'text');
  assert.equal(h.elements['pwd-toggle-label'].textContent, 'Ocultar');
  assert.equal(h.elements['pwd-toggle'].attributes['aria-pressed'], 'true');
  h.elements['pwd-toggle'].onclick();
  assert.equal(h.elements.pwd.type, 'password');
  assert.equal(h.elements.pwd.value, 'synthetic');
  assert.equal(h.elements['pwd-toggle'].attributes['aria-label'], 'Mostrar contraseña');
  assert.equal(h.counts().posts, 0);
});
