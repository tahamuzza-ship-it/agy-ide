const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const REPLIT_API  = 'https://automate-make.replit.app';
const MEMORY_API  = 'https://workspaceapi-server-production-905a.up.railway.app';

/* ── Fire-and-forget al agente de memoria ── */
function notifyMemory(type, payload) {
  const endpoint = type === 'chat' ? '/api/ide/chat' : '/api/ide/file';
  // La memoria rechaza nombres de app con guiones (check constraint): normalizar a minúsculas alfanuméricas
  if (payload && payload.app) payload.app = String(payload.app).toLowerCase().replace(/[^a-z0-9]/g, '');
  fetch(MEMORY_API + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => { if (!r.ok) console.error(`[memoria] ${endpoint} HTTP ${r.status}`); })
    .catch(() => {}); // silencioso — no bloquea la respuesta principal
}

/* ── Required env vars — server refuses to start if missing ── */
const AGY_KEY     = process.env.ANTIGRAVITY_KEY;
const AGY_IDE_PWD = process.env.AGY_IDE_PASSWORD;
if (!AGY_KEY)     { console.error('FATAL: ANTIGRAVITY_KEY env var not set'); process.exit(1); }
if (!AGY_IDE_PWD) { console.error('FATAL: AGY_IDE_PASSWORD env var not set'); process.exit(1); }

/* Base del IDE (Supabase 2, donde vive cibercode_chats). Acepta SUPABASE_URL_2 o
   SUPABASE_URL si coincide con el proyecto 2. El fallback garantiza el proyecto correcto
   incluso si la variable de entorno no está seteada. Nota: SUPABASE_URL (sin sufijo _2)
   apunta a crpsnlonpmgwatjpyzkm (Supabase 1) — no usarlo para cibercode_chats. */
const SUPABASE_URL = (process.env.SUPABASE_URL_2 || 'https://lxlcivzuevowckbcxczc.supabase.co')
  .replace(/\/$/, '');
/* Use service role key — anon key must never access goal_sessions */
/* Supabase 2 key: Railway debe tener SUPABASE_KEY_2 = service_role de lxlcivzuevowckbcxczc */
const SUPABASE_KEY = process.env.SUPABASE_KEY_2 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY          = process.env.GEMINI_API_KEY;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

const IDE_SYSTEM = 'Eres un asistente de programacion en un IDE online. ' +
  'Cuando el usuario pida crear o generar un archivo, incluye el contenido COMPLETO usando este formato:\n' +
  '[[ARCHIVO:nombre.ext]]\ncontenido aqui\n[[FIN]]\n' +
  'El sistema detecta estos bloques y los guarda como pestanas en el editor. SIEMPRE cierra con [[FIN]].\n' +
  'ESTILO DE RESPUESTA: responde CORTO y directo, maximo 500 caracteres, en lenguaje sencillo y amistoso, sin listas largas ni parrafadas. ' +
  'Solo puedes extenderte si el usuario pide explicitamente detalle, un manual, o el contenido de un archivo (los bloques [[ARCHIVO:...]] no cuentan para el limite).';

async function callAI(userMsg) {
  console.log('[callAI] inicio, GEMINI_KEY presente:', !!GEMINI_KEY, 'GROQ_KEY presente:', !!GROQ_KEY);
  if (!GEMINI_KEY && !GROQ_KEY) throw new Error('Sin API key de IA configurada');

  const aiTimeout = () => new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`IA sin respuesta en ${Math.round(CFG.limites.ia_timeout_ms / 1000)}s — verifique API key`)), CFG.limites.ia_timeout_ms));

  if (GEMINI_KEY) {
    try {
    const geminiCall = fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + CFG.modelos.gemini_chat + ':generateContent?key=' + GEMINI_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt('chat') }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: CFG.limites.chat_max_tokens, temperature: CFG.limites.chat_temperature }
        })
      }
    );
    const r = await Promise.race([geminiCall, aiTimeout()]);
    const d = await r.json();
    console.log('[callAI] Gemini status:', r.status);
    if (!r.ok) throw new Error((d.error && d.error.message) || 'Gemini error ' + r.status);
    return (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0] && d.candidates[0].content.parts[0].text) || '(sin respuesta)';
    } catch (geminiErr) {
      console.error('[callAI] Gemini falló:', geminiErr.message);
      if (!GROQ_KEY) throw geminiErr;
      // Fallback automático a Groq
    }
  }

  const groqCall = fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CFG.modelos.groq,
      messages: [{ role: 'system', content: buildSystemPrompt('chat') }, { role: 'user', content: userMsg }],
      max_tokens: CFG.limites.chat_max_tokens
    })
  });
  const r = await Promise.race([groqCall, aiTimeout()]);
  const d = await r.json();
  console.log('[callAI] Groq status:', r.status);
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq error ' + r.status);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '(sin respuesta)';
}
const TG_TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID          = process.env.TELEGRAM_LEAD_ARCHITECT_CHAT_ID;
const TG_WEBHOOK_SECRET   = process.env.TELEGRAM_WEBHOOK_SECRET; // optional but recommended

app.use(express.json({ limit: '8mb' }));
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

/* ══════════════════════════════════════════
   ALMA (soul.md) + CONFIG CENTRAL (config.yaml) + MANUAL MAESTRO
   Se cargan al arrancar y se inyectan en TODO prompt de IA.
══════════════════════════════════════════ */
function _readFirst(candidates) {
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch {}
  }
  return '';
}

