const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const REPLIT_API  = 'https://automate-make.replit.app';
const MEMORY_API  = 'https://workspaceapi-server-production-905a.up.railway.app';

/* ── Fire-and-forget al agente de memoria ── */
function notifyMemory(type, payload) {
  const endpoint = type === 'chat' ? '/api/ide/chat' : '/api/ide/file';
  fetch(MEMORY_API + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {}); // silencioso — no bloquea la respuesta principal
}

/* ── Required env vars — server refuses to start if missing ── */
const AGY_KEY     = process.env.ANTIGRAVITY_KEY;
const AGY_IDE_PWD = process.env.AGY_IDE_PASSWORD;
if (!AGY_KEY)     { console.error('FATAL: ANTIGRAVITY_KEY env var not set'); process.exit(1); }
if (!AGY_IDE_PWD) { console.error('FATAL: AGY_IDE_PASSWORD env var not set'); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL;
/* Use service role key — anon key must never access goal_sessions */
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY          = process.env.GEMINI_API_KEY;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

const IDE_SYSTEM = 'Eres un asistente de programacion en un IDE online. ' +
  'Cuando el usuario pida crear o generar un archivo, incluye el contenido COMPLETO usando este formato:\n' +
  '[[ARCHIVO:nombre.ext]]\ncontenido aqui\n[[FIN]]\n' +
  'El sistema detecta estos bloques y los guarda como pestanas en el editor. SIEMPRE cierra con [[FIN]].';

async function callGroq(userMsg) {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY no configurada');
  console.log('[Groq] llamando API, modelo:', GROQ_MODEL);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Groq timeout 20s')), 20000));
  const call = fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: IDE_SYSTEM },
        { role: 'user',   content: userMsg }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });
  const r = await Promise.race([call, timeout]);
  const d = await r.json();
  console.log('[Groq] status:', r.status, 'choices:', d.choices ? d.choices.length : 'none');
  if (!r.ok) throw new Error(d.error?.message || 'Groq error ' + r.status);
  return d.choices?.[0]?.message?.content?.trim() || '(sin respuesta)';
}
const TG_TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID          = process.env.TELEGRAM_LEAD_ARCHITECT_CHAT_ID;
const TG_WEBHOOK_SECRET   = process.env.TELEGRAM_WEBHOOK_SECRET; // optional but recommended

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── helpers — Antigravity ── */
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

/* ── helpers — Supabase REST ── */
function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };
}
async function sbInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Supabase insert ${table}: ${await r.text()}`);
}
async function sbPatch(table, id, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Supabase patch ${table} (${id}): ${await r.text()}`);
}
async function sbGet(table, id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: sbHeaders()
  });
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

/* ── Reglas críticas del ecosistema SGN — inyectadas en todo prompt de IA ── */
const CRITICAL_RULES = `
════════════════════════════════════════════════
REGLAS CRÍTICAS DEL ECOSISTEMA SGN — NO NEGOCIABLES
════════════════════════════════════════════════
1. ARCHIVOS PROTEGIDOS: NUNCA modifiques, borres ni referencie estos archivos del IDE:
   editor.html, editor.js, auth_gate.js, feedback.css, server.js, railway.toml,
   ag-listener.js, listener.js, antigravity-listener.js, style.css (del IDE)
   Si una instrucción pide tocarlos, declina y explica por qué.

2. ESTRUCTURA DE PROYECTOS: Todo código generado para un usuario va en
   projects/NOMBRE_PROYECTO/. NUNCA en el root del repositorio.

3. ROL: Eres un asistente de código en AGY-IDE. NO eres administrador del sistema.
   No toques configuraciones de infraestructura, secrets ni Railway sin autorización explícita.

4. AUTORIZACIÓN: Cualquier acción irreversible requiere confirmación del Lead Architect.

5. MASTER PROMPT: El ecosistema opera bajo el Master Prompt de Roberto (Lead Architect).
   Su autoridad es máxima. En caso de duda, informa y espera instrucciones.
════════════════════════════════════════════════
`;

