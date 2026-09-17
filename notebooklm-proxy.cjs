'use strict';

// The browser talks only to AGY. Google sessions and the SGN key stay on servers.
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const PREFIX = '/api/notebooklm';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ACTIONS = new Set(['source_url', 'source_pdf', 'podcast', 'report', 'voice', 'news']);

function hubBase(env) {
  if (!env.HUB_ENDPOINT_URL || !env.SGN_SECRET_TOKEN) {
    return { error: 'Falta conectar Notebook LM: configura HUB_ENDPOINT_URL y SGN_SECRET_TOKEN en el servidor AGY.' };
  }
  try {
    const url = new URL(env.HUB_ENDPOINT_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return { url: url.href.replace(/\/+$/, '') };
  } catch {
    return { error: 'HUB_ENDPOINT_URL debe ser la dirección HTTPS del túnel, sin credenciales ni parámetros.' };
  }
}

function allowedPath(method, suffix) {
  if (method === 'GET' && ['', '/status', '/nodes', '/notebooks', '/sources'].includes(suffix)) return true;
  if (method === 'POST' && ['/notebooks', '/jobs'].includes(suffix)) return true;
  if (method === 'PUT' && suffix === '/active') return true;
  const match = suffix.match(/^\/(jobs|files)\/([^/]+)$/);
  return method === 'GET' && !!match && ID.test(match[2]);
}

function sanitizedBody(suffix, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Solicitud no válida.');
  const output = {};
  const keys = suffix === '/notebooks' ? ['title'] : suffix === '/active' ? ['notebookId']
    : ['action', 'notebookId', 'url', 'filename', 'pdfBase64', 'question', 'confirmed'];
  for (const key of keys) {
    if (body[key] === undefined) continue;
    if (key === 'confirmed') {
      output[key] = body[key] === true;
    } else if (typeof body[key] !== 'string') {
      throw new Error(`El campo ${key} debe ser texto.`);
    } else {
      const limit = key === 'pdfBase64' ? Math.ceil(4 * 1024 * 1024 / 3) * 4
        : key === 'question' ? 12000 : key === 'url' ? 4096 : 300;
      if (body[key].length > limit) throw new Error(`El campo ${key} es demasiado grande.`);
      output[key] = body[key];
    }
  }
  if (output.notebookId && !ID.test(output.notebookId)) throw new Error('Cuaderno no válido.');
  if (suffix === '/jobs' && !ACTIONS.has(output.action)) throw new Error('Acción no válida.');
  if (output.action === 'news' && output.confirmed !== true) throw new Error('Confirma la publicación en el canal antes de continuar.');
  return output;
}

function registerNotebookRoutes(app, requirePwd, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  app.use(PREFIX, requirePwd, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const suffix = req.path.replace(/\/$/, '') || '/status';
    if (!allowedPath(req.method, suffix)) return res.status(404).json({ error: 'Operación Notebook LM no disponible.' });
    const config = hubBase(env);
    if (config.error) return res.status(503).json({ configured: false, authenticated: false, error: config.error, message: config.error });
    let body;
    try {
      if (req.method !== 'GET') body = sanitizedBody(suffix, req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const url = new URL(`${config.url}${PREFIX}${suffix}`);
    if (suffix === '/sources' && req.query.notebookId) {
      if (typeof req.query.notebookId !== 'string' || !ID.test(req.query.notebookId)) {
        return res.status(400).json({ error: 'Cuaderno no válido.' });
      }
      url.searchParams.set('notebookId', req.query.notebookId);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), suffix.startsWith('/files/') ? 120000 : 45000);
    res.once('close', () => controller.abort());
    try {
      const upstream = await fetchImpl(url, {
        method: req.method,
        headers: {
          Accept: suffix.startsWith('/files/') ? '*/*' : 'application/json',
          'Content-Type': 'application/json',
          'X-SGN-Token': env.SGN_SECRET_TOKEN,
          'X-SGN-Actor': 'ide',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: controller.signal,
      });
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({ error: 'El Hub rechazó la conexión. Revisa que SGN_SECRET_TOKEN coincida en AGY y en el bot Python.' });
      }
      if (suffix.startsWith('/files/') && upstream.ok) {
        const type = upstream.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', ['audio/mpeg', 'audio/mp3', 'text/plain; charset=utf-8', 'text/plain', 'application/pdf'].includes(type) ? type : 'application/octet-stream');
        // Never reflect upstream filenames or executable content inline.
        res.setHeader('Content-Disposition', `attachment; filename="notebooklm.${type.startsWith('audio/') ? 'mp3' : type.startsWith('text/') ? 'txt' : 'bin'}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return await pipeline(Readable.fromWeb(upstream.body), res);
      }
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch {
        return res.status(502).json({ error: 'El túnel no respondió con la API Notebook LM. Comprueba su destino y que el bot Python esté encendido.' });
      }
      // No raw traceback or infrastructure error body is exposed to the browser.
      if (upstream.status >= 500) {
        return res.status(502).json({ error: 'Notebook LM no pudo completar la operación. Revisa la sesión de Google y el servicio Python.' });
      }
      return res.status(upstream.status).json(data);
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'No se pudo contactar con el Hub HTTPS. Comprueba el túnel y el servicio Python. No se ha reenviado la operación.' });
    } finally {
      clearTimeout(timeout);
    }
  });
}

module.exports = { registerNotebookRoutes, hubBase, allowedPath, sanitizedBody };