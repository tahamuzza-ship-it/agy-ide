const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const REPLIT_API  = 'https://automate-make.replit.app';
const AGY_KEY     = process.env.ANTIGRAVITY_KEY || 'ag-sgn-2026-roberto';
const AGY_IDE_PWD = process.env.AGY_IDE_PASSWORD || 'sgn2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── helpers ── */
async function replitPost(p, body) {
  const r = await fetch(`${REPLIT_API}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-antigravity-key': AGY_KEY },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function replitGet(p) {
  const r = await fetch(`${REPLIT_API}${p}`, {
    headers: { 'x-antigravity-key': AGY_KEY }
  });
  return r.json();
}

/* ── Auth middleware ── */
function requirePwd(req, res, next) {
  const pwd = req.headers['x-agyide-pwd'] || (req.body && req.body._pwd);
  if (pwd === AGY_IDE_PWD) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

/* ── RUTAS ── */

// Verificar contraseña
app.post('/api/auth', (req, res) => {
  const pwd = req.body && req.body.pwd;
  res.json({ ok: pwd === AGY_IDE_PWD });
});

// Heartbeat — público (solo estado de PCs, sin info sensible)
app.get('/api/heartbeat', async (_req, res) => {
  try {
    const r = await fetch(`${REPLIT_API}/api/antigravity/heartbeat`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enviar instrucción a AGY — protegido
app.post('/api/send', requirePwd, async (req, res) => {
  try {
    const { instruction, target = 'PC1' } = req.body;
    if (!instruction) return res.status(400).json({ error: 'instruction requerida' });
    const prefixed = target === 'ANY' ? instruction : `[${target}] ${instruction}`;
    const data = await replitPost('/api/antigravity/send', { instruction: prefixed, target });
    res.json(data);
  } catch (e) {
    console.error('[/api/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Consultar resultado — protegido
app.get('/api/status/:id', requirePwd, async (req, res) => {
  try {
    const data = await replitGet(`/api/antigravity/status/${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`AGY-IDE ▶  puerto ${PORT}`));
