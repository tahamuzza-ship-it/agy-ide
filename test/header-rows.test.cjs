const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const cssPath = path.join(ROOT, 'public', 'style.css');

test('Header Buttons Layout: no forzar flex-wrap nowrap en resoluciones grandes', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.header-btns'), 'style.css debe contener .header-btns');
  
  // Verificar que el header permite wrap
  assert.ok(
    css.includes('flex-wrap: wrap'),
    'style.css debe contemplar flex-wrap: wrap para el header o los botones'
  );
});

test('Header Rows: index.html contiene separadores de fila o estructura multi-fila para evitar apiñuscamiento', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Verificar que existen los botones clave
  assert.ok(html.includes('id="btn-run"'), 'debe existir btn-run');
  assert.ok(html.includes('id="btn-console-pc4"'), 'debe existir btn-console-pc4');
  assert.ok(html.includes('id="btn-console-pc3"'), 'debe existir btn-console-pc3');
  assert.ok(html.includes('id="btn-puente-pc2"'), 'debe existir btn-puente-pc2');
  assert.ok(html.includes('id="btn-puente-pc1"'), 'debe existir btn-puente-pc1');
  assert.ok(html.includes('id="btn-files"'), 'debe existir btn-files');
  
  // Verificar que los botones están divididos en filas o tienen saltos de fila
  const hasRowBreaks = html.includes('header-row-break') || html.includes('header-row');
  assert.ok(hasRowBreaks, 'index.html debe estructurar los botones en filas para evitar que queden en una sola fila');
});
