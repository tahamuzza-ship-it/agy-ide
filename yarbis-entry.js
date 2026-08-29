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

const indexPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
  /href="style\.css(?:\?v=\d+)?"/,
  'href="style.css?v=3"'
);
if (!html.includes('id="yarbis-bootstrap"')) {
  const marker =
    '<' + 'script id="yarbis-bootstrap" src="/yarbis.js?v=12"></' + 'script>';
  const closingBody = html.toLowerCase().lastIndexOf('</body>');
  if (closingBody < 0) {
    throw new Error('No se encontro el cierre real de body para Yarbis');
  }
  html = html.slice(0, closingBody) + marker + html.slice(closingBody);
}
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