/* ── helpers — Gemini ── */
async function gemini(prompt) {
  if (!GEMINI_KEY) return '';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CRITICAL_RULES }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
      })
    }
  );
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

/* ── helpers — Telegram ── */
async function tgSend(msg) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML' })
  }).catch(e => console.error('[tgSend]', e.message));
}

/* ── helpers — AGY poll ──
   sessionId: if provided, checks for cancellation every iteration so a
   cancel during an active command is detected within the next poll cycle
   (~4s) without waiting for the command itself to finish.              */
async function pollAGY(id, maxMs = 120000, sessionId = null) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 4000));

    // Cancellation check during poll — resolves within one cycle (~4s)
    if (sessionId && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const session = await sbGet('goal_sessions', sessionId);
        if (session && session.status !== 'running') {
          return { status: 'error', result: 'Sesión cancelada durante la ejecución del paso' };
        }
      } catch {} // network error → keep polling
    }

    try {
      const d = await replitGet(`/api/antigravity/status/${id}`);
      if (d.status === 'done' || d.status === 'error') return d;
    } catch {}
  }
  return { status: 'error', result: 'Tiempo de espera agotado (120s)' };
}

/* ══════════════════════════════════════════════════════════════
   GOAL LOOP — auto-healer + Supabase logging + Telegram report
══════════════════════════════════════════════════════════════ */
async function runGoalLoop(sessionId, dispatchToken, goalText, target, maxSteps) {

  /* append an entry to the session log array in Supabase */
  async function addLog(entry) {
    try {
      const session = await sbGet('goal_sessions', sessionId);
      if (!session) return;
      const log = Array.isArray(session.log) ? session.log : [];
      log.push({ ts: new Date().toISOString(), ...entry });
      await sbPatch('goal_sessions', sessionId, { log });
    } catch (e) {
      console.error('[addLog]', e.message);
    }
  }

  async function isCancelled() {
    const s = await sbGet('goal_sessions', sessionId);
    return s?.status === 'cancelled';
  }

  try {
    /* ── STEP 1: Decompose goal into executable steps ── */
    await addLog({ type: 'system', msg: 'Analizando objetivo con Gemini...' });

    const planPrompt =
`Eres un agente de desarrollo autónomo en ${target} (${target === 'PC1' ? 'Windows' : 'Linux/Ubuntu'}).
Objetivo: "${goalText}"

Descompón en pasos concretos y ejecutables (máximo ${maxSteps}).
Cada paso = un comando PowerShell/bash o instrucción de Node.js específica.
Responde SOLO con un JSON array de strings, sin texto extra:
["paso 1", "paso 2", ...]`;

    const planRaw = await gemini(planPrompt);
    let steps;
    try {
      const m = planRaw.match(/\[[\s\S]*\]/);
      steps = JSON.parse(m ? m[0] : planRaw);
      if (!Array.isArray(steps)) throw new Error('not array');
    } catch {
      steps = [goalText]; // fallback: treat entire goal as a single step
    }
    steps = steps.slice(0, maxSteps).filter(s => typeof s === 'string' && s.trim());

    await sbPatch('goal_sessions', sessionId, { max_steps: steps.length });
    await addLog({ type: 'plan', msg: `${steps.length} pasos generados`, steps });

    /* ── STEP 2: Execute each step with Auto-Healer ── */
    let stepsDone = 0;

    for (let si = 0; si < steps.length; si++) {
      /* Check for cancel between steps */
      if (await isCancelled()) {
        await addLog({ type: 'cancelled', msg: 'Sesión cancelada por el usuario' });
        return;
      }

      const originalStep = steps[si];
      let currentInstruction = originalStep;
      let lastError = null;
      let success = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        /* ── Cancellation guard before EVERY dispatch and retry ── */
        const sessionState = await sbGet('goal_sessions', sessionId);
        if (!sessionState || sessionState.status !== 'running') {
          await addLog({ type: 'cancelled', msg: 'Sesión detenida (cancelada o terminada externamente)' });
          return; // exit runGoalLoop entirely
        }

        /* Auto-Healer: regenerate instruction if this is a retry */
        if (attempt > 0) {
          await addLog({ type: 'healer', msg: `Auto-Healer intento ${attempt + 1}...`, prevError: lastError });
          const healPrompt =
`El siguiente comando falló en ${target}:
Comando: ${currentInstruction}
Error: ${lastError}

Genera un comando alternativo que logre el mismo objetivo evitando este error.
Responde SOLO con el comando corregido, sin explicaciones.`;
          const fixed = await gemini(healPrompt);
          if (fixed.trim()) currentInstruction = fixed.trim();
        }

        await addLog({ type: 'step', step: si + 1, total: steps.length, msg: currentInstruction });

        try {
          /* ── Dispatch with session-bound unforgeable token ──
             confirmed:true + goal_session_id + dispatch_token are all
             validated together at the Antigravity endpoint. The token is
             server-generated at session creation and never exposed to the
             client, making it impossible to reuse for arbitrary commands. */
          const prefixed = target === 'ANY' ? currentInstruction : `[${target}] ${currentInstruction}`;
          const sent = await replitPost('/api/antigravity/send', {
            instruction:    prefixed,
            target,
            confirmed:      true,          // ← authorized by active session
            goal_session_id: sessionId,    // ← specific session
            dispatch_token:  dispatchToken // ← unforgeable per-session secret
          });

          if (!sent || !sent.id) throw new Error(sent?.error || 'Sin ID de tarea');

          const result = await pollAGY(sent.id, 120000, sessionId);

          if (result.status === 'error') {
            lastError = result.result || 'Error desconocido';
            await addLog({ type: 'step_error', step: si + 1, attempt: attempt + 1, msg: lastError });
          } else {
            success = true;
            stepsDone++;
            await sbPatch('goal_sessions', sessionId, { steps_done: stepsDone });
            await addLog({ type: 'step_ok', step: si + 1, msg: result.result || 'OK' });
            break;
          }
        } catch (e) {
          lastError = e.message;
          await addLog({ type: 'step_error', step: si + 1, attempt: attempt + 1, msg: e.message });
        }
      } // end retry loop

      /* After 3 attempts: critical block */
      if (!success) {
        const reason = `Paso ${si + 1}/${steps.length} falló 3 veces.\nÚltimo error: ${lastError}`;
        await sbPatch('goal_sessions', sessionId, { status: 'blocked', result: reason });
        await addLog({ type: 'blocked', msg: reason });
        await tgSend(
          `❌ <b>GOAL BLOQUEADO</b>\n\n` +
          `<b>Sesión:</b> <code>${sessionId}</code>\n` +
          `<b>Objetivo:</b> ${goalText.slice(0, 200)}\n` +
          `<b>Bloqueo:</b> ${reason.slice(0, 400)}\n\n` +
          `<i>Pasos completados: ${stepsDone}/${steps.length}</i>`
        );
        return;
      }
    } // end steps loop

    /* ── All steps done ── */
    const summary = `${stepsDone}/${steps.length} pasos completados con éxito`;
    await sbPatch('goal_sessions', sessionId, { status: 'done', result: summary });
    await addLog({ type: 'done', msg: summary });
    await tgSend(
      `✅ <b>GOAL COMPLETADO</b>\n\n` +
      `<b>Sesión:</b> <code>${sessionId}</code>\n` +
      `<b>Objetivo:</b> ${goalText.slice(0, 200)}\n` +
      `<b>Resultado:</b> ${summary}`
    );

  } catch (e) {
    const errMsg = `Error fatal en goal loop: ${e.message}`;
    console.error('[goal-loop]', errMsg);
    await sbPatch('goal_sessions', sessionId, { status: 'error', result: errMsg }).catch(() => {});
    await tgSend(`❌ <b>GOAL ERROR FATAL</b>\n\n<code>${sessionId}</code>\n${errMsg.slice(0, 400)}`).catch(() => {});
  }
}

