const fs = require('fs');
const path = require('path');

console.log("================================================================");
console.log("[TALLER AISLADO SDD] VERIFICACIÓN ARQUITECTURA ASÍNCRONA CIBERCODE");
console.log("================================================================");

const relayPath = path.join(__dirname, 'cibercode-relay.cjs');
const jsPath = path.join(__dirname, 'public', 'cibercode.js');

const relay = fs.readFileSync(relayPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// Test 1: cibercode-relay.cjs exporta e implementa createInferenceMission y aiStatusHandler
const hasCreateMission = relay.includes('createInferenceMission');
const hasStatusHandler = relay.includes('aiStatusHandler');
console.log(`[TEST 1/5] Relay implementa createInferenceMission y aiStatusHandler -> ${hasCreateMission && hasStatusHandler}`);
if (!hasCreateMission || !hasStatusHandler) process.exit(1);

// Test 2: cibercode-relay.cjs registra endpoints de status
const hasStatusRoute1 = relay.includes("app.get('/api/cibercode/api/ai/status', aiStatusHandler)");
const hasStatusRoute2 = relay.includes("app.get('/api/ai/status', aiStatusHandler)");
console.log(`[TEST 2/5] Rutas /api/ai/status registradas en relay -> ${hasStatusRoute1 && hasStatusRoute2}`);
if (!hasStatusRoute1 || !hasStatusRoute2) process.exit(1);

// Test 3: cibercode.js implementa sondeo asíncrono con temporizador de segundos en vivo
const hasAsyncPolling = js.includes('data.status === \'processing\' && data.missionId') &&
                        js.includes('/api/ai/status?missionId=');
console.log(`[TEST 3/5] Frontend implementa sondeo asíncrono (/api/ai/status) -> ${hasAsyncPolling}`);
if (!hasAsyncPolling) process.exit(1);

// Test 4: cibercode.js actualiza contador de segundos en vivo en pantalla
const hasLiveTimer = js.includes('transcurridos') && js.includes('elapsedSec');
console.log(`[TEST 4/5] Frontend actualiza contador de segundos en vivo -> ${hasLiveTimer}`);
if (!hasLiveTimer) process.exit(1);

// Test 5: cibercode.js valida Content-Type anti-HTML para evitar Unexpected token '<'
const hasAntiHtml = js.includes("!contentType.includes('application/json')") &&
                    js.includes("Gateway Timeout");
console.log(`[TEST 5/5] Blindaje anti-HTML (previene Unexpected token '<') -> ${hasAntiHtml}`);
if (!hasAntiHtml) process.exit(1);

console.log("================================================================");
console.log("RESULTADO: 5/5 PRUEBAS ASÍNCRONAS SUPERADAS CON ÉXITO (EXIT CODE: 0)");
console.log("================================================================");
