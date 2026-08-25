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

/* ── Inyección de contexto matutino SGN ── */
const MORNING_SYNC_HOST = 'https://artifact-publisher-standby-production.up.railway.app';
const MORNING_RECIPIENT = 'agy-ide';
const MORNING_TARGET_HOUR_UTC = 13; // 08:00 America/Bogota (UTC-5, sin DST)
const MORNING_CONTEXT_FILE = path.join(__dirname, 'morning_context_current.json');

function msUntilMorningSync() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    MORNING_TARGET_HOUR_UTC,
    0,
    0,
    0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function sincronizarVitaminasMatutinas() {
  const apiKey = process.env.ANTIGRAVITY_KEY || process.env.LEAD_ARCHITECT_KEY;
  if (!apiKey) {
    console.warn('[MORNING-SYNC] Omitido: falta ANTIGRAVITY_KEY o LEAD_ARCHITECT_KEY');
    return;
  }

  try {
    console.log('[MORNING-SYNC] Descargando contexto diario para agy-ide...');
    const pull = await fetch(
      `${MORNING_SYNC_HOST}/api/ops/morning-injection?recipient=${MORNING_RECIPIENT}`,
      {
        method: 'GET',
        headers: { 'x-antigravity-key': apiKey },
        signal: AbortSignal.timeout(30000)
      }
    );
    if (!pull.ok) {
      console.warn(`[MORNING-SYNC] Pull falló con HTTP ${pull.status}`);
      return;
    }

    const payload = await pull.json();
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'snapshot')) {
      console.warn('[MORNING-SYNC] Railway respondió sin snapshot');
      return;
    }

    try {
      global.SGN_MORNING_CONTEXT = payload.snapshot;
      const temporaryFile = `${MORNING_CONTEXT_FILE}.tmp`;
      fs.writeFileSync(temporaryFile, JSON.stringify(payload.snapshot, null, 2), 'utf8');
      fs.renameSync(temporaryFile, MORNING_CONTEXT_FILE);
    } catch (error) {
      console.error('[MORNING-SYNC] No se pudo persistir; ACK cancelado:', error);
      return;
    }

    console.log('[MORNING-SYNC] Contexto persistido en memoria y disco.');
    const ack = await fetch(`${MORNING_SYNC_HOST}/api/ops/morning-injection/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-antigravity-key': apiKey
      },
      body: JSON.stringify({
        recipient: MORNING_RECIPIENT,
        status: 'INJECTED_OK'
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!ack.ok) {
      console.warn(`[MORNING-SYNC] ACK falló con HTTP ${ack.status}`);
      return;
    }
    console.log('[MORNING-SYNC] ACK registrado con éxito en Railway.');
  } catch (error) {
    console.error('[MORNING-SYNC] Error de sincronización:', error);
  }
}

function scheduleMorningSync() {
  const scheduleNext = () => {
    const delay = msUntilMorningSync();
    console.log(`[MORNING-SYNC] Próxima ejecución: ${new Date(Date.now() + delay).toISOString()} (08:00 America/Bogota)`);
    setTimeout(async () => {
      try {
        await sincronizarVitaminasMatutinas();
      } finally {
        scheduleNext();
      }
    }, delay);
  };
  scheduleNext();
}

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
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
// Groq cuenta entrada + salida contra un TPM de 8k en el modelo de respaldo.
// AGY ya responde corto; reservar 1200 evita que el maxTokens genérico de 4096
// convierta un prompt válido (alma + manual + historial) en una petición imposible.
const GROQ_SAFE_MAX_TOKENS = 1200;
const GROQ_INPUT_BUDGET_CHARS = 18_000;
const GROQ_SYSTEM_BUDGET_CHARS = 14_000;

function clipGroqText(text, maxChars) {
  const value = String(text == null ? '' : text);
  if (value.length <= maxChars) return value;
  const side = Math.max(1, Math.floor((maxChars - 70) / 2));
  return value.slice(0, side) +
    '\n[... contexto reducido solo para el respaldo Groq ...]\n' +
    value.slice(-side);
}

function compactGroqMessages(messages) {
  const normalized = messages
    .filter((message) => message && typeof message.content === 'string')
    .map((message) => ({ role: message.role, content: message.content }));
  const system = normalized
    .filter((message) => message.role === 'system')
    .map((message, index) => ({
      ...message,
      content: clipGroqText(
        message.content,
        index === 0 ? GROQ_SYSTEM_BUDGET_CHARS : 2_000
      )
    }));
  let remaining = Math.max(
    2_000,
    GROQ_INPUT_BUDGET_CHARS -
      system.reduce((total, message) => total + message.content.length, 0)
  );
  const turns = [];
  for (let index = normalized.length - 1; index >= 0; index--) {
    const message = normalized[index];
    if (message.role === 'system' || remaining <= 0) continue;
    const content = clipGroqText(message.content, remaining);
    turns.unshift({ ...message, content });
    remaining -= content.length;
  }
  return [...system, ...turns];
}

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

  const groqModels = [...new Set([CFG.modelos.groq || GROQ_MODEL, GROQ_FALLBACK_MODEL])];
  const groqMessages = compactGroqMessages([
    { role: 'system', content: buildSystemPrompt('chat') },
    { role: 'user', content: userMsg }
  ]);
  const groqMaxTokens = Math.min(CFG.limites.chat_max_tokens, GROQ_SAFE_MAX_TOKENS);
  let groqErr;
  for (let i = 0; i < groqModels.length; i++) {
    const model = groqModels[i];
    try {
      const groqCall = fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: groqMessages,
          max_tokens: groqMaxTokens
        })
      });
      const r = await Promise.race([groqCall, aiTimeout()]);
      const d = await r.json();
      console.log('[callAI] Groq status:', r.status, 'model:', model);
      if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq error ' + r.status);
      return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '(sin respuesta)';
    } catch (err) {
      groqErr = err;
      if (i + 1 < groqModels.length) {
        console.warn('[callAI] Groq falló con ' + model + '; reintentando con ' + groqModels[i + 1] + ':', err.message);
      }
    }
  }
  throw groqErr;
}
const TG_TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID          = process.env.TELEGRAM_LEAD_ARCHITECT_CHAT_ID;
const TG_WEBHOOK_SECRET   = process.env.TELEGRAM_WEBHOOK_SECRET; // optional but recommended

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

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

    // Defensa en servidor para clientes con HTML/JS antiguo en caché:
    // "buzón" nunca puede caer al modelo conversacional.
    const mailboxFallback = await _mailboxLegacyChatFallback(instruction);
    if (mailboxFallback) return res.json(mailboxFallback);

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

app.get('/api/recent', requirePwd, async (req, res) => {
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : '';
    const suffix = since ? `?since=${encodeURIComponent(since)}` : '';
    const data = await replitGet(`/api/antigravity/recent${suffix}`);
    res.json(Array.isArray(data) ? data : []);
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

    /* /pc1, /pc2 o MISIONES PC1/PC2 — insensible a mayúsculas */
    const pcMatch =
      text.match(/^\/(pc1|pc2)\b(?:\s+([\s\S]+))?$/i) ||
      text.match(/^misiones\s+(pc1|pc2)\b(?:\s+([\s\S]+))?$/i);
    if (pcMatch) {
      const pcTarget = pcMatch[1].toUpperCase();
      const pcCmd = (pcMatch[2] || '').trim();
      const isMission = /^misiones\b/i.test(text);
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (!pcCmd) {
        await tgReply(`ℹ️ Uso: <code>/${pcTarget.toLowerCase()} &lt;comando&gt;</code> o <code>MISIONES ${pcTarget} &lt;objetivo&gt;</code>`);
        return;
      }
      await tgReply(`⏳ Enviando a <b>${pcTarget}</b>:\n<code>${esc(pcCmd.slice(0, 300))}</code>`);
      try {
        const prefixed = `[${pcTarget}] ${isMission ? 'AGY' : 'EJECUTAR'} ${pcCmd}`;
        let sent = await replitPost('/api/antigravity/send', {
          instruction: prefixed,
          target: pcTarget,
          chat_id: chatId
        });
        if (sent && sent.requiresConfirmation) {
          sent = await replitPost('/api/antigravity/send', {
            instruction: prefixed,
            target: pcTarget,
            chat_id: chatId,
            confirmed: true
          });
        }
        if (!sent || !sent.id) {
          await tgReply(`❌ ${pcTarget} no aceptó el comando: ${esc(JSON.stringify(sent || {}).slice(0, 300))}`);
          return;
        }
        await tgReply(`📨 Orden <code>${esc(String(sent.id).slice(0, 12))}</code> en cola. El puente enviará el resultado al terminar.`);
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

/* ══════════════════════════════════════════
   BUZÓN AGY — metadatos seguros desde PC1
══════════════════════════════════════════ */
const MAILBOX_BRIDGE_URL = process.env.MAILBOX_BRIDGE_URL ||
  'https://workspaceapi-server-production-0f24.up.railway.app';
const MAILBOX_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAILBOX_MAX_SESSIONS = 256;
const MAILBOX_MAX_ITEMS = 10;
const MAILBOX_MAX_RESULT_BYTES = 128000;
const MAILBOX_MAX_OBJECTIVE_BYTES = 4000;
const MAILBOX_MAX_PC1_RESULT_BYTES = 12000;
const MAILBOX_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAILBOX_LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAILBOX_LOGIN_MAX_FAILURES = 5;
const MAILBOX_READ_CACHE_MS = 5000;
const MAILBOX_VOICE_PROPOSAL_TTL_MS = 60 * 1000;
const MAILBOX_VOICE_MAX_PROPOSALS = 256;
const MAILBOX_VOICE_MAX_MISSION_BYTES = 4000;
const MAILBOX_ROOT = 'C:\\Users\\Roberto1\\OneDrive\\Desktop\\comunicacion entre apps en nube y en local';
const MAILBOX_DIRECTIONS = Object.freeze({
  'replit-to-agy': Object.freeze({
    folder: 'misiones_de_replit_para_agy',
    prefix: 'MISION',
    readme: 'README_BUZON_REPLIT_A_AGY.md'
  }),
  'agy-to-replit': Object.freeze({
    folder: 'misiones_de_agy_para_replit',
    prefix: 'ORDEN_NUBE',
    readme: 'README_BUZON_AGY_A_REPLIT.md'
  })
});

const _mailboxSessions = new Map();
const _mailboxLoginAttempts = new Map();
const _mailboxInFlightReads = new Map();
const _mailboxRecentReads = new Map();
const _mailboxVoiceProposals = new Map();

function _mailboxPruneSessions(now = Date.now()) {
  for (const [token, expiresAt] of _mailboxSessions) {
    if (expiresAt <= now) _mailboxSessions.delete(token);
  }
  while (_mailboxSessions.size >= MAILBOX_MAX_SESSIONS) {
    const oldest = _mailboxSessions.keys().next().value;
    if (!oldest) break;
    _mailboxSessions.delete(oldest);
  }
}

function _mailboxPasswordMatches(provided) {
  if (!AGY_IDE_PWD || typeof provided !== 'string') return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(AGY_IDE_PWD, 'utf8');
  return providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function _mailboxHeaderAuthenticated(req) {
  const provided = req.headers['x-agyide-pwd'];
  return (
    typeof provided === 'string' &&
    Buffer.byteLength(provided, 'utf8') <= 256 &&
    _pwdOk(provided)
  );
}

function _mailboxVoiceSession(req) {
  const value = req.headers['x-agy-voice-session'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{24,120}$/.test(value)
    ? value
    : null;
}

function _mailboxSameOriginAllowed(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const protocol =
    forwardedProtocol === 'https' || forwardedProtocol === 'http'
      ? forwardedProtocol
      : req.protocol === 'https'
        ? 'https'
        : 'http';
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function _mailboxLoginKey(req) {
  return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 120);
}

function _mailboxLoginRetryAfterMs(key, now = Date.now()) {
  const entry = _mailboxLoginAttempts.get(key);
  if (!entry) return 0;
  if (entry.blockedUntil > now) return entry.blockedUntil - now;
  if (entry.windowEndsAt <= now) {
    _mailboxLoginAttempts.delete(key);
    return 0;
  }
  return 0;
}

function _mailboxRegisterLoginFailure(key, now = Date.now()) {
  if (_mailboxLoginAttempts.size >= 1024 && !_mailboxLoginAttempts.has(key)) {
    for (const [entryKey, entry] of _mailboxLoginAttempts) {
      if (entry.windowEndsAt <= now && entry.blockedUntil <= now) {
        _mailboxLoginAttempts.delete(entryKey);
      }
    }
    if (_mailboxLoginAttempts.size >= 1024) {
      const oldestKey = _mailboxLoginAttempts.keys().next().value;
      if (oldestKey) _mailboxLoginAttempts.delete(oldestKey);
    }
  }

  const current = _mailboxLoginAttempts.get(key);
  const entry =
    current && current.windowEndsAt > now
      ? current
      : {
          failures: 0,
          windowEndsAt: now + MAILBOX_LOGIN_WINDOW_MS,
          blockedUntil: 0
        };
  entry.failures += 1;
  if (entry.failures >= MAILBOX_LOGIN_MAX_FAILURES) {
    entry.blockedUntil = now + MAILBOX_LOGIN_BLOCK_MS;
  }
  _mailboxLoginAttempts.set(key, entry);
}

function _mailboxReadSession(req) {
  const authorization = String(req.headers.authorization || '');
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) return 'missing';

  const token = match[1];
  const expiresAt = _mailboxSessions.get(token);
  if (!expiresAt) return 'missing';
  if (expiresAt <= Date.now()) {
    _mailboxSessions.delete(token);
    return 'expired';
  }
  return 'valid';
}

function _mailboxIsDirection(value) {
  return value === 'replit-to-agy' || value === 'agy-to-replit';
}

function _mailboxBuildEncodedCommand(direction) {
  const config = MAILBOX_DIRECTIONS[direction];
  const filePattern =
    config.prefix === 'MISION'
      ? '^MISION_\\d{8}_\\d{3}\\.md$'
      : '^ORDEN_NUBE_\\d{8}_\\d{3}\\.md$';

  const script = [
    "$ErrorActionPreference='Stop'",
    `$f=Join-Path '${MAILBOX_ROOT}' '${config.folder}'`,
    `$p='${filePattern}'`,
    "if(!(Test-Path -LiteralPath $f -PathType Container)){throw 'MAILBOX_UNAVAILABLE'}",
    "function readPrefix($p,$n){$x=[IO.File]::OpenRead($p);try{$l=[Math]::Min([int64]$n,$x.Length);$b=[byte[]]::new([int]$l);[void]$x.Read($b,0,[int]$l);return [Text.Encoding]::UTF8.GetString($b)}finally{$x.Dispose()}}",
    "function readStatus($t){$z=[regex]::Match($t,'(?mi)^-\\s*\\*\\*Estado:\\*\\*\\s*(PENDIENTE|EN_PROCESO|COMPLETADA|ERROR)\\s*$');if($z.Success){return $z.Groups[1].Value.ToUpperInvariant()};return $null}",
    "function readSection($t,$p,$n){$m=[regex]::Match($t,\"(?ims)^##\\s+(?:$p)\\s*\\r?\\n+(.*?)(?=^##\\s+|\\z)\");if(!$m.Success){return $null};$v=$m.Groups[1].Value.Trim();if($v.Length -gt $n){$v=$v.Substring(0,$n)};return $v}",
    "function readMeta($t,$p,$n){$m=[regex]::Match($t,\"(?mi)^-\\s*\\*\\*(?:$p):\\*\\*\\s*(.+?)\\s*$\");if(!$m.Success){return $null};$x=$m.Groups[1].Value.Trim();if($x.Length -gt $n){$x=$x.Substring(0,$n)};return $x}",
    "$g=@(Get-ChildItem -LiteralPath $f -File -Filter '*.md'|Where-Object{$_.Name -match $p}|Sort-Object LastWriteTime -Descending)",
    '$n=$g.Count',
    '$a=@()',
    '@($g|Select-Object -First 10)|ForEach-Object{',
    '$c=readPrefix $_.FullName 65536',
    '$st=readStatus $c',
    "if($st -notin @('PENDIENTE','EN_PROCESO','COMPLETADA','ERROR')){$st='ERROR'}",
    "$o=readSection $c 'Objetivo|Misi[oó]n|Orden' 2000",
    "$z=readSection $c 'Resultado(?:\\s+(?:de\\s+)?PC1)?|Respuesta(?:\\s+(?:de\\s+)?PC1)?|Resultado\\s+real|Ejecuci[oó]n' 6000",
    "if(!$z){$z=readMeta $c 'Resultado(?:\\s+(?:de\\s+)?PC1)?|Respuesta(?:\\s+(?:de\\s+)?PC1)?' 6000}",
    "$cr=readMeta $c 'Creada|Creado|Fecha\\s+de\\s+creaci[oó]n' 120",
    "$cl=readMeta $c 'Cerrada|Cierre|Completada|Finalizada' 120",
    '$ce=$false',
    "if(!$cl -and $st -eq 'COMPLETADA'){$cl=$_.LastWriteTimeUtc.ToString('o');$ce=$true}",
    "$a+=([pscustomobject]@{name=$_.Name;status=$st;sizeBytes=[int64]$_.Length;modifiedAt=$_.LastWriteTimeUtc.ToString('o');createdAt=$cr;closedAt=$cl;closedAtEstimated=$ce;objective=$o;pc1Result=$z})",
    '}',
    '[pscustomobject]@{items=@($a);total=$n;truncated=($n -gt 10)}|ConvertTo-Json -Depth 5 -Compress'
  ].join(';');

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const instruction = `[PC1] EJECUTAR powershell -NoProfile -EncodedCommand ${encoded}`;
  if (instruction.length > 7500) throw new Error('MAILBOX_COMMAND_TOO_LONG');
  return instruction;
}

async function _mailboxDispatch(instruction) {
  const sendResponse = await fetch(`${MAILBOX_BRIDGE_URL}/api/antigravity/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-antigravity-key': AGY_KEY
    },
    body: JSON.stringify({
      instruction,
      target: 'PC1',
      confirmed: true
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!sendResponse.ok) throw new Error('BRIDGE_SEND_REJECTED');
  const sent = await sendResponse.json();
  if (!sent.ok || typeof sent.id !== 'string') {
    throw new Error('BRIDGE_SEND_INVALID');
  }

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const statusResponse = await fetch(
        `${MAILBOX_BRIDGE_URL}/api/antigravity/status/${encodeURIComponent(sent.id)}`,
        {
          headers: { 'x-antigravity-key': AGY_KEY },
          signal: AbortSignal.timeout(8000)
        }
      );
      if (!statusResponse.ok) continue;
      const row = await statusResponse.json();
      if (row.status === 'done' || row.status === 'error') {
        return {
          status: row.status,
          result: typeof row.result === 'string' ? row.result : null
        };
      }
    } catch {
      // El timeout global decide; cortes breves del puente no abortan el sondeo.
    }
  }
  return { status: 'timeout', result: null };
}