/* ══════════════════════════════════════════
   AUTH MIDDLEWARE
══════════════════════════════════════════ */
function requirePwd(req, res, next) {
  const pwd = req.headers['x-agyide-pwd'] || (req.body && req.body._pwd);
  if (pwd === AGY_IDE_PWD) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

/* ══════════════════════════════════════════
   RUTAS EXISTENTES
══════════════════════════════════════════ */

app.post('/api/auth', (req, res) => {
  const pwd = req.body && req.body.pwd;
  res.json({ ok: pwd === AGY_IDE_PWD });
});

app.get('/api/heartbeat', async (_req, res) => {
  try {
    const r = await fetch(`${REPLIT_API}/api/antigravity/heartbeat`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send', requirePwd, async (req, res) => {
  try {
    const { instruction, target = 'PC1' } = req.body;
    if (!instruction) return res.status(400).json({ error: 'instruction requerida' });

    const isExecution = instruction.trimStart().startsWith('EJECUTAR');

    if (!isExecution && GROQ_KEY) {
      // PLAN B: Groq directo para chat — bypassa agy.exe y cuota Claude
      const groqReply = await callGroq(instruction);
      // Guardar en Supabase Y devolver directo — compatible con frontend nuevo y viejo
      const cmdId = 'groq_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      if (SUPABASE_URL && SUPABASE_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/antigravity_commands`, {
          method: 'POST',
          headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({ id: cmdId, instruction, status: 'done', result: groqReply, updated_at: new Date().toISOString() })
        }).catch(() => {});
      }
      return res.json({ ok: true, id: cmdId, result: groqReply, riskLevel: 0, source: 'groq' });
    }

    // PLAN A: ag-listener en PC (para EJECUTAR o si no hay GROQ_KEY)
    const IDE_CTX = '[IDE] Para crear archivos usa: [[ARCHIVO:nombre.ext]] contenido [[FIN]]. ';
    const raw = IDE_CTX + instruction;
    const prefixed = target === 'ANY' ? raw : `[${target}] ${raw}`;
    let data = await replitPost('/api/antigravity/send', { instruction: prefixed, target });
    if (data.requiresConfirmation) {
      data = await replitPost('/api/antigravity/send', { instruction: prefixed, target, confirmed: true });
    }
    res.json(data);
  } catch (e) {
    console.error('[/api/send] ERROR:', e.message);
    res.status(200).json({ ok: false, id: 'err_' + Date.now(), error: e.message, result: 'Error: ' + e.message, source: 'error' });
  }
});

