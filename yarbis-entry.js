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