async function _mailboxDispatchRead(direction) {
  return _mailboxDispatch(_mailboxBuildEncodedCommand(direction));
}

function _mailboxBuildEncodedCleanCommand() {
  const config = MAILBOX_DIRECTIONS['replit-to-agy'];
  const script = [
    "$ErrorActionPreference='Stop'",
    `$f=Join-Path '${MAILBOX_ROOT}' '${config.folder}'`,
    "$p='^MISION_\\d{8}_\\d{3}\\.md$'",
    "if(!(Test-Path -LiteralPath $f -PathType Container)){throw 'MAILBOX_UNAVAILABLE'}",
    "function readPrefix($p,$n){$x=[IO.File]::OpenRead($p);try{$l=[Math]::Min([int64]$n,$x.Length);$b=[byte[]]::new([int]$l);[void]$x.Read($b,0,[int]$l);return [Text.Encoding]::UTF8.GetString($b)}finally{$x.Dispose()}}",
    '$a=@()',
    "Get-ChildItem -LiteralPath $f -File -Filter '*.md'|Where-Object{$_.Name -match $p}|ForEach-Object{",
    '$h=readPrefix $_.FullName 65536',
    "$m=[regex]::Match($h,'(?mi)^-\\s*\\*\\*Estado:\\*\\*\\s*(PENDIENTE|EN_PROCESO|COMPLETADA|ERROR)\\s*$')",
    "$s=if($m.Success){$m.Groups[1].Value.ToUpperInvariant()}else{'ERROR'}",
    "if($s -eq 'COMPLETADA' -and (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)){Remove-Item -LiteralPath $_.FullName -Force;$a+=$_.Name}",
    '}',
    '[pscustomobject]@{deletedNames=@($a);deletedCount=@($a).Count}|ConvertTo-Json -Depth 3 -Compress'
  ].join(';');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const instruction = `[PC1] EJECUTAR powershell -NoProfile -EncodedCommand ${encoded}`;
  if (instruction.length > 7500) throw new Error('MAILBOX_COMMAND_TOO_LONG');
  return instruction;
}

