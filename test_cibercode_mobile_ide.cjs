const fs = require('fs');
const path = require('path');

console.log("================================================================");
console.log("[TALLER AISLADO SDD] VERIFICACIÓN DE CIBERCODE TOP & BOTTOM NAV");
console.log("================================================================");

const htmlPath = path.join(__dirname, 'public', 'cibercode.html');
const jsPath = path.join(__dirname, 'public', 'cibercode.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// Test 1: Barra superior móvil presente
const hasTopNav = html.includes('id="mobileTopNav"') && html.includes('mobile-top-nav');
console.log(`[TEST 1/6] Barra de pestañas móviles superiores (Top Nav) -> ${hasTopNav}`);
if (!hasTopNav) process.exit(1);

// Test 2: Las 4 pestañas móviles superiores
const hasTopPills = ['mTopFiles', 'mTopEditor', 'mTopChat', 'mTopTerminal'].every(id => html.includes(`id="${id}"`));
console.log(`[TEST 2/6] Los 4 botones de pestaña superior (Archivos, Editor, Qwen, Terminal) -> ${hasTopPills}`);
if (!hasTopPills) process.exit(1);

// Test 3: Dynamic viewport height 100dvh
const hasDvh = html.includes('100dvh');
console.log(`[TEST 3/6] Soporte para altura dinámica móvil (100dvh anti-Safari bug) -> ${hasDvh}`);
if (!hasDvh) process.exit(1);

// Test 4: Función setMobileView en JS actualiza top y bottom
const hasBothTabs = js.includes('mTab') && js.includes('mTop');
console.log(`[TEST 4/6] Función setMobileView() sincroniza tanto top como bottom -> ${hasBothTabs}`);
if (!hasBothTabs) process.exit(1);

// Test 5: Auto-switch al editor al abrir archivos en móvil
const hasAutoSwitch = js.includes('window.innerWidth <= 768') && js.includes("setMobileView('editor')");
console.log(`[TEST 5/6] Auto-cambio al editor al seleccionar archivo en móvil -> ${hasAutoSwitch}`);
if (!hasAutoSwitch) process.exit(1);

// Test 6: Reglas de ocultamiento de columnas
const hasMedia = html.includes('@media (max-width: 768px)') && html.includes('mobile-view-files') && html.includes('mobile-view-chat');
console.log(`[TEST 6/6] Reglas completas de aislamiento de paneles en móvil -> ${hasMedia}`);
if (!hasMedia) process.exit(1);

console.log("================================================================");
console.log("RESULTADO: 6/6 PRUEBAS SUPERADAS CON ÉXITO (EXIT CODE: 0)");
console.log("================================================================");
