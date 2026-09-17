'use strict';

// The browser talks only to AGY. Google sessions and the SGN key stay on servers.
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { registerNotebookEndpointRoutes, createSupabaseStore, validateStored } = require('./notebooklm-endpoint.cjs');
const PREFIX = '/api/notebooklm';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ACTIONS = new Set(['source_url', 'source_pdf', 'podcast', 'report', 'voice', 'news_draft', 'news_publish']);

function hubBase(env) {
  if (!env.HUB_ENDPOINT_URL || !(env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN)) {
    return { error: 'Falta conectar Notebook LM: configura HUB_ENDPOINT_URL y CONEXION_NOTEBOOK_PUENTE en el servidor AGY.' };
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
    : ['action', 'notebookId', 'url', 'filename', 'pdfBase64', 'question', 'confirmed', 'draftId'];
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
  if (output.action === 'news_publish') {
    if (output.confirmed !== true) throw new Error('Revisa el borrador y confirma la publicación antes de continuar.');
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(output.draftId || '')) throw new Error('Borrador no válido.');
    if (['text', 'destination', 'channel', 'channelId', 'chatId'].some(key => Object.hasOwn(body, key))) {
      throw new Error('El texto y el destino de publicación los determina el servidor.');
    }
  }
  return output;
}

function registerNotebookRoutes(app, requirePwd, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpointStore = options.store || options.endpointStore || createSupabaseStore(env, options);
  // This must be mounted before the password-protected proxy below. The
  // endpoint is authenticated with the SGN bridge token, not the IDE pwd.
  registerNotebookEndpointRoutes(app, { ...options, env, fetchImpl, store: endpointStore });
  app.use(PREFIX, requirePwd, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const suffix = req.path.replace(/\/$/, '') || '/status';
    if (!allowedPath(req.method, suffix)) return res.status(404).json({ error: 'Operación Notebook LM no disponible.' });
    const token = env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN;
    if (!token) {
      const config = hubBase(env);
      return res.status(503).json({ configured: false, authenticated: false, error: config.error, message: config.error });
    }
    let registeredEndpoint = null;
    try {
      if (endpointStore && endpointStore.configured !== false) {
        const record = await endpointStore.get();
        if (record) registeredEndpoint = validateStored(record).endpoint;
      }
    } catch {
      // Once Supabase is configured, a read error is not permission to fall
      // back to a stale HUB_ENDPOINT_URL.
      return res.status(503).json({ configured: false, authenticated: false, error: 'No se pudo leer el endpoint Notebook LM registrado.' });
    }
    const config = registeredEndpoint ? { url: registeredEndpoint } : hubBase(env);
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
          'X-SGN-Token': token,
          'X-SGN-Actor': 'ide',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: controller.signal,
      });
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({ error: 'El Hub rechazó la conexión. Revisa que CONEXION_NOTEBOOK_PUENTE coincida en AGY y en el bot Python.' });
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