function _mailboxRead(direction) {
  const cached = _mailboxRecentReads.get(direction);
  if (cached && Date.now() - cached.completedAt < MAILBOX_READ_CACHE_MS) {
    return Promise.resolve(cached.outcome);
  }

  const existing = _mailboxInFlightReads.get(direction);
  if (existing) return existing;

  const request = _mailboxDispatchRead(direction)
    .then((outcome) => {
      if (outcome.status === 'done') {
        _mailboxRecentReads.set(direction, {
          completedAt: Date.now(),
          outcome
        });
      }
      return outcome;
    })
    .finally(() => {
      _mailboxInFlightReads.delete(direction);
    });
  _mailboxInFlightReads.set(direction, request);
  return request;
}

function _mailboxSanitizePreviewText(value, maxBytes) {
  if (typeof value !== 'string') return null;
  const sensitiveKeyName =
    '(?:(?:[a-z0-9][a-z0-9.-]*)[_-])*(?:' +
    'api[_-]?key|secret(?:[_-]?key)?|token|password|passwd|pwd|' +
    'private[_-]?key|service[_-]?role[_-]?key|client[_-]?secret|' +
    'access[_-]?key|auth(?:orization)?|bot[_-]?token|' +
    'connection[_-]?(?:string|url)|database[_-]?url|chat[_-]?id|key' +
    ')(?:[_-][a-z0-9.-]+)*';
  const yamlSecretBlock = new RegExp(
    `(^[ \\t]*(?:["'\`]?)${sensitiveKeyName}(?:["'\`]?)\\s*:\\s*[|>][-+]?\\s*)\\n(?:^[ \\t]+.*(?:\\n|$))*`,
    'gim'
  );
  const secretAssignment = new RegExp(
    `(^|[^a-z0-9_-])((?:["'\`]?)${sensitiveKeyName}(?:["'\`]?)\\s*[:=])[^\\r\\n]*`,
    'gim'
  );
  const cliSecret = new RegExp(
    `(^|\\s)(--?${sensitiveKeyName})(?:\\s+|=)[^\\s]+`,
    'gim'
  );
  const normalized = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(
      /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END \1-----/gi,
      '[BLOQUE PRIVADO REDACTADO]'
    )
    .replace(yamlSecretBlock, '$1\n  [REDACTADO]\n')
    .replace(secretAssignment, '$1$2 [REDACTADO]')
    .replace(cliSecret, '$1$2 [REDACTADO]')
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
      '$1[REDACTADO]@'
    )
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi,
      '[AUTORIZACIÓN REDACTADA]'
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|rpt_[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{25,})\b/gi,
      '[TOKEN REDACTADO]'
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[CLAVE REDACTADA]')
    .replace(/\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/g, '[TOKEN REDACTADO]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g, '[JWT REDACTADO]')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!normalized) return null;
  const bytes = Buffer.from(normalized, 'utf8');
  if (bytes.length <= maxBytes) return normalized;
  return bytes
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD+$/g, '')
    .trim();
}