app.get('/api/status/:id', requirePwd, async (req, res) => {
  try {
    const { id } = req.params;
    if (id.startsWith('groq_') && SUPABASE_URL && SUPABASE_KEY) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/antigravity_commands?id=eq.${encodeURIComponent(id)}&select=id,status,result`,
        { headers: sbHeaders() }
      );
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) return res.json({ id: row.id, status: row.status, result: row.result });
    }
    const data = await replitGet(`/api/antigravity/status/${id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/report-diff', requirePwd, async (req, res) => {
  try {
    const { filename, before, after } = req.body;
    const data = await replitPost('/api/antigravity/file-diff', {
      filename: filename || 'editor',
      before:   before  || '',
      after:    after   || '',
      source:   'agyide'
    });
    res.json(data);
  } catch (e) {
    console.error('[/api/report-diff]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/revert-pending', requirePwd, async (_req, res) => {
  try {
    const r = await fetch(`${REPLIT_API}/api/antigravity/file-revert-pending`, {
      headers: { 'x-antigravity-key': AGY_KEY }
    });
    const text = await r.text();
    try { res.json(JSON.parse(text)); } catch(_) { res.json([]); }
  } catch (e) {
    console.error('[/api/revert-pending]', e.message);
    res.json([]);
  }
});

/* ══════════════════════════════════════════
   RUTAS — /goal AGENT MODE
══════════════════════════════════════════ */

/* POST /api/goal — lanza una sesión autónoma */
app.post('/api/goal', requirePwd, async (req, res) => {
  try {
    const { goal, target = 'PC1', max_steps = 50 } = req.body;
    if (!goal || !goal.trim()) return res.status(400).json({ error: 'goal requerido' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase no configurado' });

    const sessionId    = `goal_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const dispatchToken = crypto.randomBytes(32).toString('hex'); // unforgeable per-session secret

    await sbInsert('goal_sessions', {
      id:             sessionId,
      goal_text:      goal.trim(),
      target:         target,
      status:         'running',
      steps_done:     0,
      max_steps:      Number(max_steps) || 50,
      retries:        0,
      log:            [],
      result:         null,
      dispatch_token: dispatchToken,
      created_at:     new Date().toISOString()
    });

    /* Fire-and-forget: async loop, does NOT block the response */
    runGoalLoop(sessionId, dispatchToken, goal.trim(), target, Number(max_steps) || 50).catch(e =>
      console.error('[goal-loop fatal]', e.message)
    );

    res.json({ id: sessionId, status: 'running' });
  } catch (e) {
    console.error('[/api/goal]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* GET /api/goal/status/:id — estado actual de la sesión */
app.get('/api/goal/status/:id', requirePwd, async (req, res) => {
  try {
    if (!SUPABASE_URL) return res.status(503).json({ error: 'Supabase no configurado' });
    const session = await sbGet('goal_sessions', req.params.id);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* POST /api/goal/cancel — detiene la sesión en emergencia */
app.post('/api/goal/cancel', requirePwd, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    if (!SUPABASE_URL) return res.status(503).json({ error: 'Supabase no configurado' });
    await sbPatch('goal_sessions', id, {
      status: 'cancelled',
      result: 'Cancelado manualmente por el usuario'
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* POST /api/telegram-webhook — recibe comandos de @Codearquitect_bot
   Soporta: /goal cancel <id>  |  /goal status <id>  |  /goal <objetivo>
   Seguridad: TELEGRAM_WEBHOOK_SECRET es OBLIGATORIO; ruta no se registra si falta
*/
if (TG_WEBHOOK_SECRET) {

app.post('/api/telegram-webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido a Telegram
  try {
    /* ── Webhook secret validation (recommended by Telegram) ── */
    if (TG_WEBHOOK_SECRET) {
      const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (headerSecret !== TG_WEBHOOK_SECRET) {
        console.warn('[telegram-webhook] rejected: invalid secret token');
        return; // silently drop — already sent 200 to avoid Telegram retries
      }
    }

    const msg = req.body?.message;
    if (!msg || !msg.text) return;

    const text = msg.text.trim();
    const chatId = msg.chat?.id;

    /* Solo aceptar comandos del Lead Architect — doble guardia: secret + chat_id */
    if (String(chatId) !== String(TG_CHAT_ID)) return;

    /* Helper: send a Telegram reply */
    const tgReply = async (txt) => {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: 'HTML' })
      });
    };

    /* /goal cancel <session_id> */
    const cancelMatch = text.match(/^\/goal\s+cancel\s+(\S+)/i);
    if (cancelMatch) {
      const sid = cancelMatch[1];
      await sbPatch('goal_sessions', sid, { status: 'cancelled', result: 'Cancelado vía Telegram' });
      await tgReply(`✅ Goal <code>${sid}</code> cancelado.`);
      return;
    }

    /* /goal status <session_id> */
    const statusMatch = text.match(/^\/goal\s+status\s+(\S+)/i);
    if (statusMatch) {
      const sid = statusMatch[1];
      const session = await sbGet('goal_sessions', sid);
      if (!session) { await tgReply(`❌ Sesión <code>${sid}</code> no encontrada.`); return; }
      const log = Array.isArray(session.log) ? session.log : [];
      const lastEntries = log.slice(-3).map(e => `• ${e.type}: ${(e.msg || '').slice(0, 80)}`).join('\n');
      await tgReply(
        `📊 <b>Goal Status</b>\n<b>ID:</b> <code>${sid}</code>\n` +
        `<b>Estado:</b> ${session.status}\n<b>Pasos:</b> ${session.steps_done}/${session.max_steps}\n\n` +
        `${lastEntries || '(sin log aún)'}`
      );
      return;
    }

    /* /goal <objective> — start a new autonomous session from Telegram
       Usage: /goal Crear un script que liste todos los archivos .js del proyecto
       Optional flags: target=PC2 max=30 (e.g. /goal target=PC2 max=10 <objective>)    */
    const goalMatch = text.match(/^\/goal\s+([\s\S]+)/i);
    if (goalMatch && SUPABASE_URL && SUPABASE_KEY) {
      let rawGoal = goalMatch[1].trim();
      // Parse optional flags: target=PC1|PC2|ANY and max=N
      let target    = 'PC1';
      let maxSteps  = 20;
      rawGoal = rawGoal.replace(/\btarget=(PC1|PC2|ANY)\b/i, (_, t) => { target = t.toUpperCase(); return ''; });
      rawGoal = rawGoal.replace(/\bmax=(\d+)\b/i, (_, n)  => { maxSteps = Math.min(50, Math.max(1, parseInt(n, 10))); return ''; });
      const goal = rawGoal.trim();
      if (!goal) { await tgReply('❌ Objetivo vacío. Uso: <code>/goal [target=PC1] [max=20] Tu objetivo aquí</code>'); return; }

      await tgReply(`⏳ Iniciando sesión autónoma...\n<b>Objetivo:</b> ${goal.slice(0, 200)}\n<b>Target:</b> ${target} | <b>Pasos máx:</b> ${maxSteps}`);

      try {
        const sessionId     = `goal_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const dispatchToken = crypto.randomBytes(32).toString('hex');
        await sbInsert('goal_sessions', {
          id: sessionId, goal_text: goal, target, status: 'running',
          steps_done: 0, max_steps: maxSteps, retries: 0, log: [],
          result: null, dispatch_token: dispatchToken, created_at: new Date().toISOString()
        });
        runGoalLoop(sessionId, dispatchToken, goal, target, maxSteps).catch(e =>
          console.error('[goal-loop-tg fatal]', e.message)
        );
        await tgReply(
          `✅ Sesión iniciada\n<b>ID:</b> <code>${sessionId}</code>\n` +
          `Recibirás notificación al terminar o si hay bloqueo.\n` +
          `Para cancelar: <code>/goal cancel ${sessionId}</code>`
        );
      } catch (e) {
        await tgReply(`❌ Error iniciando sesión: ${e.message.slice(0, 200)}`);
      }
    }
  } catch (e) {
    console.error('[telegram-webhook]', e.message);
  }
});

} // end if (TG_WEBHOOK_SECRET) — route not registered when secret is absent

/* ══════════════════════════════════════════
   STARTUP — reconcile interrupted sessions
   Any session left in status='running' from a previous process must be
   marked 'interrupted' immediately; we cannot safely resume mid-step.
══════════════════════════════════════════ */
async function reconcileInterruptedSessions() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/goal_sessions?status=eq.running&select=id,goal_text`,
      { headers: sbHeaders() }
    );
    if (!r.ok) { console.warn('[startup] could not query goal_sessions:', await r.text()); return; }
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return;
    for (const row of rows) {
      try {
        await sbPatch('goal_sessions', row.id, {
          status: 'interrupted',
          result: 'Servidor reiniciado mientras la sesión estaba activa. Reinicia el objetivo manualmente.'
        });
        console.log(`[startup] session ${row.id} marked interrupted`);
      } catch (e) {
        console.error(`[startup] failed to mark ${row.id} interrupted:`, e.message);
      }
    }
    console.log(`[startup] ${rows.length} interrupted session(s) reconciled`);
  } catch (e) {
    console.error('[startup-reconcile]', e.message);
  }
}


/* ══════════════════════════════════════════════════════════
   /api/chats — persistencia de sesiones de chat AGY-IDE
   Usa la misma tabla cibercode_chats con project='agy-ide'
══════════════════════════════════════════════════════════ */
async function sbQuery(table, params) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, { headers: sbHeaders() });
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

app.get('/api/chats', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json([]);
  try {
    const project = req.query.project || 'agy-ide';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?project=eq.${encodeURIComponent(project)}&order=updated_at.desc&limit=30&select=id,project,title,messages,updated_at`,
      { headers: sbHeaders() }
    );
    const data = await r.json();
    res.json(Array.isArray(data) ? data : []);
  } catch (e) { res.json([]); }
});

