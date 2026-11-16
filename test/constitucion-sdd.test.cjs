const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const jsPath = path.join(ROOT, 'public', 'constitucion-sdd.js');
const serverPath = path.join(ROOT, 'server.js');
const docConstPath = path.join(ROOT, 'docs', 'CONSTITUCION_SGN.md');
const docSddPath = path.join(ROOT, 'docs', 'SPEC_SDD_VIVA.md');

test('Documentos de Gobernanza y SDD existen físicamente en docs/', () => {
  assert.ok(fs.existsSync(docConstPath), 'docs/CONSTITUCION_SGN.md debe existir');
  assert.ok(fs.existsSync(docSddPath), 'docs/SPEC_SDD_VIVA.md debe existir');

  const constContent = fs.readFileSync(docConstPath, 'utf8');
  assert.ok(constContent.includes('¡YO SOY LA TORMENTA!'), 'Debe contener el Santo y Seña oficial');
  assert.ok(constContent.includes('Regla Cero Carros Locos'), 'Debe contener la Regla Cero Carros Locos');
  assert.ok(constContent.includes('4 Puntos Sagrados') || constContent.includes('Cuatro Puntos Sagrados'), 'Debe contener los 4 Puntos Sagrados');
  assert.ok(constContent.includes('AUTORIZO TOCAR AGY-IDE'), 'Debe contener la autorización textual de Regla 7');
  assert.ok(constContent.includes('PC1'), 'Debe detallar nodo PC1');
  assert.ok(constContent.includes('PC2'), 'Debe detallar nodo PC2');
  assert.ok(constContent.includes('PC3'), 'Debe detallar nodo PC3');
  assert.ok(constContent.includes('PC4'), 'Debe detallar nodo PC4');

  const sddContent = fs.readFileSync(docSddPath, 'utf8');
  assert.ok(sddContent.includes('Doble Fuente de Verdad') || sddContent.includes('DOBLE FUENTE DE VERDAD'), 'Debe contemplar la Doble Fuente de Verdad');
  assert.ok(sddContent.includes('/api/constitucion'), 'Debe documentar /api/constitucion');
  assert.ok(sddContent.includes('/api/sdd/status'), 'Debe documentar /api/sdd/status');
});

test('server.js: expone endpoints de Constitución y SDD con contratos canónicos', () => {
  const serverCode = fs.readFileSync(serverPath, 'utf8');
  assert.ok(serverCode.includes("app.get('/api/constitucion'"), 'server.js debe declarar GET /api/constitucion');
  assert.ok(serverCode.includes("app.get('/api/sdd/status'"), 'server.js debe declarar GET /api/sdd/status');
  assert.ok(serverCode.includes('CONSTITUCION_SGN'), 'server.js debe cargar CONSTITUCION_SGN');
  assert.ok(serverCode.includes('SPEC_SDD_VIVA'), 'server.js debe cargar SPEC_SDD_VIVA');
  assert.ok(serverCode.includes('¡YO SOY LA TORMENTA!'), 'server.js debe retornar Santo y Seña oficial');
  assert.ok(serverCode.includes('AUTORIZO TOCAR AGY-IDE'), 'server.js debe contemplar Regla 7');
});

test('public/index.html: estructura DOM completa para Constitución y Pruebas Didácticas', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Botones en Fila 3
  assert.ok(html.includes('id="btn-constitucion"'), 'Debe incluir botón id="btn-constitucion"');
  assert.ok(html.includes('id="btn-sdd-matrix"'), 'Debe incluir botón id="btn-sdd-matrix"');
  assert.ok(html.includes('id="btn-pruebas-html"'), 'Debe incluir botón id="btn-pruebas-html"');
  assert.ok(html.includes('id="btn-salud-flota"'), 'Debe incluir botón id="btn-salud-flota"');

  // Modales
  assert.ok(html.includes('id="constitucion-modal"'), 'Debe contener modal id="constitucion-modal"');
  assert.ok(html.includes('id="pruebas-didacticas-modal"'), 'Debe contener modal id="pruebas-didacticas-modal"');
  assert.ok(html.includes('id="constitucion-close"'), 'Debe contener botón cerrar de Constitución');
  assert.ok(html.includes('id="pruebas-close"'), 'Debe contener botón cerrar de Pruebas Didácticas');

  // Píldoras y botones de pruebas
  assert.ok(html.includes('id="status-heartbeat"'), 'Debe incluir status-heartbeat');
  assert.ok(html.includes('id="status-pc1"'), 'Debe incluir status-pc1');
  assert.ok(html.includes('id="status-pc2"'), 'Debe incluir status-pc2');
  assert.ok(html.includes('id="status-pc3"'), 'Debe incluir status-pc3');
  assert.ok(html.includes('id="status-pc4"'), 'Debe incluir status-pc4');
  assert.ok(html.includes('id="status-safetarget"'), 'Debe incluir status-safetarget');
  assert.ok(html.includes('id="status-sdd"'), 'Debe incluir status-sdd');

  // Script cargado
  assert.ok(html.includes('src="./constitucion-sdd.js"'), 'Debe incluir script constitucion-sdd.js');
});

test('public/constitucion-sdd.js: lógica modular implementada y sintaxis válida', () => {
  assert.ok(fs.existsSync(jsPath), 'public/constitucion-sdd.js debe existir físicamente');
  const jsContent = fs.readFileSync(jsPath, 'utf8');
  assert.ok(jsContent.includes('window.ConstitucionSDD'), 'Debe exponer API window.ConstitucionSDD');
  assert.ok(jsContent.includes('ejecutarPruebaDidactica'), 'Debe implementar ejecutarPruebaDidactica');
  assert.ok(jsContent.includes('probarTodoEnBateria'), 'Debe implementar probarTodoEnBateria');
  assert.ok(jsContent.includes('safetarget'), 'Debe manejar caso de prueba safetarget guardrail');
});