function _mailboxParseOptionalDate(value) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function _mailboxParseResult(raw, direction) {
  if (Buffer.byteLength(raw, 'utf8') > MAILBOX_MAX_RESULT_BYTES) {
    throw new Error('MAILBOX_RESULT_TOO_LARGE');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MAILBOX_RESULT_INVALID_JSON');
  }

  const candidate =
    parsed && typeof parsed === 'object' && 'items' in parsed
      ? parsed.items
      : parsed;
  if (!Array.isArray(candidate)) {
    throw new Error('MAILBOX_RESULT_INVALID_SHAPE');
  }

  const config = MAILBOX_DIRECTIONS[direction];
  const prefixPattern =
    config.prefix === 'MISION'
      ? /^MISION_\d{8}_\d{3}\.md$/
      : /^ORDEN_NUBE_\d{8}_\d{3}\.md$/;
  const allowedStatuses = new Set([
    'PENDIENTE',
    'EN_PROCESO',
    'COMPLETADA',
    'ERROR'
  ]);

  const items = [];
  for (const entry of candidate.slice(0, MAILBOX_MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (name !== config.readme && !prefixPattern.test(name)) continue;
    if (name.includes('/') || name.includes('\\') || name.length > 180) continue;

    const status = entry.status;
    if (typeof status !== 'string' || !allowedStatuses.has(status)) continue;

    const sizeBytes = Number(entry.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) continue;

    const date = new Date(String(entry.modifiedAt || ''));
    if (Number.isNaN(date.getTime())) continue;

    items.push({
      name,
      direction,
      status,
      sizeBytes,
      modifiedAt: date.toISOString(),
      createdAt: _mailboxParseOptionalDate(entry.createdAt),
      closedAt: _mailboxParseOptionalDate(entry.closedAt),
      closedAtEstimated: entry.closedAtEstimated === true,
      objective: _mailboxSanitizePreviewText(
        entry.objective,
        MAILBOX_MAX_OBJECTIVE_BYTES
      ),
      pc1Result: _mailboxSanitizePreviewText(
        entry.pc1Result,
        MAILBOX_MAX_PC1_RESULT_BYTES
      )
    });
  }
  const parsedTotal = Number(parsed && parsed.total);
  const total =
    Number.isSafeInteger(parsedTotal) && parsedTotal >= items.length
      ? Math.min(parsedTotal, 9999)
      : items.length;
  return {
    items,
    total,
    truncated: Boolean(parsed && parsed.truncated) || total > items.length
  };
}

function _mailboxParseCleanResult(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAILBOX_MAX_RESULT_BYTES) {
    throw new Error('MAILBOX_RESULT_TOO_LARGE');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MAILBOX_CLEAN_INVALID_JSON');
  }
  const candidate = parsed && Array.isArray(parsed.deletedNames)
    ? parsed.deletedNames
    : [];
  const deletedNames = [];
  for (const value of candidate.slice(0, 999)) {
    if (
      typeof value === 'string' &&
      /^MISION_\d{8}_\d{3}\.md$/.test(value) &&
      !deletedNames.includes(value)
    ) {
      deletedNames.push(value);
    }
  }
  return deletedNames;
}

