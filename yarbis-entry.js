const http = require('http');
const { attachYarbisLive } = require('./yarbis-live');

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