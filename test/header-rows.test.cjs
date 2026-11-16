const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const cssPath = path.join(ROOT, 'public', 'style.css');

test('Header CSS: soporte completo multi-fila en desktop y flex-wrap', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.header-btns'), 'style.css debe contener .header-btns');
  assert.ok(css.includes('.header-row-break'), 'style.css debe definir .header-row-break');
  assert.ok(css.includes('flex-wrap: wrap'), 'style.css debe contemplar flex-wrap: wrap');
});

test('Header HTML: exactamente 2 filas de botones balanceadas sin apiñuscamiento', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Extraer el bloque .header-btns
  const match = html.match(/<div class="header-btns">([\s\S]*?)<\/div>\s*<\/header>/);
  assert.ok(match, 'Debe existir el contenedor .header-btns dentro de header');
  
  const content = match[1];
  
  // Contar los separadores de fila
  const breaks = (content.match(/class="header-row-break"/g) || []).length;
  assert.equal(breaks, 1, 'Debe haber exactamente 1 separador header-row-break para generar exactamente 2 filas');
  
  // Dividir en las dos filas
  const parts = content.split(/<div class="header-row-break"[^>]*><\/div>/);
  assert.equal(parts.length, 2, 'El contenido debe dividirse en exactamente 2 filas');
  
  // Contar botones/enlaces en cada fila
  const countButtons = (part) => (part.match(/<(button|a)\b/g) || []).length;
  const row1Count = countButtons(parts[0]);
  const row2Count = countButtons(parts[1]);
  
  // Fila 1 debe tener exactamente 8 botones en HTML (más 1 inyectado en runtime = 9)
  assert.equal(row1Count, 8, `Fila 1 debe tener exactamente 8 botones en HTML (actual: ${row1Count})`);
  // Fila 2 debe tener exactamente 9 botones (4 consolas de flota + 5 accesos globales)
  assert.equal(row2Count, 9, `Fila 2 debe tener exactamente 9 botones en HTML (actual: ${row2Count})`);
  
  // Verificar presencia de todas las consolas de flota multi-nodo en Fila 2
  assert.ok(parts[1].includes('id="btn-puente-pc1"'), 'Puente PC1 debe estar en Fila 2');
  assert.ok(parts[1].includes('id="btn-puente-pc2"'), 'Consola PC2 debe estar en Fila 2');
  assert.ok(parts[1].includes('id="btn-console-pc3"'), 'Consola PC3 Miami debe estar en Fila 2');
  assert.ok(parts[1].includes('id="btn-console-pc4"'), 'Consola PC4 Supernodo debe estar en Fila 2');
  
  // Verificar presencia de botones de control y herramientas en Fila 1
  assert.ok(parts[0].includes('id="btn-run"'), 'Botón Ejecutar debe estar en Fila 1');
  assert.ok(parts[0].includes('id="btn-goal"'), 'Botón Goal debe estar en Fila 1');
  assert.ok(parts[0].includes('id="btn-notebooklm"'), 'Botón NotebookLM debe estar en Fila 1');
});
