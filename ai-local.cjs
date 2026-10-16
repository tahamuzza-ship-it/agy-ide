'use strict';
const { randomUUID, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const BASE = 'https://yarbis-autonomous-control-production.up.railway.app';
const AGY = 'https://agy-ide-production.up.railway.app';
const PREFIX = 'AGY_INFERENCE_V1:';
function mission(text, id = randomUUID()) {
  return { target: 'PC4', source: 'text', execution_mode: 'foreground',
    instruction: PREFIX + JSON.stringify({ type: 'inference', model: 'qwen-sgn:latest', text, requestId: id }),
    steps: [{ step_index: 1, narration: 'Inferencia PC4', command: 'qwen-sgn:latest' }] };
}
function pc3Command(text) {
  const payload = Buffer.from(JSON.stringify({
    model: 'qwen2.5-coder:14b', prompt: text, stream: false,
    options: { num_predict: 512, num_ctx: 4096, temperature: 0.2 },
  }), 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$b=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'));try{$r=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($b)) -TimeoutSec 110;@{ok=$true;text=$r.response}|ConvertTo-Json -Compress}catch{Write-Output '{"ok":false,"error":"OLLAMA_PC3_FAILED"}'}`;
  const command = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64');
  if (command.length > 4000) throw Error('PC3_TEXT_TOO_LONG');
  return command;
}
function register(app, requirePwd, { env = process.env, fetchImpl = fetch, authMode = 'agy',
  pc4Enabled = env.PC4_INFERENCE_ENABLED === 'true',
  pagePath = path.join(__dirname, 'local-ai.html'),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const jobs = new Map();
  let active = 0;
  async function dispatchHeaders() {
    if (!env.YARBIS_CONSOLE_ACCESS_KEY) throw Error('SERVER_CREDENTIAL_NOT_CONFIGURED');
    const response = await fetchImpl(BASE + '/api/auth/login', {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: env.YARBIS_CONSOLE_ACCESS_KEY }),
      signal: AbortSignal.timeout(15000),
    });
    const cookie = (response.headers.getSetCookie?.() || [])
      .find(value => value.startsWith('yarbis_console_session='))?.split(';')[0];
    await response.body?.cancel();
    if (!response.ok || !cookie) throw Error('YARBIS_AUTH_FAILED');
    return { Cookie: cookie };
  }
  async function remote(base, route, headers, body) {
    const response = await fetchImpl(base + route, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('UPSTREAM_HTTP_' + response.status);
    const data = await response.text();
    if (Buffer.byteLength(data) > 2000000) throw Error('RESPONSE_TOO_LARGE');
    return JSON.parse(data);
  }
  async function execute(job, text, node) {
    try {
      const headers = node === 'PC4'
        ? await dispatchHeaders()
        : { 'x-agyide-pwd': encodeURIComponent(env.AGY_IDE_PASSWORD) };
      let upstream;
      if (node === 'PC4') {
        const capability = await remote(BASE, '/api/inference/capabilities', headers);
        if (capability.protocol !== PREFIX || capability.reservationFilter !== true)
          throw Error('PC4_SERVER_ACTIVATION_PENDING');
        upstream = await remote(BASE, '/api/missions', headers, mission(text));
        job.upstreamId = upstream.id;
        if (!upstream.id) throw Error('MISSION_ID_MISSING');
        await remote(BASE, '/api/missions/' + encodeURIComponent(upstream.id) + '/confirm', headers, { status: 'running' });
      } else {
        upstream = await remote(AGY, '/api/pc3-console/commands', headers, { command: pc3Command(text) });
        job.upstreamId = upstream.id;
        if (!upstream.id) throw Error('COMMAND_ID_MISSING');
      }
      const deadline = Date.now() + 180000;
      for (let i = 0; i < 85 && Date.now() < deadline; i++) {
        await wait(2000);
        const result = await remote(node === 'PC4' ? BASE : AGY,
          (node === 'PC4' ? '/api/missions/' : '/api/pc3-console/commands/') + encodeURIComponent(upstream.id), headers);
        if (['failed', 'error', 'cancelled'].includes(result.status)) throw Error('REMOTE_FAILED');
        if (['completed', 'done'].includes(result.status)) {
          let textResult = result.result;
          if (node === 'PC3') {
            const parsed = JSON.parse(String(result.stdout ?? result.result ?? result.output ?? '').trim());
            if (parsed.ok !== true) throw Error('PC3_INFERENCE_FAILED');
            textResult = parsed.text;
          }
          if (typeof textResult !== 'string' || !textResult.trim()) throw Error('EMPTY_RESPONSE');
          job.status = 'completed'; job.text = textResult.slice(0, 30000); return;
        }
      }
      throw Error('TIMEOUT_DELIVERY_UNCERTAIN');
    } catch (error) {
      job.status = 'failed';
      job.error = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'INFERENCE_FAILED';
    } finally { active--; }
  }
  app.get('/local-ai', (_req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(pagePath);
  });
  app.get('/local-ai.js', (_req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(path.join(path.dirname(pagePath), 'local-ai.js'));
  });
  app.get('/api/local-ai/config', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ authMode, pc4Enabled });
  });
  app.post('/api/local-ai/chat', requirePwd, (req, res) => {
    res.set('Cache-Control', 'no-store');
    for (const [id, job] of jobs) if (Date.now() - job.created > 3600000 && job.status !== 'running') jobs.delete(id);
    const { text, node } = req.body || {};
    if (!['PC3', 'PC4'].includes(node) || typeof text !== 'string' || !text.trim() || text.length > 12000)
      return res.status(400).json({ error: 'INVALID_INPUT' });
    if (node === 'PC3') { try { pc3Command(text); } catch { return res.status(400).json({ error: 'PC3_TEXT_TOO_LONG' }); } }
    if (node === 'PC4' && !pc4Enabled)
      return res.status(503).json({ error: 'PC4_SERVER_ACTIVATION_PENDING' });
    if (node === 'PC4' && !env.YARBIS_CONSOLE_ACCESS_KEY || node === 'PC3' && !env.AGY_IDE_PASSWORD)
      return res.status(503).json({ error: 'SERVER_CREDENTIAL_NOT_CONFIGURED' });
    if (active >= 2 || jobs.size >= 200) return res.status(429).json({ error: 'BUSY' });
    const id = randomUUID(), access = randomUUID();
    const job = { status: 'running', created: Date.now(), node, access };
    jobs.set(id, job); active++;
    void execute(job, text, node);
    res.status(202).json({ id, access, node });
  });
  app.get('/api/local-ai/chat/:id', requirePwd, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = jobs.get(req.params.id);
    if (job && Date.now() - job.created > 3600000) {
      jobs.delete(req.params.id);
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const supplied = String(req.headers['x-inference-access'] || '');
    if (!job || !/^[0-9a-f-]{36}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(job.access)))
      return res.status(404).json({ error: 'NOT_FOUND' });
    const { access, ...safe } = job;
    res.json(safe);
  });
}
module.exports = { register, mission, pc3Command, PREFIX };
