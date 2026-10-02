'use strict';
const { LIMITS, PATHS, response, errorResponse, fail } = require('./policy.cjs');

// No server.listen, logger, reverse proxy or application wiring is included.
function nodeHandler(engine) {
  return async (req, res) => {
    let output;
    try {
      const sensitive = new Set(['host', 'origin', 'authorization', 'x-agy-operator-token',
        'mcp-session-id', 'mcp-protocol-version', 'content-type', 'content-length']);
      const seen = new Set();
      for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
        const key = req.rawHeaders[i].toLowerCase();
        if (sensitive.has(key) && seen.has(key)) fail(400, 'CABECERA_DUPLICADA');
        seen.add(key);
      }
      if (req.url?.includes('?')) fail(400, 'QUERY_NO_ADMITIDA');
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > LIMITS.requestBytes) fail(413, 'PETICION_EXCESIVA');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type']?.split(';')[0].trim();
      let body;
      if (raw) {
        if (type === 'application/x-www-form-urlencoded') {
          if (req.url === PATHS.approve) {
            const entries = [...new URLSearchParams(raw)];
            if (new Set(entries.map(([k]) => k)).size !== entries.length) fail(400, 'ARGUMENTOS_INVALIDOS');
            body = Object.fromEntries(entries);
          } else body = raw; // Local callback parses its own form.
        } else if (type === 'application/json') {
          try { body = JSON.parse(raw); }
          catch { output = response(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); }
        } else fail(415, 'TIPO_NO_ADMITIDO');
      }
      if (!output) output = await engine.handle({
        method: req.method, path: req.url, headers: req.headers, body, remoteAddress: req.socket?.remoteAddress,
      });
    } catch (error) { output = errorResponse(error); }
    res.writeHead(output.status, output.headers);
    res.end(typeof output.body === 'string' ? output.body : JSON.stringify(output.body));
  };
}
module.exports = { nodeHandler };