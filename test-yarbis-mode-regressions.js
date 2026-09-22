'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createNotebookClient, fold } = require('./notebooklm-client.cjs');
function loadIntentHelpers() {
  const source = fs.readFileSync('./server.js', 'utf8');
  const semanticStart = source.indexOf('function _mailboxDriveMissionObjective(value) {');
  const semanticEnd = source.indexOf('\nfunction _mailboxLegacyChatIntent', semanticStart);
  const cleanerStart = source.indexOf('function _mailboxCleanDraftObjective(value) {');
  const cleanerEnd = source.indexOf('\nfunction _mailboxNormalizeVoiceMission', cleanerStart);
  const code = source.slice(cleanerStart, cleanerEnd) + '\n' + source.slice(semanticStart, semanticEnd) + '\nmodule.exports={_mailboxSemanticIntent,_mailboxCleanDraftObjective};';
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(code, sandbox);
  return sandbox.module.exports;
}
async function main() {
  const { _mailboxSemanticIntent: intent } = loadIntentHelpers();
  assert.strictEqual(intent('Yarbis, consulta el estado de las misiones. No crees, confirmes ni envíes ninguna.').type, 'mailbox-status');
  const draft = intent('Yarbis, prepara un borrador de misión de prueba que diga: revisar el estado general del sistema. No la confirmes, no la envíes y no la ejecutes.');
  assert.strictEqual(draft.type, 'draft');
  assert.strictEqual(draft.mission, 'revisar el estado general del sistema');
  assert.strictEqual(intent('Yarbis, déjalo preparado para después.').type, 'keep-draft');
  assert.strictEqual(intent('Yarbis, verifica si el borrador anterior fue enviado o ejecutado. No realices ninguna acción.').type, 'draft-status');
  const driveUpload=intent('Yarbis, entrega a Antigravity una misión para subir la nota Informe semanal a Google Drive.');
  assert.strictEqual(driveUpload.type,'draft');
  assert.match(driveUpload.mission,/^ANTIGRAVITY_GOOGLE_DRIVE:/);
  assert.match(driveUpload.mission,/evidencia verificable/);
  const calls=[];
  const client=createNotebookClient({port:3000,password:'test',timeoutSignal:()=>undefined,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({notebooks:[{id:'nb_1',title:'Cuaderno Uno'},{id:'bad id',title:'Descartar'}]})};}});
  const listed=await client.listNotebooks();
  assert.deepStrictEqual(listed,{ok:true,count:1,notebooks:[{id:'nb_1',title:'Cuaderno Uno'}]});
  const itemClient=createNotebookClient({port:3000,password:'test',timeoutSignal:()=>undefined,fetchImpl:async()=>({ok:true,json:async()=>({items:[{uuid:'nb_2',name:'Cuaderno Dos'}]})})});
  assert.deepStrictEqual(await itemClient.listNotebooks(),{ok:true,count:1,notebooks:[{id:'nb_2',title:'Cuaderno Dos'}]});
  assert.strictEqual(fold('CUADERNO Úno'),'cuaderno uno');
  console.log('test-yarbis-mode-regressions: ok');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