/* Mini-parser YAML (2 niveles, escalares) — sin dependencias nuevas */
function _miniYaml(text) {
  const out = {};
  let section = null;
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (!indented) {
      if (val === '') { section = key; out[key] = out[key] || {}; }
      else { section = null; out[key] = _yamlScalar(val); }
    } else if (section) {
      out[section][key] = _yamlScalar(val);
    }
  }
  return out;
}
function _yamlScalar(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

/* Candidatos de ruta: Railway (server.js en el root, archivos al lado) */
function _candidates(name) {
  return [
    path.join(__dirname, name),
    path.join(process.cwd(), name)
  ];
}
const SOUL = _readFirst(_candidates('soul.md')).trim();

const MANUAL = _readFirst([
  ..._candidates('MANUAL_ECOSISTEMA_SGN.md'),
  path.join(__dirname, 'docs/MANUAL_ECOSISTEMA_SGN.md'),
  path.join(process.cwd(), 'docs/MANUAL_ECOSISTEMA_SGN.md')
]).trim();

const _cfgRaw = _miniYaml(_readFirst(_candidates('config.yaml')));
/* Defaults = los valores que antes estaban hardcodeados */
const CFG = {
  modelos: Object.assign({
    gemini_chat: 'gemini-2.5-flash',
    gemini_goal: 'gemini-2.0-flash',
    groq: GROQ_MODEL
  }, _cfgRaw.modelos || {}),
  limites: Object.assign({
    chat_max_tokens: 4096, chat_temperature: 0.7,
    goal_max_tokens: 2048, goal_temperature: 0.3,
    ia_timeout_ms: 15000, goal_pasos_max: 50,
    goal_pasos_default_telegram: 20, manual_max_chars: 24000
  }, _cfgRaw.limites || {}),
  herramientas: Object.assign({
    alma_en_prompt: true, manual_en_prompt: true
  }, _cfgRaw.herramientas || {})
};
console.log(`[alma] soul.md ${SOUL ? 'cargada (' + SOUL.length + ' chars)' : 'NO ENCONTRADA'} | ` +
  `manual ${MANUAL ? 'cargado (' + MANUAL.length + ' chars)' : 'NO ENCONTRADO'} | ` +
  `config.yaml ${Object.keys(_cfgRaw).length ? 'cargado' : 'NO ENCONTRADO (usando defaults)'}`);

/* Compone el system prompt completo que AGY lee en cada chat/sesión.
   kind: 'chat' (incluye formato de archivos del IDE) | 'goal' (sesiones autónomas) */
function buildSystemPrompt(kind) {
  const parts = [];
  if (CFG.herramientas.alma_en_prompt && SOUL) parts.push(SOUL);
  parts.push(CRITICAL_RULES.trim());
  if (kind === 'chat') parts.push(IDE_SYSTEM);
  if (CFG.herramientas.manual_en_prompt && MANUAL) {
    parts.push('══════ MANUAL MAESTRO DEL ECOSISTEMA (fuente única de verdad) ══════\n' +
      MANUAL.slice(0, CFG.limites.manual_max_chars));
  }
  return parts.join('\n\n');
}


/* ── helpers — Gemini ── */
async function gemini(prompt) {
  if (!GEMINI_KEY) return '';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CFG.modelos.gemini_goal}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt('goal') }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: CFG.limites.goal_temperature, maxOutputTokens: CFG.limites.goal_max_tokens }
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
/* Acepta la clave tal cual o URL-codificada: los navegadores corrompen los
   headers con caracteres no-ASCII (tildes/ñ), así que el frontend la manda
   con encodeURIComponent y aquí se aceptan ambas formas. */
function _pwdOk(raw) {
  if (!AGY_IDE_PWD || !raw) return false;
  if (raw === AGY_IDE_PWD) return true;
  try { if (decodeURIComponent(raw) === AGY_IDE_PWD) return true; } catch {}
  return false;
}
function requirePwd(req, res, next) {
  const pwd = req.headers['x-agyide-pwd'] || (req.body && req.body._pwd);
  if (_pwdOk(pwd)) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

/* ══════════════════════════════════════════
   RUTAS EXISTENTES
══════════════════════════════════════════ */


    /* ── Voz premium con IA (Gemini TTS) — devuelve WAV; el frontend cae al lector del navegador si falla ── */
    function pcmToWav(pcmBuf, sampleRate) {
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuf.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([header, pcmBuf]);
    }

    let _ttsWindowStart = 0, _ttsWindowCount = 0;
app.post('/api/tts', requirePwd, async (req, res) => {
    try {
      if (!GEMINI_KEY) return res.status(503).json({ error: 'Sin GEMINI_API_KEY — usar voz del navegador' });
      /* límite de uso: máx 10 peticiones por minuto (API de pago/cuota) */
    const now = Date.now();
    if (now - _ttsWindowStart > 60000) { _ttsWindowStart = now; _ttsWindowCount = 0; }
    if (++_ttsWindowCount > 10) return res.status(429).json({ error: 'Demasiadas peticiones de voz — usar voz del navegador' });
    const text = req.body && String(req.body.text || '').slice(0, 1200);
      if (!text || !text.trim()) return res.status(400).json({ error: 'texto requerido' });

      const ttsTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TTS sin respuesta en 20s')), 20000));
      const ttsCall = fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' + GEMINI_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Lee en voz alta, con tono natural y amable, exactamente este texto: ' + text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Leda' } } }
            }
          })
        }
      );
      const r = await Promise.race([ttsCall, ttsTimeout]);
      const d = await r.json();
      if (!r.ok) throw new Error((d.error && d.error.message) || 'Gemini TTS error ' + r.status);
      const part = d.candidates && d.candidates[0] && d.candidates[0].content &&
                   d.candidates[0].content.parts && d.candidates[0].content.parts[0];
      const inline = part && (part.inlineData || part.inline_data);
      if (!inline || !inline.data) throw new Error('Gemini TTS no devolvió audio');
      const mime = inline.mimeType || inline.mime_type || '';
      const rateMatch = /rate=(\d+)/.exec(mime);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const wav = pcmToWav(Buffer.from(inline.data, 'base64'), sampleRate);
      res.set('Content-Type', 'audio/wav');
      res.set('Cache-Control', 'no-store');
      res.send(wav);
    } catch (e) {
      console.error('[tts] falló:', e.message);
      res.status(502).json({ error: e.message });
    }
    });

    app.post('/api/auth', (req, res) => {
  const pwd = req.body && req.body.pwd;
  res.json({ ok: _pwdOk(pwd) });
});

