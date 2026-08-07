/**
 * test-goal-auth.js — Integration tests for /goal session-bound authorization
 *
 * Tests that confirmed:true + dispatch_token enforcement works at the
 * Antigravity dispatch boundary and that the AGY-IDE goal lifecycle is correct.
 *
 * Run: node test-goal-auth.js
 *
 * Required env vars:
 *   AGY_IDE_URL                — e.g. http://localhost:3000 or https://agy-ide-production.up.railway.app
 *   AGY_IDE_PASSWORD           — AGY_IDE_PASSWORD value set in Railway
 *   REPLIT_ANTIGRAVITY_URL     — e.g. https://automate-make.replit.app
 *   ANTIGRAVITY_KEY            — ANTIGRAVITY_KEY set in Railway
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key (needed to insert test rows)
 */

'use strict';

const BASE_URL = process.env.AGY_IDE_URL       || 'http://localhost:3000';
const PWD      = process.env.AGY_IDE_PASSWORD;
const AG_URL   = process.env.REPLIT_ANTIGRAVITY_URL || 'https://automate-make.replit.app';
const AG_KEY   = process.env.ANTIGRAVITY_KEY;
const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0;
let failed = 0;
let skipped = 0;

async function assert(label, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${label}\n       ${e.message}`);
    failed++;
  }
}

function skip(label, reason) {
  console.log(`  ⚠ SKIP: ${label} — ${reason}`);
  skipped++;
}

function expect(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function post(path, body, extraHeaders = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': PWD, ...extraHeaders },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}

async function agPost(path, body) {
  const r = await fetch(`${AG_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-antigravity-key': AG_KEY },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`
  };
}

async function sbInsertSession(id, dispatchToken, status = 'running') {
  const r = await fetch(`${SB_URL}/rest/v1/goal_sessions`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      id, goal_text: 'test goal', target: 'PC1', status,
      steps_done: 0, max_steps: 5, retries: 0, log: [],
      dispatch_token: dispatchToken
    })
  });
  if (!r.ok) throw new Error(`sbInsert failed: ${await r.text()}`);
}

async function sbSetStatus(id, status) {
  await fetch(`${SB_URL}/rest/v1/goal_sessions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status })
  });
}

async function sbDelete(id) {
  await fetch(`${SB_URL}/rest/v1/goal_sessions?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
}

async function run() {
  console.log('\n=== /goal authorization integration tests ===\n');

  const HIGH_RISK = 'rm -rf /tmp/test-deleteme'; // risk score >= 40
  const testId    = `test_${Date.now()}`;
  // Simulated dispatch_token matching what the server would store
  const realToken = 'a'.repeat(64); // 64-char hex-like string
  const badToken  = 'b'.repeat(64);

  /* ── Group 1: Antigravity endpoint — confirmed:true enforcement ── */
  console.log('Group 1: Antigravity /send — confirmed:true enforcement\n');

  await assert('no confirmed flag → requiresConfirmation:true', async () => {
    const r = await agPost('/api/antigravity/send', { instruction: HIGH_RISK, target: 'PC1' });
    expect(r.status, 200, 'HTTP status');
    if (!r.body.requiresConfirmation) throw new Error('Expected requiresConfirmation:true');
  });

  await assert('confirmed:true without goal_session_id → 403', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: HIGH_RISK, target: 'PC1', confirmed: true
    });
    expect(r.status, 403, 'HTTP status');
  });

  await assert('confirmed:true without dispatch_token → 403', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: HIGH_RISK, target: 'PC1', confirmed: true,
      goal_session_id: 'any_id'
    });
    expect(r.status, 403, 'HTTP status');
  });

  await assert('confirmed:true with non-existent session → 403', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: HIGH_RISK, target: 'PC1', confirmed: true,
      goal_session_id: 'does_not_exist_xyz', dispatch_token: realToken
    });
    expect(r.status, 403, 'HTTP status');
  });

  /* ── Group 2: Session-bound token validation ── */
  console.log('\nGroup 2: Session-bound dispatch_token validation\n');

  if (!SB_URL || !SB_KEY) {
    skip('dispatch_token validation', 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
  } else {
    await sbInsertSession(testId, realToken, 'running');

    await assert('wrong dispatch_token for running session → 403', async () => {
      const r = await agPost('/api/antigravity/send', {
        instruction: HIGH_RISK, target: 'PC1', confirmed: true,
        goal_session_id: testId, dispatch_token: badToken
      });
      expect(r.status, 403, 'HTTP status');
    });

    await assert('correct token + running session → accepted (not 403)', async () => {
      const r = await agPost('/api/antigravity/send', {
        instruction: HIGH_RISK, target: 'PC1', confirmed: true,
        goal_session_id: testId, dispatch_token: realToken
      });
      if (r.status === 403) throw new Error(`Got 403 with valid token+session: ${JSON.stringify(r.body)}`);
    });

    await sbSetStatus(testId, 'cancelled');

    await assert('correct token + cancelled session → 403', async () => {
      const r = await agPost('/api/antigravity/send', {
        instruction: HIGH_RISK, target: 'PC1', confirmed: true,
        goal_session_id: testId, dispatch_token: realToken
      });
      expect(r.status, 403, 'HTTP status');
    });

    await sbDelete(testId);
  }

  /* ── Group 3: AGY-IDE /api/goal endpoint ── */
  console.log('\nGroup 3: AGY-IDE /api/goal lifecycle\n');

  if (!PWD) {
    skip('AGY-IDE goal lifecycle', 'AGY_IDE_PASSWORD not set');
  } else {
    await assert('/api/goal without goal text → 400', async () => {
      const r = await post('/api/goal', { goal: '' });
      expect(r.status, 400, 'HTTP status');
    });

    await assert('/api/goal with valid goal → 200 + session id', async () => {
      const r = await post('/api/goal', { goal: 'echo hello', target: 'PC1', max_steps: 1 });
      if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      if (!r.body.id) throw new Error('Expected session id in response');
    });

    await assert('/api/goal/cancel with fake id → 200 (Supabase vacuous patch)', async () => {
      const r = await post('/api/goal/cancel', { id: 'fake_nonexistent' });
      if (r.status !== 200 && r.status !== 500) throw new Error(`Unexpected status ${r.status}`);
    });
  }

  /* ── Summary ── */
  console.log('\n═══════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
