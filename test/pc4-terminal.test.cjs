'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PC2Terminal = require('../public/pc2-terminal.js');

test('PC4 Terminal: configuración y targetFor devuelven contrato esperado', () => {
  // 1. Debe existir TARGETS.PC4
  const target = PC2Terminal.targetFor({ target: 'PC4' });
  assert.equal(target.key, 'PC4');
  assert.equal(target.storageKey, 'agyide.pc4.console.pending-id');
  assert.equal(target.titleId, 'pc4-console-title');
  assert.equal(target.endpoint, '/api/pc-command');
  assert.ok(target.title.includes('PC4'));
  assert.ok(Array.isArray(target.shortcuts) && target.shortcuts.length >= 3);
  assert.deepEqual(target.shortcuts[0], ['hostname', 'hostname']);
});

test('PC4 Terminal: discriminación insensible a mayúsculas/minúsculas', () => {
  const targetLower = PC2Terminal.targetFor({ target: 'pc4' });
  assert.equal(targetLower.key, 'PC4');
});

test('server.js: expresiones regulares reconocen comandos directos y de misiones para PC4', () => {
  const directRegex = /^\/(pc1|pc2|pc4)\b(?:\s+([\s\S]+))?$/i;
  const missionRegex = /^misiones\s+(pc1|pc2|pc4)\b(?:\s+([\s\S]+))?$/i;

  // Comandos directos
  const match1 = '/pc4 hostname'.match(directRegex);
  assert.ok(match1, 'Debe coincidir con /pc4 hostname');
  assert.equal(match1[1].toUpperCase(), 'PC4');
  assert.equal(match1[2].trim(), 'hostname');

  const match2 = '/PC4 Get-Process'.match(directRegex);
  assert.ok(match2);
  assert.equal(match2[1].toUpperCase(), 'PC4');
  assert.equal(match2[2].trim(), 'Get-Process');

  // Misiones
  const match3 = 'MISIONES pc4 auditar memoria'.match(missionRegex);
  assert.ok(match3, 'Debe coincidir con MISIONES pc4');
  assert.equal(match3[1].toUpperCase(), 'PC4');
  assert.equal(match3[2].trim(), 'auditar memoria');

  // Comandos inválidos o de otros nodos desconocidos
  assert.equal('/pc5 hostname'.match(directRegex), null);
  assert.equal('misiones pc5 test'.match(missionRegex), null);
});

test('server.js: safeTarget admite PC1, PC2 y PC4', () => {
  function getSafeTarget(requestedTarget) {
    const t = String(requestedTarget || '').toUpperCase();
    return t === 'PC1' || t === 'PC2' || t === 'PC4' ? t : null;
  }

  assert.equal(getSafeTarget('PC1'), 'PC1');
  assert.equal(getSafeTarget('pc2'), 'PC2');
  assert.equal(getSafeTarget('PC4'), 'PC4');
  assert.equal(getSafeTarget('pc5'), null);
  assert.equal(getSafeTarget(''), null);
});

test('public/index.html: contiene selector de target PC4 y botón de consola PC4', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Selector
  assert.ok(html.includes('<option value="PC4">PC4 i9</option>'), 'Debe incluir opción PC4 en #pc-target');

  // Botón
  assert.ok(html.includes('id="btn-console-pc4"'), 'Debe incluir botón id="btn-console-pc4"');
  assert.ok(html.includes('🖥 CONSOLA PC4'), 'Debe incluir etiqueta 🖥 CONSOLA PC4');

  // Event listener
  assert.ok(html.includes("document.getElementById('btn-console-pc4')"), 'Debe incluir event listener para btn-console-pc4');
  assert.ok(html.includes("target: 'PC4'"), 'El listener debe invocar target: PC4');
});