/* ── ALMA/MANUAL — verificación y distribución ── */
/* Estado de lo que AGY lee en cada chat (para verificar sin exponer secretos) */
app.get('/api/alma', requirePwd, (_req, res) => {
  res.json({
    soul_cargada: !!SOUL, soul_chars: SOUL.length,
    manual_cargado: !!MANUAL, manual_chars: MANUAL.length,
    config: CFG
  });
});
/* El manual maestro como texto plano — PC1/PC2 lo descargan con la llave de equipos:
   PC1: Invoke-RestMethod -Uri <IDE>/api/manual -Headers @{'x-equipos-key'=<KEY>} | Out-File ...
   PC2: curl -H "x-equipos-key: <KEY>" <IDE>/api/manual -o MANUAL_ECOSISTEMA_SGN.md */
app.get('/api/manual', (req, res) => {
  const key = req.headers['x-equipos-key'] || req.headers['x-agyide-pwd'] || req.query.key;
  const okEquipos = EQUIPOS_REPORT_KEY && key === EQUIPOS_REPORT_KEY;
  const okPwd = AGY_IDE_PWD && key === AGY_IDE_PWD;
  if (!key || (!okEquipos && !okPwd)) return res.status(401).send('No autorizado');
  if (!MANUAL) return res.status(404).send('Manual no encontrado en el servidor');
  res.type('text/markdown; charset=utf-8').send(MANUAL);
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

    if (!isExecution && (GEMINI_KEY || GROQ_KEY)) {
      // PLAN B: Groq directo para chat — bypassa agy.exe y cuota Claude
      const groqReply = await callAI(instruction);
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

    /* /pc1 <comando> | /pc2 <comando> — comando directo sin modo agente */
    const pcMatch = text.match(/^\/pc([12])\s+([\s\S]+)/i);
    if (pcMatch) {
      const pcTarget = 'PC' + pcMatch[1];
      const pcCmd = pcMatch[2].trim();
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await tgReply(`⏳ Enviando a <b>${pcTarget}</b>:\n<code>${esc(pcCmd.slice(0, 300))}</code>`);
      try {
        const prefixed = `[${pcTarget}] EJECUTAR ${pcCmd}`;
        let sent = await replitPost('/api/antigravity/send', { instruction: prefixed, target: pcTarget });
        if (sent && sent.requiresConfirmation) {
          sent = await replitPost('/api/antigravity/send', { instruction: prefixed, target: pcTarget, confirmed: true });
        }
        if (!sent || !sent.id) {
          await tgReply(`❌ ${pcTarget} no aceptó el comando: ${esc(JSON.stringify(sent || {}).slice(0, 300))}`);
          return;
        }
        const done = await pollAGY(sent.id, 60000);
        const out = String(done.result || '(sin salida)');
        if (done.status === 'done') {
          await tgReply(`✅ <b>${pcTarget}</b> respondió:\n<pre>${esc(out.slice(0, 3500))}</pre>`);
        } else {
          await tgReply(`⚠️ <b>${pcTarget}</b> no respondió a tiempo (60s) o falló:\n<pre>${esc(out.slice(0, 500))}</pre>`);
        }
      } catch (e) {
        await tgReply(`❌ Error con ${pcTarget}: ${esc(e.message.slice(0, 200))}`);
      }
      return;
    }

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

app.get('/api/chats', requirePwd, async (req, res) => {
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

app.post('/api/chats', requirePwd, async (req, res) => {
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
    notifyMemory('chat', { session_id: id, app: project, title: title || 'Sin título', messages });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/chats/:id', requirePwd, async (req, res) => {
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
app.get('/api/files', requirePwd, async (req, res) => {
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

app.post('/api/files', requirePwd, async (req, res) => {
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

app.delete('/api/files/:filename', requirePwd, async (req, res) => {
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

/* ══════════════════════════════════════════
   PC WATCHER — Panel MIS EQUIPOS
   Vigila el heartbeat de PC1/PC2 cada minuto.
   Avisa por Telegram cuando un PC se cae (3 fallos seguidos ≈ 3 min)
   y cuando vuelve. Una sola alerta por transición, sin spam.
══════════════════════════════════════════ */
const PC_WATCH = {
  PC1: { online: null, misses: 0, since: null },
  PC2: { online: null, misses: 0, since: null }
};
const BRIDGE_WATCH = { ok: null, misses: 0 };
let PC_LAST_HB = null;

async function checkPCs() {
  /* 1. Consultar el puente con timeout de 10s */
  let d = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(`${REPLIT_API}/api/antigravity/heartbeat`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) d = await r.json();
  } catch (e) { console.error('[pc-watcher] puente:', e.message); }

  /* 2. Puente caído/sin respuesta: estado de los PCs pasa a DESCONOCIDO */
  if (!d || typeof d !== 'object') {
    BRIDGE_WATCH.misses++;
    if (BRIDGE_WATCH.misses >= 3 && BRIDGE_WATCH.ok !== false) {
      BRIDGE_WATCH.ok = false;
      PC_WATCH.PC1.online = null; PC_WATCH.PC1.misses = 0;
      PC_WATCH.PC2.online = null; PC_WATCH.PC2.misses = 0;
      await tgSend('⚠️ El <b>puente</b> lleva ~3 minutos sin responder. No puedo ver el estado de PC1 ni PC2 (pueden estar bien, pero estoy ciego). Plan B: entrar por Termius/Tailscale.');
    }
    return;
  }

  /* 3. Puente OK */
  BRIDGE_WATCH.misses = 0;
  if (BRIDGE_WATCH.ok === false) await tgSend('🟢 El <b>puente</b> volvió a responder. Vuelvo a vigilar PC1 y PC2.');
  BRIDGE_WATCH.ok = true;
  PC_LAST_HB = { data: d, at: new Date().toISOString() };

  for (const pc of ['PC1', 'PC2']) {
    const st = PC_WATCH[pc];
    const on = !!(d[pc] && d[pc].online);
    if (st.online === null) { st.online = on; st.since = Date.now(); continue; } // primera lectura tras arranque o apagón del puente: sin alerta
    if (on) {
      st.misses = 0;
      if (!st.online) {
        st.online = true; st.since = Date.now();
        await tgSend(`🟢 <b>${pc}</b> volvió a conectarse. Todo en orden.`);
      }
    } else if (st.online) {
      st.misses++;
      if (st.misses >= 3) {
        st.online = false; st.since = Date.now(); st.misses = 0;
        await tgSend(`🔴 <b>${pc}</b> lleva ~3 minutos sin dar señal. Puede estar apagado o sin internet.`);
      }
    }
  }
}
setInterval(checkPCs, 60000);
setTimeout(() => checkPCs().catch(() => {}), 5000);

/* Estado para el panel MIS EQUIPOS del frontend (requiere contraseña del IDE).
   online: true = conectado, false = sin señal, null = desconocido (sin datos o puente caído) */
app.get('/api/equipos', requirePwd, (_req, res) => {
  const ago = (pc) => {
    const hb = PC_LAST_HB && PC_LAST_HB.data && PC_LAST_HB.data[pc];
    return hb && typeof hb.seconds_ago === 'number' ? hb.seconds_ago : null;
  };
  res.json({
    bridge_ok: BRIDGE_WATCH.ok,
    PC1: { online: PC_WATCH.PC1.online, seconds_ago: ago('PC1') },
    PC2: { online: PC_WATCH.PC2.online, seconds_ago: ago('PC2') },
    checked_at: PC_LAST_HB ? PC_LAST_HB.at : null
  });
});


/* ══════════════════════════════════════════
   OJO REMOTO — capturas de pantalla y terminal de PC1/PC2
   Los listeners hacen POST /api/equipos/report cada 10-15 s.
   Solo se guarda la ÚLTIMA captura por PC (en memoria, retención corta).
══════════════════════════════════════════ */
const _equiposEye = {};
const _eyePaused = {}; // 'PC1'|'PC2' -> true si el dueño pausó el ojo // 'PC1'|'PC2' -> { shot(Buffer), mime, terminal, ts }
const EQUIPOS_REPORT_KEY = process.env.EQUIPOS_REPORT_KEY || AGY_IDE_PWD;
const EQUIPOS_TTL_MS = 10 * 60 * 1000; // retención corta: 10 minutos

/* ── RODAJE / PELÍCULA ──
   Mientras hay una sesión de rodaje activa, cada captura que llega al ojo se
   guarda en Supabase Storage (bucket 'pelicula'), NUNCA en disco de los PC.
   Tope duro de 700 fotos: al llegar, se detiene la sesión y avisa por Telegram
   para que el dueño decida borrar. */
const PELICULA_BUCKET = 'pelicula';
/* Storage exige una clave que el storage-api acepte de verdad. Las envs han cambiado
   varias veces (service-role, sb_secret de chat, anon...), así que en vez de adivinar,
   se PRUEBAN los candidatos una vez y se cachea la que funciona. */
let _stKeyCache = null;
async function storageKey() {
  if (_stKeyCache) return _stKeyCache;
  const cands = [
    process.env.SUPABASE_STORAGE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_KEY_2,
    process.env.SUPABASE_SERVICE_ROLE_KEY_2,
    process.env.SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY_CHAT
  ].filter(Boolean);
  for (const k of cands) {
    try {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
      if (r.ok) { _stKeyCache = k; return k; }
    } catch (e) { /* siguiente candidato */ }
  }
  console.error('[pelicula] ninguna clave de Supabase sirve para Storage');
  return null;
}
async function stHeaders() {
  const k = await storageKey();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
}
const PELICULA_MAX = 700; // tope de fotos por sesión
let _film = { active: false, id: null, count: 0, startedAt: 0, byPc: { PC1: 0, PC2: 0 }, warned: false };

async function _peliculaEnsureBucket() {
  if (!SUPABASE_URL || !(await storageKey())) return false;
  try {
    const cfg = { public: false, file_size_limit: 6000000, allowed_mime_types: ['image/jpeg', 'image/png', 'text/plain'] };
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${PELICULA_BUCKET}`, { headers: await stHeaders() });
    if (r.ok) {
      await fetch(`${SUPABASE_URL}/storage/v1/bucket/${PELICULA_BUCKET}`, {
        method: 'PUT', headers: await stHeaders(), body: JSON.stringify(cfg)
      }).catch(() => {});
      return true;
    }
    const cr = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST', headers: await stHeaders(),
      body: JSON.stringify({ id: PELICULA_BUCKET, name: PELICULA_BUCKET, ...cfg })
    });
    return cr.ok || cr.status === 409;
  } catch (e) { console.error('[pelicula bucket]', e.message); return false; }
}

async function _peliculaUpload(pc, buf, mime) {
  const SK = await storageKey();
  if (!SUPABASE_URL || !SK) return;
  const sid = _film.id; // sesión a la que pertenece esta foto (queda fija aunque cambie el estado)
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  // Nombre único (tiempo + azar): PC1 y PC2 suben a la vez, un contador compartido colisionaría.
  // El prefijo de tiempo ordena las fotos cronológicamente para el montaje.
  const stamp = Date.now().toString().padStart(14, '0') + '-' + Math.random().toString(36).slice(2, 7);
  const path = `${sid}/${stamp}-${pc}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${PELICULA_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': mime, 'x-upsert': 'false' },
    body: buf
  });
  if (!r.ok) throw new Error(`storage: ${r.status} ${await r.text()}`);
  // Solo contar si la subida sigue perteneciendo a la sesión activa (evita ensuciar una sesión nueva o borrada)
  if (_film.id !== sid) return;
  _film.count += 1;
  _film.byPc[pc] = (_film.byPc[pc] || 0) + 1;
  if (_film.count >= PELICULA_MAX && !_film.warned) {
    _film.warned = true;
    _film.active = false; // se detiene sola al llegar al tope
    tgSend(`🎬 RODAJE DETENIDO: se llegó al tope de ${PELICULA_MAX} fotos (sesión <code>${_film.id}</code>). Revisa el video y borra las capturas con el botón "Borrar rodaje" cuando termines.`).catch(() => {});
  }
}

function _eyeFresh(id) {
  const e = _equiposEye[id];
  if (!e) return null;
  if (Date.now() - e.ts > EQUIPOS_TTL_MS) { delete _equiposEye[id]; return null; }
  return e;
}

app.post('/api/equipos/report', (req, res) => {
  const key = req.headers['x-equipos-key'] || req.headers['x-agyide-pwd'];
  // Nunca autorizar si el servidor no tiene llave configurada o la petición no la trae
  if (!EQUIPOS_REPORT_KEY || !key || key !== EQUIPOS_REPORT_KEY) {
    if (!key || !AGY_IDE_PWD || key !== AGY_IDE_PWD) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }
  const { pc, shot, terminal } = req.body || {};
  const id = String(pc || '').toUpperCase();
  if (id !== 'PC1' && id !== 'PC2') return res.status(400).json({ error: 'pc debe ser PC1 o PC2' });
  if (_eyePaused[id]) { delete _equiposEye[id]; return res.json({ ok: true, paused: true }); }
  const entry = _equiposEye[id] || {};
  if (typeof shot === 'string' && shot.length) {
    if (shot.length > 6000000) return res.status(413).json({ error: 'captura demasiado grande (máx ~4MB)' });
    const buf = Buffer.from(shot.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    // Solo JPEG o PNG reales (firma de bytes), sin fiarse del MIME declarado
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isPng && !isJpg) return res.status(400).json({ error: 'la captura debe ser PNG o JPEG' });
    entry.mime = isPng ? 'image/png' : 'image/jpeg';
    entry.shot = buf;
    // Rodaje activo: guarda esta captura en Supabase (nunca en disco del PC)
    if (_film.active && _film.count < PELICULA_MAX) {
      _peliculaUpload(id, buf, entry.mime).catch(e => console.error('[pelicula]', e.message));
    }
  }
  if (typeof terminal === 'string') {
    entry.terminal = terminal.split('\n').slice(-80).join('\n').slice(-12000);
  }
  const h = req.body && req.body.health;
  if (h && typeof h === 'object') {
    const dpct = Number(h.disk_pct), rpct = Number(h.ram_pct);
    entry.health = {
      disk_pct: Number.isFinite(dpct) ? Math.max(0, Math.min(100, Math.round(dpct))) : null,
      ram_pct:  Number.isFinite(rpct) ? Math.max(0, Math.min(100, Math.round(rpct))) : null
    };
    if (entry.health.disk_pct != null) _checkDiskAlert(id, entry.health.disk_pct);
  }
  entry.ts = Date.now();
  _equiposEye[id] = entry;
  res.json({ ok: true });
});

/* ── ENDPOINTS DE RODAJE / PELÍCULA ── */
/* Diagnóstico del almacén (solo con clave; no revela valores) */
app.get('/api/pelicula/diag', requirePwd, async (_req, res) => {
  const names = ['SUPABASE_URL','SUPABASE_URL_2','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE_KEY_2','SUPABASE_KEY_2','SUPABASE_ANON_KEY','SUPABASE_KEY_CHAT'];
  const out = { url_en_uso: SUPABASE_URL, envs: {}, prueba: {} };
  for (const n of names) {
    const v = process.env[n];
    out.envs[n] = v ? (v.slice(0, 6) + '...(' + v.length + ')') : null;
  }
  for (const n of names.filter(n => n.includes('KEY'))) {
    const v = process.env[n];
    if (!v) continue;
    try {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: { apikey: v, Authorization: `Bearer ${v}` } });
      out.prueba[n] = r.status;
    } catch (e) { out.prueba[n] = 'err:' + e.message; }
  }
  res.json(out);
});

// Estado del rodaje
app.get('/api/pelicula/status', requirePwd, (_req, res) => {
  res.json({ active: _film.active, id: _film.id, count: _film.count, max: PELICULA_MAX,
    byPc: _film.byPc, startedAt: _film.startedAt, warned: _film.warned });
});

// Iniciar rodaje: crea una sesión nueva y empieza a guardar capturas
app.post('/api/pelicula/start', requirePwd, async (req, res) => {
  const ok = await _peliculaEnsureBucket();
  if (!ok) return res.status(503).json({ error: 'no se pudo preparar el almacén de fotos (Supabase)' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _film = { active: true, id: 'rodaje-' + stamp, count: 0, startedAt: Date.now(), byPc: { PC1: 0, PC2: 0 }, warned: false };
  // Marcador de "última sesión": sobrevive a los reinicios de Railway
  storageKey().then(SK => SK && fetch(`${SUPABASE_URL}/storage/v1/object/${PELICULA_BUCKET}/_ultima.txt`, {
    method: 'POST',
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'text/plain', 'x-upsert': 'true' },
    body: _film.id
  })).catch(() => {});
  tgSend(`🎬 RODAJE INICIADO (sesión <code>${_film.id}</code>). Guardando capturas en Supabase, tope ${PELICULA_MAX} fotos.`).catch(() => {});
  res.json({ ok: true, id: _film.id, max: PELICULA_MAX });
});

// Detener rodaje (sin borrar nada)
app.post('/api/pelicula/stop', requirePwd, (req, res) => {
  _film.active = false;
  res.json({ ok: true, id: _film.id, count: _film.count });
});

// Listar las fotos guardadas de la sesión actual (o de una dada con ?id=)
// Sin id y sin sesión en memoria (p. ej. tras un reinicio de Railway): busca la
// última carpeta rodaje-* en el bucket, para que el montaje siempre encuentre algo.
app.get('/api/pelicula/list', requirePwd, async (req, res) => {
  try {
    if (!SUPABASE_URL || !(await storageKey())) return res.status(503).json({ error: 'Supabase no configurado' });
    let id = String(req.query.id || _film.id || '');
    if (!id) {
      const SKm = await storageKey();
      const mr = SKm ? await fetch(`${SUPABASE_URL}/storage/v1/object/${PELICULA_BUCKET}/_ultima.txt`, {
        headers: { apikey: SKm, Authorization: `Bearer ${SKm}` }
      }).catch(() => null) : null;
      if (mr && mr.ok) id = (await mr.text()).trim();
    }
    if (!id) {
      const rr = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${PELICULA_BUCKET}`, {
        method: 'POST', headers: { ...await stHeaders() },
        body: JSON.stringify({ prefix: '', limit: 200, sortBy: { column: 'name', order: 'asc' } })
      });
      if (rr.ok) {
        const rows = await rr.json();
        const ses = (Array.isArray(rows) ? rows : [])
          .map(f => f.name).filter(n => n && n.startsWith('rodaje-')).sort();
        if (ses.length) id = ses[ses.length - 1];
      }
    }
    if (!id) return res.json({ id: null, files: [] });
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${PELICULA_BUCKET}`, {
      method: 'POST',
      headers: { ...await stHeaders() },
      body: JSON.stringify({ prefix: id + '/', limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) return res.status(502).json({ error: 'no se pudo listar: ' + await r.text() });
    const rows = await r.json();
    const files = Array.isArray(rows) ? rows.map(f => id + '/' + f.name) : [];
    res.json({ id, count: files.length, files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Descargar una foto (proxy con la clave del IDE, para que PC1 pueda montar el video)
app.get('/api/pelicula/shot', requirePwd, async (req, res) => {
  try {
    if (!SUPABASE_URL || !(await storageKey())) return res.status(503).json({ error: 'Supabase no configurado' });
    const name = String(req.query.name || '');
    if (!name || name.includes('..')) return res.status(400).json({ error: 'nombre inválido' });
    const SKs = await storageKey();
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${PELICULA_BUCKET}/${name}`, {
      headers: { apikey: SKs, Authorization: `Bearer ${SKs}` }
    });
    if (!r.ok) return res.status(404).json({ error: 'no encontrada' });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    const ab = await r.arrayBuffer();
    res.send(Buffer.from(ab));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrar todas las fotos de una sesión (aviso->confirmación la da el dueño)
app.post('/api/pelicula/clear', requirePwd, async (req, res) => {
  try {
    if (!SUPABASE_URL || !(await storageKey())) return res.status(503).json({ error: 'Supabase no configurado' });
    const id = String((req.body && req.body.id) || _film.id || '');
    if (!id) return res.status(400).json({ error: 'falta id de sesión' });
    const lr = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${PELICULA_BUCKET}`, {
      method: 'POST', headers: { ...await stHeaders() },
      body: JSON.stringify({ prefix: id + '/', limit: 1000 })
    });
    if (!lr.ok) return res.status(502).json({ error: 'no se pudo listar para borrar: ' + await lr.text() });
    const rows = await lr.json();
    const names = Array.isArray(rows) ? rows.map(f => id + '/' + f.name) : [];
    if (names.length) {
      const dr = await fetch(`${SUPABASE_URL}/storage/v1/object/${PELICULA_BUCKET}`, {
        method: 'DELETE', headers: { ...await stHeaders() }, body: JSON.stringify({ prefixes: names })
      });
      if (!dr.ok) return res.status(502).json({ error: 'no se pudo borrar: ' + await dr.text() });
    }
    // Solo tras borrado confirmado se limpia el estado
    if (_film.id === id) { _film.active = false; _film.count = 0; _film.byPc = { PC1: 0, PC2: 0 }; _film.warned = false; }
    res.json({ ok: true, id, borradas: names.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── MONTAJE DE LA PELÍCULA (un solo comando en PC1) ──
   El IDE sirve el script PowerShell ya armado con URL y clave. En PC1 se baja
   y se lanza como proceso aparte. El script: baja TODAS las fotos del rodaje
   (última sesión si no se indica una), arma un MP4 por PC con ffmpeg
   (1.7 fps + fundidos por mezcla de fotogramas), lo manda a Telegram
   (claves leídas del .env de PC1, nunca viajan por el puente), deja copia en
   el Escritorio y borra la carpeta temporal. Log: %USERPROFILE%\\montaje.log */
const PC1_MONTAJE_PS1 = [
"param([string]$Id='')",
"$ErrorActionPreference='Continue'",
"$U='__URL__'",
"$K='__KEY__'",
"$log=Join-Path $env:USERPROFILE 'montaje.log'",
"function L($m){ Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss ')+$m) }",
"L '=== MONTAJE INICIADO ==='",
"$envf='C:\\Users\\Roberto1\\OneDrive\\Desktop\\GitHub\\cibercode-ide\\.env'",
"$TOK=$null;$CHAT=$null",
"if(Test-Path $envf){ Get-Content $envf | ForEach-Object { if($_ -match '^\\s*TELEGRAM_BOT_TOKEN\\s*=\\s*(.+)$'){$script:TOK=$Matches[1].Trim().Trim([char]34).Trim([char]39)}; if($_ -match '^\\s*TELEGRAM_CHAT_ID\\s*=\\s*(.+)$'){$script:CHAT=$Matches[1].Trim().Trim([char]34).Trim([char]39)} } }",
"function TG($t){ if($TOK -and $CHAT){ try{ Invoke-RestMethod -Uri ('https://api.telegram.org/bot'+$TOK+'/sendMessage') -Method Post -Body @{chat_id=$CHAT;text=$t} | Out-Null }catch{ L ('tg err: '+$_.Exception.Message) } } }",
"$H=@{'x-agyide-pwd'=$K}",
"$q=''; if($Id){ $q='?id='+$Id }",
"try{ $lst=Invoke-RestMethod -Uri ($U+'/api/pelicula/list'+$q) -Headers $H }catch{ L ('ERROR list: '+$_.Exception.Message); TG ('MONTAJE FALLO: no pude listar las fotos del rodaje.'); exit 1 }",
"if(-not $lst.files -or @($lst.files).Count -lt 4){ L 'Sin fotos suficientes'; TG 'MONTAJE: no hay fotos suficientes guardadas (se necesitan al menos 4). Empieza un rodaje primero.'; exit 1 }",
"$sid=$lst.id",
"TG ('MONTAJE INICIADO: sesion '+$sid+' con '+@($lst.files).Count+' fotos. Aviso cuando el video este listo.')",
"$tmp=Join-Path $env:TEMP ('montaje-'+(Get-Date -Format 'HHmmss'))",
"New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'PC1'),(Join-Path $tmp 'PC2') | Out-Null",
"$n=@{PC1=0;PC2=0}",
"foreach($f in $lst.files){",
"  $pc='PC1'; if($f -match 'PC2'){ $pc='PC2' }",
"  $k=$n[$pc]+1",
"  $dest=Join-Path (Join-Path $tmp $pc) ('img{0:D5}.jpg' -f $k)",
"  try{ Invoke-WebRequest -Uri ($U+'/api/pelicula/shot?name='+[uri]::EscapeDataString($f)) -Headers $H -OutFile $dest -UseBasicParsing; $n[$pc]=$k }catch{ L ('foto fallo: '+$f); if(Test-Path $dest){ Remove-Item $dest -Force } }",
"}",
"L ('Descargadas PC1='+$n.PC1+' PC2='+$n.PC2)",
"$ff=$null; $gc=Get-Command ffmpeg -ErrorAction SilentlyContinue; if($gc){ $ff=$gc.Source }",
"if(-not $ff){ $ff=Get-ChildItem (Join-Path $env:USERPROFILE 'ffmpeg') -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }",
"if(-not $ff){",
"  L 'ffmpeg no esta; descargando (una sola vez)'",
"  TG 'MONTAJE: instalando ffmpeg en PC1 (solo la primera vez, unos minutos)...'",
"  $zip=Join-Path $env:TEMP 'ffmpeg.zip'",
"  try{ Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing; Expand-Archive -Path $zip -DestinationPath (Join-Path $env:USERPROFILE 'ffmpeg') -Force; Remove-Item $zip -Force }catch{ L ('ffmpeg dl err: '+$_.Exception.Message) }",
"  $ff=Get-ChildItem (Join-Path $env:USERPROFILE 'ffmpeg') -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName",
"}",
"if(-not $ff){ TG 'MONTAJE FALLO: no consegui ffmpeg en PC1 (ni instalado ni descargable).'; Remove-Item $tmp -Recurse -Force; exit 1 }",
"L ('ffmpeg: '+$ff)",
"$desk=[Environment]::GetFolderPath('Desktop')",
"$hechos=@()",
"foreach($pc in 'PC1','PC2'){",
"  if($n[$pc] -lt 4){ L ($pc+' sin fotos suficientes, se omite'); continue }",
"  $dir=Join-Path $tmp $pc",
"  $out=Join-Path $desk ('pelicula-'+$sid+'-'+$pc+'.mp4')",
"  $vf='scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p,framerate=fps=25'",
"  & $ff -y -framerate 1.7 -i (Join-Path $dir 'img%05d.jpg') -vf $vf -c:v libx264 -preset veryfast -crf 23 -movflags +faststart $out 2>> $log",
"  if(Test-Path $out){ $hechos+=$out; L ('Video listo: '+$out) } else { L ('FALLO video '+$pc); TG ('MONTAJE: fallo el video de '+$pc+' (detalle en montaje.log).') }",
"}",
"Remove-Item $tmp -Recurse -Force",
"L 'Temporales borrados'",
"foreach($v in $hechos){",
"  $mb=[math]::Round((Get-Item $v).Length/1MB,1)",
"  if($mb -lt 49 -and $TOK -and $CHAT){",
"    L ('Enviando a Telegram: '+$v+' ('+$mb+' MB)')",
"    & curl.exe -s -F ('chat_id='+$CHAT) -F ('caption=Pelicula lista: '+(Split-Path $v -Leaf)+' ('+$mb+' MB)') -F ('video=@'+$v) ('https://api.telegram.org/bot'+$TOK+'/sendVideo') | Out-Null",
"  } else { TG ('Pelicula lista en el Escritorio de PC1: '+(Split-Path $v -Leaf)+' ('+$mb+' MB). Muy grande para mandarla por Telegram.') }",
"}",
"TG ('MONTAJE TERMINADO: '+$hechos.Count+' video(s) de la sesion '+$sid+'. Copia en el Escritorio de PC1. Cuando confirmes que estan bien, borra las fotos con el boton Borrar rodaje del IDE.')",
"L '=== MONTAJE TERMINADO ==='"
].join("\n");

app.get('/montaje/pc1.ps1', (req, res) => {
  const pwd = req.query.pwd || req.headers['x-agyide-pwd'];
  if (!AGY_IDE_PWD || !pwd || pwd !== AGY_IDE_PWD) return res.status(401).send('No autorizado');
  const base = 'https://' + (req.headers.host || 'agy-ide-production.up.railway.app');
  res.type('text/plain; charset=utf-8').send(
    PC1_MONTAJE_PS1.replace('__URL__', base).replace('__KEY__', AGY_IDE_PWD)
  );
});

/* Ojo autónomo de PC1 — servido desde el propio IDE, sin depender del puente.
   Uso (en PC1): descargar con ?pwd=<clave del IDE> y ejecutar. */
const PC1_EYE_PS1 = [
"$ErrorActionPreference='SilentlyContinue'",
"$U='__URL__/api/equipos/report'",
"$K='__KEY__'",
"Add-Type -AssemblyName System.Drawing",
"Add-Type -AssemblyName System.Windows.Forms",
"Write-Host ('[EYE-PC1] iniciado -> '+$U)",
"while($true){",
"  try{",
"    $b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
"    $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
"    $g=[System.Drawing.Graphics]::FromImage($bmp)",
"    $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)",
"    $ms=New-Object System.IO.MemoryStream",
"    $enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}",
"    $ep=New-Object System.Drawing.Imaging.EncoderParameters 1",
"    $ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]60)",
"    $bmp.Save($ms,$enc,$ep)",
"    $shot=[Convert]::ToBase64String($ms.ToArray())",
"    $g.Dispose();$bmp.Dispose();$ms.Dispose()",
"    $t=@()",
"    $log=$env:USERPROFILE+'\\pc1-term.log'",
"    if(Test-Path $log){",
"      $tl=Get-Content $log -Tail 40 -ErrorAction SilentlyContinue|Where-Object{$_ -and $_ -notmatch 'EncodedCommand' -and $_.Length -lt 300}",
"      if($tl -and @($tl).Count -gt 1){ $t+=('== TERMINAL EN VIVO de PC1 ('+(Get-Date -Format 'HH:mm:ss')+') =='); $t+=$tl }",
"    }",
"    if($t.Count -eq 0){",
"    $t+=('== '+(Get-Date -Format 'HH:mm:ss')+' PC1 ==')",
"    $t+='== PROCESOS (top CPU) =='",
"    $t+=(Get-Process|Sort-Object CPU -Descending|Select-Object -First 8|ForEach-Object{($_.Name+'  CPU:'+[math]::Round([double]$_.CPU,1)+'  RAM:'+[math]::Round($_.WS/1MB)+'MB')})",
"    $t+='== RED (conexiones activas) =='",
"    $t+=(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue|Select-Object -First 6|ForEach-Object{($_.RemoteAddress+':'+$_.RemotePort)})",
"    $t+='== SISTEMA =='",
"    $os=Get-CimInstance Win32_OperatingSystem",
"    $t+=('RAM libre: '+[math]::Round($os.FreePhysicalMemory/1KB)+' MB de '+[math]::Round($os.TotalVisibleMemorySize/1KB)+' MB')",
"    $d=Get-PSDrive C",
"    $t+=('Disco C libre: '+[math]::Round($d.Free/1GB,1)+' GB')",
"    }",
"    $body=@{pc='PC1';shot=$shot;terminal=($t -join [Environment]::NewLine)}|ConvertTo-Json -Compress",
"    Invoke-RestMethod -Uri $U -Method Post -Headers @{'x-equipos-key'=$K} -ContentType 'application/json' -Body $body|Out-Null",
"    Write-Host ('[EYE-PC1] enviado '+(Get-Date -Format 'HH:mm:ss'))",
"  }catch{ Write-Host ('[EYE-PC1] error: '+$_.Exception.Message) }",
"  Start-Sleep -Seconds 12",
"}"
].join("\n");

app.get('/eye/pc1.ps1', (req, res) => {
  const pwd = req.query.pwd || req.headers['x-agyide-pwd'];
  if (!_pwdOk(pwd)) return res.status(401).send('No autorizado');
  const base = 'https://' + (req.headers.host || 'agy-ide-production.up.railway.app');
  res.type('text/plain; charset=utf-8').send(
    PC1_EYE_PS1.replace('__URL__', base).replace('__KEY__', EQUIPOS_REPORT_KEY || '')
  );
});


/* Pausar/reanudar el ojo de un PC (privacidad): mientras esté pausado,
   el servidor descarta lo que llegue y borra lo guardado. */
app.post('/api/equipos/pause', requirePwd, (req, res) => {
  const { pc, paused } = req.body || {};
  const id = String(pc || '').toUpperCase();
  if (id !== 'PC1' && id !== 'PC2') return res.status(400).json({ error: 'pc debe ser PC1 o PC2' });
  _eyePaused[id] = !!paused;
  if (_eyePaused[id]) delete _equiposEye[id];
  res.json({ ok: true, pc: id, paused: _eyePaused[id] });
});

app.get('/api/equipos/screens', requirePwd, (_req, res) => {
  const out = {};
  ['PC1', 'PC2'].forEach((id) => {
    const e = _eyeFresh(id);
    out[id] = e
      ? { ts: e.ts, seconds_ago: Math.round((Date.now() - e.ts) / 1000), has_shot: !!e.shot, terminal: e.terminal || '', paused: !!_eyePaused[id] }
      : (_eyePaused[id] ? { paused: true } : null);
  });
  res.json(out);
});

app.get('/api/equipos/screens/:pc/shot', requirePwd, (req, res) => {
  const _id = String(req.params.pc || '').toUpperCase();
  if (_eyePaused[_id]) return res.status(404).json({ error: 'ojo pausado' });
  const e = _eyeFresh(_id);
  if (!e || !e.shot) return res.status(404).json({ error: 'sin captura' });
  res.set('Content-Type', e.mime || 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.send(e.shot);
});

app.listen(PORT, async () => {
  console.log(`AGY-IDE ▶  puerto ${PORT} | /goal mode ACTIVO`);
  await reconcileInterruptedSessions();
});
