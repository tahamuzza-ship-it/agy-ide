const fs = require('fs');
const path = require('path');

console.log("================================================================");
console.log("[TALLER AISLADO SDD] VERIFICACIÓN DE RESPONSIVE DESIGN MÓVIL");
console.log("================================================================");

const zipsPath = path.join(__dirname, 'public', 'cibercode-zips.html');
const manualPath = path.join(__dirname, 'public', 'cibercode-manual.html');

const zipsHtml = fs.readFileSync(zipsPath, 'utf8');
const manualHtml = fs.readFileSync(manualPath, 'utf8');

// Test 1: Viewport en cibercode-zips.html
const hasViewportZips = zipsHtml.includes('name="viewport"') && zipsHtml.includes('width=device-width');
console.log(`[TEST 1/6] Viewport móvil en cibercode-zips.html -> ${hasViewportZips}`);
if (!hasViewportZips) process.exit(1);

// Test 2: @media en cibercode-zips.html
const hasMediaZips = zipsHtml.includes('@media (max-width: 768px)');
console.log(`[TEST 2/6] Reglas @media (max-width: 768px) en ZIPS -> ${hasMediaZips}`);
if (!hasMediaZips) process.exit(1);

// Test 3: Touch target de 44px en botones ZIPS
const hasTouchTargetZips = zipsHtml.includes('min-height: 44px');
console.log(`[TEST 3/6] Touch targets táctiles de 44px en ZIPS -> ${hasTouchTargetZips}`);
if (!hasTouchTargetZips) process.exit(1);

// Test 4: Viewport en cibercode-manual.html
const hasViewportManual = manualHtml.includes('name="viewport"') && manualHtml.includes('width=device-width');
console.log(`[TEST 4/6] Viewport móvil en cibercode-manual.html -> ${hasViewportManual}`);
if (!hasViewportManual) process.exit(1);

// Test 5: @media en cibercode-manual.html
const hasMediaManual = manualHtml.includes('@media (max-width: 768px)');
console.log(`[TEST 5/6] Reglas @media (max-width: 768px) en MANUAL -> ${hasMediaManual}`);
if (!hasMediaManual) process.exit(1);

// Test 6: Inercia táctil en tablas
const hasTouchScroll = zipsHtml.includes('-webkit-overflow-scrolling: touch');
console.log(`[TEST 6/6] Desplazamiento táctil fluido en tablas -> ${hasTouchScroll}`);
if (!hasTouchScroll) process.exit(1);

console.log("================================================================");
console.log("RESULTADO: 6/6 PRUEBAS MÓVILES RESPONSIVE SUPERADAS (EXIT CODE: 0)");
console.log("================================================================");