function _mailboxNormalizeInstruction(instruction) {
  return String(instruction || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _mailboxReadDirection(instruction) {
  const normalized = _mailboxNormalizeInstruction(instruction);
  const asksPc1Pending =
    /\bque\s+(?:tareas?|misiones?)\s+(?:tiene|debe)\s+pc1\b|\b(?:tareas?|misiones?)\s+(?:pendientes?|para)\s+(?:de\s+)?pc1\b|\bque\s+tiene\s+que\s+hacer\s+pc1\b/.test(normalized);
  const asksMailboxRead =
    /\b(?:consulta|consultar|ver|muestra|muestrame|mostrar|lista|listar)\b.*\bbuzon\b/.test(normalized) ||
    /\b(?:ver|muestra|muestrame|mostrar|lista|listar|consulta|consultar)\b.*\b(?:pendientes?|tareas?|misiones?)\b/.test(normalized);
  return asksPc1Pending || asksMailboxRead ? 'replit-to-agy' : null;
}

function _mailboxForcedMission(instruction) {
  const raw = String(instruction || '').trim();
  const normalized = _mailboxNormalizeInstruction(raw);
  if (_mailboxReadDirection(raw)) return null;
  if (!raw || !/\b(?:pc1|mision(?:es)?|revis(?:a|ar|e|ion)|buzon|dile\s+a\s+pc1)\b/.test(normalized)) {
    return null;
  }
  const extractors = [
    /^(?:agy|agi)[\s,]+dile\s+a\s+pc1\s+que\s+(.+)$/i,
    /^misi[oó]n\s+para\s+pc1\s*[:,-]?\s*(.+)$/i,
    /^(?:(?:agy|agi)[\s,]+)?manda\s+a\s+pc1\s+a\s+(.+)$/i,
    /^(?:(?:agy|agi)[\s,]+)?pc1[\s,:-]+(.+)$/i
  ];
  for (const pattern of extractors) {
    const match = raw.match(pattern);
    if (match && match[1] && match[1].trim()) {
      const mission = _mailboxNormalizeVoiceMission(match[1]);
      if (mission) return mission;
    }
  }
  return _mailboxNormalizeVoiceMission(raw);
}

function _mailboxLegacyChatIntent(instruction) {
  const normalized = _mailboxNormalizeInstruction(instruction);
  const mentionsMailbox = /\bbuzon\b/.test(normalized);
  const asksToCreate = /\b(?:dejar|deja|dejando|enviar|envia|enviando|manda|mandar|mandando|crea|crear|creando|prepara|preparar|preparando|nueva)\b/.test(normalized)
    && /\bmision(?:es)?\b/.test(normalized);
  const readDirection = _mailboxReadDirection(instruction);
  if (readDirection) return { kind: 'read', direction: readDirection };
  const naturalMissionPatterns = [
    /^(?:agy|agi) dile a pc1 que (.+)$/,
    /^mision para pc1 (.+)$/,
    /^(?:(?:agy|agi) )?manda a pc1 a (.+)$/,
    /^(?:(?:agy|agi) )?pc1 (.+)$/
  ];
  for (const pattern of naturalMissionPatterns) {
    const match = pattern.exec(normalized);
    if (match && match[1] && match[1].trim().length >= 4) {
      const mission = match[1].replace(/(?:^|\s)(?:confirmo|confirmar)\s*$/, '').trim();
      if (mission.length >= 4) return { kind: 'immediate-creation', mission };
    }
  }
  if (asksToCreate) return { kind: 'creation' };
  if (!mentionsMailbox) return null;

  const asksBuzonOne = /\b(?:buzon\s*(?:1|uno)|entrada\s+pc1)\b/.test(normalized)
    && !/\b(?:agy|misiones?\s+pendientes?)\b/.test(normalized);
  return {
    kind: 'read',
    direction: asksBuzonOne ? 'replit-to-agy' : 'agy-to-replit'
  };
}

async function _mailboxLegacyChatFallback(instruction) {
  const forcedMission = _mailboxForcedMission(instruction);
  const intent = forcedMission
    ? { kind: 'immediate-creation', mission: forcedMission }
    : _mailboxLegacyChatIntent(instruction);
  if (!intent) return null;

  const id = `mailbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (intent.kind === 'immediate-creation') {
    if (!AGY_KEY) {
      return {
        ok: false,
        id,
        source: 'mailbox',
        riskLevel: 0,
        result: 'Detecté una misión confirmada para PC1, pero la conexión con PC1 no está configurada.'
      };
    }
    const mission = _mailboxNormalizeVoiceMission(intent.mission);
    if (!mission) {
      return {
        ok: false,
        id,
        source: 'mailbox',
        riskLevel: 0,
        result: 'La misión confirmada no tiene un objetivo válido.'
      };
    }
    try {
      const markdown = _mailboxCreateMissionMarkdown(mission);
      const instruction = _mailboxBuildEncodedCreateCommand(markdown);
      const outcome = await _mailboxDispatch(instruction);
      if (outcome.status === 'timeout') {
        return { ok: false, id, source: 'mailbox', riskLevel: 0, result: 'PC1 no respondió a tiempo. La misión no se confirmó como creada.' };
      }
      if (outcome.status !== 'done' || !outcome.result) {
        return { ok: false, id, source: 'mailbox', riskLevel: 0, result: 'PC1 no pudo crear la misión.' };
      }
      const created = JSON.parse(outcome.result);
      if (!created || typeof created.name !== 'string' || !/^MISION_\d{8}_\d{3}\.md$/.test(created.name) || created.status !== 'PENDIENTE') {
        return { ok: false, id, source: 'mailbox', riskLevel: 0, result: 'PC1 devolvió una confirmación de creación no válida.' };
      }
      _mailboxRecentReads.delete('replit-to-agy');
      return {
        ok: true,
        id,
        source: 'mailbox',
        message: 'Entendido, orden enviada a PC1.',
        riskLevel: 0,
        result: 'Entendido, orden enviada a PC1.'
      };
    } catch (error) {
      console.error('[mailbox] error creando misión confirmada', error instanceof Error ? error.message : 'UNKNOWN');
      return { ok: false, id, source: 'mailbox', riskLevel: 0, result: 'No pude crear la misión en PC1.' };
    }
  }
  if (intent.kind === 'creation') {
    return {
      ok: true,
      id,
      source: 'mailbox',
      riskLevel: 0,
      result: 'Detecté que quieres dejar una misión para AGY. Dime el objetivo completo. Ejemplo: “AGY, prepara una misión para el Buzón uno con el objetivo revisar PC1”. Después di “confirmo” para enviarla.'
    };
  }

  if (!AGY_KEY) {
    return {
      ok: false,
      id,
      source: 'mailbox',
      riskLevel: 0,
      result: 'Detecté la consulta del buzón, pero la conexión con PC1 no está configurada.'
    };
  }

  const direction = intent.direction;
  const mailbox = MAILBOX_DIRECTIONS[direction];
  const mailboxName = direction === 'agy-to-replit' ? 'Buzón de AGY para Replit' : 'Buzón 1';
  try {
    const outcome = await _mailboxRead(direction);
    if (outcome.status === 'timeout') {
      return {
        ok: false,
        id,
        source: 'mailbox',
        riskLevel: 0,
        result: `Detecté la consulta de ${mailboxName}, pero PC1 no respondió a tiempo. Comprueba que el cartero esté ONLINE.`
      };
    }
    if (outcome.status !== 'done' || !outcome.result) {
      return {
        ok: false,
        id,
        source: 'mailbox',
        riskLevel: 0,
        result: `Detecté la consulta de ${mailboxName}, pero PC1 no pudo leerlo ahora mismo.`
      };
    }

    const mailboxResult = _mailboxParseResult(outcome.result, direction);
    const missions = mailboxResult.items.filter((item) => item.name !== mailbox.readme);
    const pending = missions.filter((item) => item.status === 'PENDIENTE').length;
    const processing = missions.filter((item) => item.status === 'EN_PROCESO').length;
    const completed = missions.filter((item) => item.status === 'COMPLETADA').length;
    const errored = missions.filter((item) => item.status === 'ERROR').length;
    const recent = missions.slice(0, 5).map((item) => `${item.name}: ${item.status}`);
    return {
      ok: true,
      id,
      source: 'mailbox',
      riskLevel: 0,
      result: [
        `${mailboxName} consultado en tiempo real. Hay ${mailboxResult.total} archivos de misión.`,
        `${pending} pendientes, ${processing} en proceso, ${completed} completadas y ${errored} con error.`,
        mailboxResult.truncated
          ? `La vista incluye las ${missions.length} más recientes.`
          : null,
        recent.length ? `Las más recientes son: ${recent.join('; ')}.` : 'No hay misiones registradas.'
      ].filter(Boolean).join(' ')
    };
  } catch (error) {
    console.error('[mailbox-chat-fallback] error de lectura', error instanceof Error ? error.message : 'UNKNOWN');
    return {
      ok: false,
      id,
      source: 'mailbox',
      riskLevel: 0,
      result: `Detecté la consulta de ${mailboxName}, pero no pude leerlo ahora mismo.`
    };
  }
}

function _mailboxNormalizeVoiceMission(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (
    normalized.length < 4 ||
    Buffer.byteLength(normalized, 'utf8') > MAILBOX_VOICE_MAX_MISSION_BYTES
  ) {
    return null;
  }
  return normalized;
}

function _mailboxPruneVoiceProposals(now = Date.now()) {
  for (const [id, proposal] of _mailboxVoiceProposals) {
    if (proposal.expiresAt <= now) _mailboxVoiceProposals.delete(id);
  }
  while (_mailboxVoiceProposals.size >= MAILBOX_VOICE_MAX_PROPOSALS) {
    const oldest = _mailboxVoiceProposals.keys().next().value;
    if (!oldest) break;
    _mailboxVoiceProposals.delete(oldest);
  }
}

function _mailboxCreateMissionMarkdown(mission) {
  const now = new Date().toISOString();
  return [
    '# MISION DE REPLIT PARA AGY',
    '',
    `- **Estado:** PENDIENTE`,
    `- **Creada:** ${now}`,
    '- **Origen:** Comando de voz confirmado en AGY IDE',
    '',
    '## Objetivo',
    '',
    mission,
    '',
    '## Seguridad',
    '',
    '- Esta mision fue creada como archivo nuevo despues de una confirmacion verbal.',
    '- No sobrescribir ni borrar archivos existentes.',
    ''
  ].join('\n');
}

function _mailboxBuildEncodedCreateCommand(markdown) {
  const contentBase64 = Buffer.from(markdown, 'utf8').toString('base64');
  const folder = MAILBOX_DIRECTIONS['replit-to-agy'].folder;
  const script = [
    "$ErrorActionPreference='Stop'",
    `$f=Join-Path '${MAILBOX_ROOT}' '${folder}'`,
    "if(!(Test-Path -LiteralPath $f -PathType Container)){throw 'MAILBOX_UNAVAILABLE'}",
    `$b='${contentBase64}'`,
    '$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))',
    '$d=Get-Date -Format yyyyMMdd',
    '$n=$null',
    'for($i=1;$i -le 999;$i++){',
    '$x=("MISION_{0}_{1:D3}.md" -f $d,$i)',
    '$p=Join-Path $f $x',
    'try{',
    '$u=New-Object Text.UTF8Encoding($false)',
    '$w=New-Object IO.StreamWriter((New-Object IO.FileStream($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)),$u)',
    'try{$w.Write($c)}finally{$w.Dispose()}',
    '$n=$x',
    'break',
    "}catch [IO.IOException]{if(Test-Path -LiteralPath $p){continue};throw}",
    '}',
    "if(!$n){throw 'MAILBOX_FULL'}",
    "[pscustomobject]@{name=$n;status='PENDIENTE'}|ConvertTo-Json -Compress"
  ].join(';');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const instruction = `[PC1] EJECUTAR powershell -NoProfile -EncodedCommand ${encoded}`;
  if (instruction.length > 7500) throw new Error('MAILBOX_COMMAND_TOO_LONG');
  return instruction;
}

app.post('/api/ops/mailbox/session', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!_mailboxSameOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  if (!AGY_IDE_PWD) {
    return res.status(503).json({ error: 'Acceso al buzón no configurado' });
  }

  const key = _mailboxLoginKey(req);
  const retryAfterMs = _mailboxLoginRetryAfterMs(key);
  if (retryAfterMs > 0) {
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({
      error: 'Demasiados intentos. Espera antes de volver a probar.'
    });
  }

  const pin = req.body && req.body.pin;
  if (
    typeof pin !== 'string' ||
    pin.length === 0 ||
    Buffer.byteLength(pin, 'utf8') > 256 ||
    !_mailboxPasswordMatches(pin)
  ) {
    _mailboxRegisterLoginFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 250));
    console.warn('[mailbox] intento de acceso rechazado');
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  _mailboxPruneSessions();
  _mailboxLoginAttempts.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + MAILBOX_SESSION_TTL_MS;
  _mailboxSessions.set(token, expiresAt);
  return res.json({
    token,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

app.post('/api/ops/mailbox/list', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sessionState = _mailboxReadSession(req);
  if (sessionState !== 'valid') {
    return res.status(401).json({
      error:
        sessionState === 'expired'
          ? 'La sesión del buzón expiró'
          : 'Sesión del buzón no válida',
      code: sessionState === 'expired' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED'
    });
  }

  const direction = req.body && req.body.direction;
  if (!_mailboxIsDirection(direction)) {
    return res.status(400).json({ error: 'Dirección de buzón no válida' });
  }
  if (!AGY_KEY) {
    return res.status(503).json({ error: 'Conexión con PC1 no configurada' });
  }

  try {
    const outcome = await _mailboxRead(direction);
    if (outcome.status === 'timeout') {
      return res.status(504).json({
        error: 'PC1 no respondió a tiempo. Comprueba que el cartero esté ONLINE.',
        code: 'PC1_TIMEOUT'
      });
    }
    if (outcome.status === 'error' || !outcome.result) {
      console.warn('[mailbox] PC1 no pudo leer', direction);
      return res.status(502).json({
        error: 'PC1 no pudo leer el buzón solicitado',
        code: 'PC1_READ_ERROR'
      });
    }

    const mailboxResult = _mailboxParseResult(outcome.result, direction);
    return res.json({
      direction,
      items: mailboxResult.items,
      total: mailboxResult.total,
      truncated: mailboxResult.truncated,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'UNKNOWN';
    console.error('[mailbox] error de lectura', direction, reason);
    const unavailable =
      reason.startsWith('BRIDGE_') ||
      reason === 'TimeoutError' ||
      reason === 'The operation was aborted due to timeout';
    return res.status(unavailable ? 502 : 422).json({
      error: unavailable
        ? 'El puente no está disponible en este momento'
        : 'PC1 devolvió metadatos de buzón no válidos',
      code: unavailable ? 'BRIDGE_UNAVAILABLE' : 'INVALID_MAILBOX_RESPONSE'
    });
  }
});

app.post('/api/ops/mailbox/clean-completed', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!_mailboxSameOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  const sessionState = _mailboxReadSession(req);
  if (sessionState !== 'valid') {
    return res.status(401).json({
      error:
        sessionState === 'expired'
          ? 'La sesión del buzón expiró'
          : 'Sesión del buzón no válida',
      code: sessionState === 'expired' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED'
    });
  }
  if (!AGY_KEY) {
    return res.status(503).json({ error: 'Conexión con PC1 no configurada' });
  }

  try {
    const outcome = await _mailboxDispatch(_mailboxBuildEncodedCleanCommand());
    if (outcome.status === 'timeout') {
      return res.status(504).json({
        error: 'PC1 no respondió a tiempo. No se eliminó ninguna misión.',
        code: 'PC1_TIMEOUT'
      });
    }
    if (outcome.status !== 'done' || !outcome.result) {
      return res.status(502).json({
        error: 'PC1 no pudo limpiar las misiones completadas',
        code: 'PC1_CLEAN_ERROR'
      });
    }
    const deletedNames = _mailboxParseCleanResult(outcome.result);
    _mailboxRecentReads.delete('replit-to-agy');
    return res.json({
      deletedCount: deletedNames.length,
      deletedNames
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'UNKNOWN';
    console.error('[mailbox] error de limpieza', reason);
    const unavailable =
      reason.startsWith('BRIDGE_') ||
      reason === 'TimeoutError' ||
      reason === 'The operation was aborted due to timeout';
    return res.status(unavailable ? 502 : 422).json({
      error: unavailable
        ? 'El puente no está disponible en este momento'
        : 'PC1 devolvió una respuesta de limpieza no válida',
      code: unavailable ? 'BRIDGE_UNAVAILABLE' : 'INVALID_CLEAN_RESPONSE'
    });
  }
});

app.post('/api/ops/mailbox/voice/command', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!_mailboxSameOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  if (!_mailboxHeaderAuthenticated(req)) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  const voiceSession = _mailboxVoiceSession(req);
  if (!voiceSession) {
    return res.status(400).json({ error: 'Sesion de voz no valida' });
  }
  if (!AGY_KEY) {
    return res.status(503).json({ error: 'Conexion con PC1 no configurada' });
  }

  const requestedAction = req.body && req.body.action;
  const inputText = req.body && (req.body.instruction || req.body.text || req.body.mission);
  const readDirection = requestedAction ? null : _mailboxReadDirection(inputText);
  const forcedMission = requestedAction ? null : (readDirection ? null : _mailboxForcedMission(inputText));
  const action = requestedAction || (forcedMission ? 'create' : (readDirection ? 'list' : null));
  if (action === 'list' || action === 'list-agy-to-replit') {
    try {
      const direction = action === 'list-agy-to-replit' ? 'agy-to-replit' : 'replit-to-agy';
      const mailbox = MAILBOX_DIRECTIONS[direction];
      const mailboxName = direction === 'agy-to-replit' ? 'Buzon de AGY para Replit' : 'Buzon 1';
      const outcome = await _mailboxRead(direction);
      if (outcome.status === 'timeout') {
        return res.status(504).json({ error: 'PC1 no respondio a tiempo' });
      }
      if (outcome.status !== 'done' || !outcome.result) {
        return res.status(502).json({ error: 'PC1 no pudo leer el buzon solicitado' });
      }
      const mailboxResult = _mailboxParseResult(outcome.result, direction);
      const items = mailboxResult.items;
      const missions = items.filter((item) => item.name !== mailbox.readme);
      const pending = missions.filter((item) => item.status === 'PENDIENTE').length;
      const processing = missions.filter((item) => item.status === 'EN_PROCESO').length;
      const completed = missions.filter((item) => item.status === 'COMPLETADA').length;
      const errored = missions.filter((item) => item.status === 'ERROR').length;
      const recent = missions.slice(0, 5).map((item) => `${item.name}: ${item.status}`);
      const summary = [
        `${mailboxName} consultado. Hay ${mailboxResult.total} archivos de misión.`,
        `${pending} pendientes, ${processing} en proceso, ${completed} completadas y ${errored} con error.`,
        mailboxResult.truncated
          ? `La vista incluye las ${missions.length} más recientes.`
          : null,
        recent.length ? `Las mas recientes son: ${recent.join('; ')}.` : 'No hay misiones registradas.'
      ].filter(Boolean).join(' ');
      return res.json({ kind: 'list', message: summary, items });
    } catch (error) {
      console.error('[mailbox-voice] error de lectura', error instanceof Error ? error.message : 'UNKNOWN');
      return res.status(502).json({ error: 'No pude consultar el Buzon 1 ahora mismo' });
    }
  }

  if (action === 'draft') {
    const mission = _mailboxNormalizeVoiceMission(req.body && req.body.mission);
    if (!mission) {
      return res.status(400).json({ error: 'El dictado de la mision no es valido' });
    }
    try {
      _mailboxBuildEncodedCreateCommand(_mailboxCreateMissionMarkdown(mission));
    } catch (error) {
      if (error instanceof Error && error.message === 'MAILBOX_COMMAND_TOO_LONG') {
        return res.status(400).json({
          error: 'La mision dictada es demasiado larga para enviarla a PC1'
        });
      }
      throw error;
    }
    _mailboxPruneVoiceProposals();
    const proposalId = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + MAILBOX_VOICE_PROPOSAL_TTL_MS;
    _mailboxVoiceProposals.set(proposalId, {
      voiceSession,
      mission,
      expiresAt
    });
    return res.json({
      kind: 'proposal',
      proposalId,
      expiresAt: new Date(expiresAt).toISOString(),
      mission,
      message: `Voy a crear una mision nueva en el Buzon 1 con este objetivo: ${mission}. Di confirmo para crearla o cancelar para no hacer nada.`
    });
  }

  if (action === 'create') {
    const mission = forcedMission || _mailboxNormalizeVoiceMission(req.body && req.body.mission);
    if (!mission) {
      return res.status(400).json({ error: 'La orden para PC1 no es valida' });
    }
    try {
      const markdown = _mailboxCreateMissionMarkdown(mission);
      const instruction = _mailboxBuildEncodedCreateCommand(markdown);
      const outcome = await _mailboxDispatch(instruction);
      if (outcome.status === 'timeout') {
        return res.status(504).json({ error: 'PC1 no respondio a tiempo' });
      }
      if (outcome.status !== 'done' || !outcome.result) {
        return res.status(502).json({ error: 'PC1 no pudo crear la mision' });
      }
      const created = JSON.parse(outcome.result);
      if (
        !created ||
        typeof created !== 'object' ||
        typeof created.name !== 'string' ||
        !/^MISION_\d{8}_\d{3}\.md$/.test(created.name) ||
        created.status !== 'PENDIENTE'
      ) {
        return res.status(502).json({ error: 'PC1 devolvio una respuesta no valida' });
      }
      _mailboxRecentReads.delete('replit-to-agy');
      return res.json({
        kind: 'created',
        source: 'mailbox',
        name: created.name,
        status: 'PENDIENTE',
        message: 'Entendido, orden enviada a PC1.'
      });
    } catch (error) {
      console.error('[mailbox-voice] error de creacion inmediata', error instanceof Error ? error.message : 'UNKNOWN');
      return res.status(502).json({ error: 'No pude crear la mision en PC1' });
    }
  }

  return res.status(400).json({ error: 'Comando de voz de Buzon 1 no valido' });
});

app.post('/api/ops/mailbox/voice/confirm', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!_mailboxSameOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  if (!_mailboxHeaderAuthenticated(req)) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  const voiceSession = _mailboxVoiceSession(req);
  if (!voiceSession) {
    return res.status(400).json({ error: 'Sesion de voz no valida' });
  }

  const proposalId = req.body && req.body.proposalId;
  const decision = req.body && req.body.decision;
  if (
    typeof proposalId !== 'string' ||
    !/^[A-Za-z0-9_-]{24,120}$/.test(proposalId) ||
    (decision !== 'confirm' && decision !== 'cancel')
  ) {
    return res.status(400).json({ error: 'Confirmacion no valida' });
  }

  const proposal = _mailboxVoiceProposals.get(proposalId);
  if (!proposal || proposal.voiceSession !== voiceSession || proposal.expiresAt <= Date.now()) {
    if (proposal) _mailboxVoiceProposals.delete(proposalId);
    return res.status(410).json({
      error: 'La propuesta ya no esta disponible. Vuelve a dictar la mision.'
    });
  }
  _mailboxVoiceProposals.delete(proposalId);

  if (decision === 'cancel') {
    return res.json({
      kind: 'cancelled',
      message: 'Propuesta cancelada. No se creo ningun archivo.'
    });
  }
  if (!AGY_KEY) {
    return res.status(503).json({ error: 'Conexion con PC1 no configurada' });
  }

  try {
    const markdown = _mailboxCreateMissionMarkdown(proposal.mission);
    const instruction = _mailboxBuildEncodedCreateCommand(markdown);
    const outcome = await _mailboxDispatch(instruction);
    if (outcome.status === 'timeout') {
      return res.status(504).json({ error: 'PC1 no respondio a tiempo' });
    }
    if (outcome.status !== 'done' || !outcome.result) {
      return res.status(502).json({ error: 'PC1 no pudo crear la mision' });
    }

    let created;
    try {
      created = JSON.parse(outcome.result);
    } catch {
      return res.status(502).json({ error: 'PC1 devolvio una respuesta no valida' });
    }
    if (
      !created ||
      typeof created !== 'object' ||
      typeof created.name !== 'string' ||
      !/^MISION_\d{8}_\d{3}\.md$/.test(created.name) ||
      created.status !== 'PENDIENTE'
    ) {
      return res.status(502).json({ error: 'PC1 devolvio una respuesta no valida' });
    }
    _mailboxRecentReads.delete('replit-to-agy');
    return res.json({
      kind: 'created',
      name: created.name,
      status: 'PENDIENTE',
      message: `Mision creada en el Buzon 1: ${created.name}. Quedo en estado pendiente.`
    });
  } catch (error) {
    console.error('[mailbox-voice] error de creacion', error instanceof Error ? error.message : 'UNKNOWN');
    return res.status(502).json({ error: 'No pude crear la mision en PC1' });
  }
});
/* /BUZÓN AGY */

app.listen(PORT, async () => {
  console.log(`AGY-IDE ▶  puerto ${PORT} | /goal mode ACTIVO`);
  void sincronizarVitaminasMatutinas();
  scheduleMorningSync();
  await reconcileInterruptedSessions();
});
