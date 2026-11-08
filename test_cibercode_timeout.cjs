const fs = require('fs');
const path = require('path');

console.log("================================================================");
console.log("[TALLER AISLADO SDD] VERIFICACIÓN DE TIMEOUT PENSAMIENTO PROFUNDO");
console.log("================================================================");

const relayPath = path.join(__dirname, 'cibercode-relay.cjs');
const jsPath = path.join(__dirname, 'public', 'cibercode.js');

const relay = fs.readFileSync(relayPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// Test 1: Timeout de 300,000ms (5 min) para Pensamiento Profundo
const has300s = relay.includes('300000') && relay.includes('isDeepThinking');
console.log(`[TEST 1/4] Timeout ampliado a 300s (5 min) para Pensamiento Profundo 7B -> ${has300s}`);
if (!has300s) process.exit(1);

// Test 2: Timeout de 180,000ms (3 min) para modelo Rápido 1.5B
const has180s = relay.includes('180000');
console.log(`[TEST 2/4] Timeout ampliado a 180s (3 min) para modelo Rápido 1.5B -> ${has180s}`);
if (!has180s) process.exit(1);

// Test 3: Socket timeout extendido en Express a 360,000ms (6 min)
const hasSocketTimeout = relay.includes('360000');
console.log(`[TEST 3/4] Socket timeout de Express extendido a 360s (6 min) -> ${hasSocketTimeout}`);
if (!hasSocketTimeout) process.exit(1);

// Test 4: Mensaje amigable en frontend para Pensamiento Profundo
const hasDeepHint = js.includes('Razonando en los 24 núcleos de PC4');
console.log(`[TEST 4/4] Indicador en frontend para esperas largas de Pensamiento Profundo -> ${hasDeepHint}`);
if (!hasDeepHint) process.exit(1);

console.log("================================================================");
console.log("RESULTADO: 4/4 PRUEBAS DE TIMEOUT SUPERADAS CON ÉXITO (EXIT CODE: 0)");
console.log("================================================================");
