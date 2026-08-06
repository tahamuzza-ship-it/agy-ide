const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const REPLIT_API = 'https://automate-make.replit.app';
const AGY_KEY    = process.env.ANTIGRAVITY_KEY || 'ag-sgn-2026-roberto';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── helpers ── */
async function replitPost(path, body) {
  const r = await fetch(`${REPLIT_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-antigravity-key': AGY_KEY },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function replitGet(path) {
  const r = await fetch(`${REPLIT_API}${path}`, {
    headers: { 'x-antigravity-key': AGY_KEY }
  });
  return r.json();
}

/* ── RUTAS ── */

// Enviar instrucción a AGY
app.post('/api/send', async (req, res) => {
  try {
    const { instruction, target = 'PC1' } = req.body;
    if (!instruction) return res.status(400).json({ error: 'instruction requerida' });
    const prefixed = target === 'ANY'
      ? instruction
      : `[${target}] ${instruction}`;
    const data = await replitPost('/api/antigravity/send', { instruction: prefixed, target });
    res.json(data);
  } catch (e) {
    console.error('[/api/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Consultar resultado por id
app.get('/api/status/:id', async (req, res) => {
  try {
    const data = await replitGet(`/api/antigravity/status/${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estado de PCs (heartbeat público)
app.get('/api/heartbeat', async (_req, res) => {
  try {
    const r = await fetch(`${REPLIT_API}/api/antigravity/heartbeat`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`AGY-IDE ▶  puerto ${PORT}`));
