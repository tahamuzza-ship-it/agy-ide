'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const generatedPath = path.join(__dirname, '.yarbis-runtime.generated.cjs');
const hex = [1, 2, 3]
  .map((part) => fs.readFileSync(path.join(__dirname, `yarbis-runtime.${part}.hex`), 'utf8').trim())
  .join('');
fs.writeFileSync(generatedPath, Buffer.from(hex, 'hex'));

const { attachYarbisLive } = require(generatedPath);

function prepareYarbisHtml(input) {
  let prepared = input.replace(
    /href="style\.css(?:\?v=\d+)?"/,
    'href="style.css?v=6"'
  );
  const bootstrapPattern = new RegExp(
    '(<' + 'script id="yarbis-bootstrap" src="/yarbis\\.js)(?:\\?v=\\d+)?("><\\/' + 'script>)'
  );
  prepared = prepared.replace(bootstrapPattern, '$1?v=18$2');
  if (!prepared.includes('id="yarbis-bootstrap"')) {
    const marker =
      '<' + 'script id="yarbis-bootstrap" src="/yarbis.js?v=18"></' + 'script>';
    const closingBody = prepared.toLowerCase().lastIndexOf('</body>');
    if (closingBody < 0) {
      throw new Error('No se encontro el cierre real de body para Yarbis');
    }
    prepared = prepared.slice(0, closingBody) + marker + prepared.slice(closingBody);
  }
  return prepared;
}

const indexPath = path.join(__dirname, 'public', 'index.html');
const html = prepareYarbisHtml(fs.readFileSync(indexPath, 'utf8'));
fs.writeFileSync(indexPath, html, 'utf8');

const originalListen = http.Server.prototype.listen;
let attached = false;
http.Server.prototype.listen = function yarbisListen(...args) {
  if (!attached) {
    attached = true;
    attachYarbisLive(this);
  }
  return originalListen.apply(this, args);
};

require('./server');