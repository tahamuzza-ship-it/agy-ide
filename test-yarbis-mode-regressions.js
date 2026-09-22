'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createNotebookClient, fold } = require('./notebooklm-client.cjs');
function loadIntentHelpers() {
  const source = fs.readFileSync('./server.js', 'utf8');
  const semanticStart = source.indexOf('function _mailboxSemanticIntent(text) {');
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
  const calls=[];
  const client=createNotebookClient({port:3000,password:'test',timeoutSignal:()=>undefined,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({notebooks:[{id:'nb_1',title:'Cuaderno Uno'},{id:'bad id',title:'Descartar'}]})};}});
  const listed=await client.listNotebooks();
  assert.deepStrictEqual(listed,{ok:true,count:1,notebooks:[{id:'nb_1',title:'Cuaderno Uno'}]});
  assert.strictEqual(fold('CUADERNO Úno'),'cuaderno uno');
  console.log('test-yarbis-mode-regressions: ok');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
