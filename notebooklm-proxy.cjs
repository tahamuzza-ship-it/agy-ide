'use strict';

// The browser talks only to AGY. Google sessions and the SGN key stay on servers.
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { registerNotebookEndpointRoutes, createSupabaseStore } = require('./notebooklm-endpoint.cjs');
const { createNotebookRouter } = require('./notebooklm-router.cjs');
const PREFIX = '/api/notebooklm';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ACTIONS = new Set(['source_url', 'source_pdf', 'podcast', 'report', 'voice', 'news_draft', 'news_publish', 'notebook_ask', 'notebook_research']);

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
  if (method === 'GET' && ['', '/status', '/nodes', '/notebooks', '/sources', '/jobs', '/routing'].includes(suffix)) return true;
  if (method === 'POST' && ['/notebooks', '/jobs'].includes(suffix)) return true;
  if (method === 'PUT' && suffix === '/active') return true;
  const match = suffix.match(/^\/(jobs|files)\/([^/]+)$/);
  return method === 'GET' && !!match && ID.test(match[2]);
}

function sanitizedBody(suffix, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Solicitud no válida.');
  const output = {};
  const keys = suffix === '/notebooks' ? ['title'] : suffix === '/active' ? ['notebookId'] : suffix === '/routing' ? ['route']
    : ['action', 'notebookId', 'url', 'filename', 'pdfBase64', 'question', 'topic', 'requestId', 'confirmed', 'draftId'];
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
  if (output.action === 'notebook_ask') {
    if (!output.notebookId || !String(output.question || '').trim()) throw new Error('Cuaderno y pregunta son obligatorios.');
  }
  if (output.action === 'notebook_research') {
    if (!String(output.topic || '').trim()) throw new Error('El tema de investigación es obligatorio.');
    if (output.requestId && !ID.test(output.requestId)) throw new Error('Identificador de solicitud no válido.');
  }
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
  // NotebookLM operations are always cloud-only. A missing/disabled cloud
  // configuration must produce an explicit router error, never a legacy
  // registered-endpoint or Hub transport.
  const router = options.router || createNotebookRouter({ ...options, env, fetchImpl });
  // This must be mounted before the password-protected proxy below. The
  // endpoint is authenticated with the SGN bridge token, not the IDE pwd.
  registerNotebookEndpointRoutes(app, { ...options, env, fetchImpl, store: endpointStore });
  app.use(PREFIX, requirePwd, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const suffix = req.path.replace(/\/$/, '') || '/status';
    if (!allowedPath(req.method, suffix)) return res.status(404).json({ error: 'Operación Notebook LM no disponible.' });
    const token = env.CONEXION_NOTEBOOK_PUENTE || env.SGN_SECRET_TOKEN;
    if (!token) {
      const error = 'NotebookLM Cloud no está configurado: falta el token de conexión cloud.';
      return res.status(503).json({
        configured: false, cloud: false, authenticated: false, code: 'CLOUD_CONFIGURATION_REQUIRED',
        error, message: error,
      });
    }
    let body;
    try {
      if (req.method !== 'GET') body = sanitizedBody(suffix, req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (router) {
      let routed;
      try {
        routed = await router.dispatch({ method: req.method, suffix, query: req.query || {}, body });
      } catch {
        return res.status(503).json({ error: 'No se pudo acceder al router Notebook LM.', code: 'ROUTER_UNAVAILABLE' });
      }
      if (routed.route) res.setHeader('X-NotebookLM-Route', routed.route);
      if (routed.local) return res.status(routed.status).json(routed.data);
      const upstream = routed.response;
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({ error: `La ruta ${routed.route} rechazó la conexión.`, route: routed.route });
      }
      if (suffix.startsWith('/files/') && upstream.ok) {
        const type = upstream.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', ['audio/mpeg', 'audio/mp3', 'text/plain; charset=utf-8', 'text/plain', 'application/pdf'].includes(type) ? type : 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="notebooklm.${type.startsWith('audio/') ? 'mp3' : type.startsWith('text/') ? 'txt' : 'bin'}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return await pipeline(Readable.fromWeb(upstream.body), res);
      }
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch {
        return res.status(502).json({ error: `La ruta ${routed.route} no respondió con la API Notebook LM.`, route: routed.route });
      }
      if (upstream.status >= 500) {
        return res.status(502).json({ error: `Notebook LM no pudo completar la operación en ${routed.route}.`, route: routed.route });
      }
      if (!Array.isArray(data) && data && typeof data === 'object' && data.route === undefined) data.route = routed.route;
      return res.status(upstream.status).json(data);
    }
  });
}

module.exports = { registerNotebookRoutes, hubBase, allowedPath, sanitizedBody };