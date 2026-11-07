const fs = require('fs');
const path = require('path');

console.log("================================================================");
console.log("[TALLER AISLADO SDD] VERIFICACIÓN DE CIBERCODE IDE MÓVIL");
console.log("================================================================");

const htmlPath = path.join(__dirname, 'public', 'cibercode.html');
const jsPath = path.join(__dirname, 'public', 'cibercode.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// Test 1: Barra inferior móvil presente
const hasBottomBar = html.includes('id="mobileBottomBar"') && html.includes('mobile-bottom-bar');
console.log(`[TEST 1/5] Barra de navegación inferior móvil presente -> ${hasBottomBar}`);
if (!hasBottomBar) process.exit(1);

// Test 2: Las 4 pestañas de navegación móvil
const hasTabs = ['mTabFiles', 'mTabEditor', 'mTabChat', 'mTabTerminal'].every(id => html.includes(`id="${id}"`));
console.log(`[TEST 2/5] Las 4 pestañas móviles (Archivos, Editor, Qwen, Terminal) -> ${hasTabs}`);
if (!hasTabs) process.exit(1);

// Test 3: Reglas @media en CSS para el IDE
const hasMedia = html.includes('@media (max-width: 768px)') && html.includes('mobile-view-');
console.log(`[TEST 3/5] Reglas responsivas de conmutación de columnas -> ${hasMedia}`);
if (!hasMedia) process.exit(1);

// Test 4: Función setMobileView en JS
const hasSetMobileView = js.includes('function setMobileView') && js.includes('mobile-view-');
console.log(`[TEST 4/5] Función setMobileView() en JavaScript -> ${hasSetMobileView}`);
if (!hasSetMobileView) process.exit(1);

// Test 5: Auto-switch al editor al abrir archivos en móvil
const hasAutoSwitch = js.includes('window.innerWidth <= 768') && js.includes("setMobileView('editor')");
console.log(`[TEST 5/5] Auto-cambio al editor al seleccionar archivo en móvil -> ${hasAutoSwitch}`);
if (!hasAutoSwitch) process.exit(1);

console.log("================================================================");
console.log("RESULTADO: 5/5 PRUEBAS DE CIBERCODE IDE MÓVIL SUPERADAS (EXIT CODE: 0)");
console.log("================================================================");