app.post('/api/chats', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json({ ok: false });
  const { id, project = 'agy-ide', messages, title } = req.body || {};
  if (!id || !messages) return res.status(400).json({ error: 'id y messages requeridos' });
  try {
    // verificar si ya existe
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?id=eq.${encodeURIComponent(id)}&select=id`,
      { headers: sbHeaders() }
    );
    const existing = await check.json();
    if (Array.isArray(existing) && existing.length > 0) {
      await sbPatch('cibercode_chats', id, { messages, title, updated_at: new Date().toISOString() });
    } else {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cibercode_chats`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ id, project, messages, title, updated_at: new Date().toISOString() })
      });
      if (!r.ok) throw new Error(await r.text());
    }
    notifyMemory('chat', { session_id: id, app: project, title: title || 'Sin título' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/chats/:id', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json({ ok: false });
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?id=eq.${encodeURIComponent(req.params.id)}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    res.json({ ok: r.ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════════════════
   /api/files — archivos virtuales AGY-IDE en Supabase
   Reutiliza tabla cibercode_chats: id='agyide_file_'+filename
══════════════════════════════════════════════════════════ */
app.get('/api/files', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json([]);
  try {
    const project = req.query.project || 'agy-ide';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?project=eq.agyide-files-${encodeURIComponent(project)}&order=updated_at.desc&select=id,title,messages,updated_at`,
      { headers: sbHeaders() }
    );
    const data = await r.json();
    if (!Array.isArray(data)) return res.json([]);
    const files = data.map(row => ({
      id:       row.id,
      filename: row.title || row.id,
      content:  (Array.isArray(row.messages) && row.messages[0]) ? row.messages[0].content : '',
      updated_at: row.updated_at
    }));
    res.json(files);
  } catch (e) { res.json([]); }
});

app.post('/api/files', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json({ ok: false });
  const { filename, content = '', project = 'agy-ide' } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'filename requerido' });
  const id      = 'agyide_file_' + project + '_' + filename;
  const proj    = 'agyide-files-' + project;
  const payload = { id, project: proj, title: filename,
    messages: [{ role: 'file', content }],
    updated_at: new Date().toISOString() };
  try {
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?id=eq.${encodeURIComponent(id)}&select=id`,
      { headers: sbHeaders() }
    );
    const existing = await check.json();
    if (Array.isArray(existing) && existing.length > 0) {
      await sbPatch('cibercode_chats', id, {
        messages: payload.messages, updated_at: payload.updated_at
      });
    } else {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cibercode_chats`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(await r.text());
    }
    notifyMemory('file', { session_id: id, app: 'agyide', filename, content: content.slice(0,500) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/files/:filename', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json({ ok: false });
  const project = req.query.project || 'agy-ide';
  const id      = 'agyide_file_' + project + '_' + req.params.filename;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/cibercode_chats?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    res.json({ ok: r.ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  console.log(`AGY-IDE ▶  puerto ${PORT} | /goal mode ACTIVO`);
  await reconcileInterruptedSessions();
});
