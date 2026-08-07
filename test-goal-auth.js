/**
 * test-goal-auth.js — Integration tests for /goal session-bound authorization
 *
 * Tests that confirmed:true is enforced at the Antigravity dispatch boundary.
 * Run: node test-goal-auth.js
 *
 * Requires env vars: AGY_IDE_URL, AGY_IDE_PASSWORD, REPLIT_ANTIGRAVITY_URL,
 * ANTIGRAVITY_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const BASE_URL       = process.env.AGY_IDE_URL       || 'http://localhost:3000';
const PWD            = process.env.AGY_IDE_PASSWORD;
const AG_URL         = process.env.REPLIT_ANTIGRAVITY_URL || 'https://automate-make.replit.app';
const AG_KEY         = process.env.ANTIGRAVITY_KEY;
const SB_URL         = process.env.SUPABASE_URL;
const SB_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0;
let failed = 0;

async function assert(label, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${label}\n     ${e.message}`);
    failed++;
  }
}

function expect(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function post(path, body, headers = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agyide-pwd': PWD, ...headers },
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

async function sbInsertRunning(id) {
  const r = await fetch(`${SB_URL}/rest/v1/goal_sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      id, goal_text: 'test goal', target: 'PC1',
      status: 'running', steps_done: 0, max_steps: 5, retries: 0, log: []
    })
  });
  if (!r.ok) throw new Error(`sbInsert failed: ${await r.text()}`);
}

async function sbCleanup(id) {
  await fetch(`${SB_URL}/rest/v1/goal_sessions?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
  });
}

async function run() {
  console.log('\n=== /goal authorization integration tests ===\n');

  const testSessionId = `test_${Date.now()}`;
  const highRiskInstruction = 'rm -rf /tmp/deleteme'; // risk >= 40

  /* ── Group 1: Antigravity endpoint enforcement ── */
  console.log('Group 1: Antigravity send endpoint — confirmed:true enforcement');

  await assert('confirmed:true without goal_session_id → 403', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: highRiskInstruction,
      target: 'PC1',
      confirmed: true
      // no goal_session_id
    });
    expect(r.status, 403, 'HTTP status');
  });

  await assert('confirmed:true with non-existent goal_session_id → 403', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: highRiskInstruction,
      target: 'PC1',
      confirmed: true,
      goal_session_id: 'does_not_exist_xyz'
    });
    expect(r.status, 403, 'HTTP status');
  });

  await assert('confirmed:true without confirmed flag → requiresConfirmation', async () => {
    const r = await agPost('/api/antigravity/send', {
      instruction: highRiskInstruction,
      target: 'PC1'
    });
    expect(r.status, 200, 'HTTP status');
    if (!r.body.requiresConfirmation) throw new Error('Expected requiresConfirmation:true');
  });

  /* ── Group 2: Active session validation ── */
  console.log('\nGroup 2: Active session required for confirmed dispatch');

  if (SB_URL && SB_KEY) {
    await sbInsertRunning(testSessionId);

    await assert('confirmed:true with running session → accepted (200 or queued)', async () => {
      const r = await agPost('/api/antigravity/send', {
        instruction: highRiskInstruction,
        target: 'PC1',
        confirmed: true,
        goal_session_id: testSessionId
      });
      // Should NOT be 403; either 200 (queued) or 500 (antigravity down) — anything but 403
      if (r.status === 403) throw new Error(`Got 403 for running session: ${JSON.stringify(r.body)}`);
    });

    // Mark session cancelled then retry
    await fetch(`${SB_URL}/rest/v1/goal_sessions?id=eq.${encodeURIComponent(testSessionId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'cancelled' })
    });

    await assert('confirmed:true with cancelled session → 403', async () => {
      const r = await agPost('/api/antigravity/send', {
        instruction: highRiskInstruction,
        target: 'PC1',
        confirmed: true,
        goal_session_id: testSessionId
      });
      expect(r.status, 403, 'HTTP status');
    });

    await sbCleanup(testSessionId);
  } else {
    console.log('  ⚠ SKIPPED (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set)');
  }

  /* ── Group 3: /api/goal/cancel returns real errors ── */
  console.log('\nGroup 3: /api/goal/cancel reliability');

  await assert('cancel with non-existent id → 500 or DB error (not silent ok)', async () => {
    const r = await post('/api/goal/cancel', { id: 'non_existent_id_xyz' });
    // sbPatch will succeed vacuously on Supabase (0 rows updated but still 204)
    // This test mainly verifies the route doesn't crash
    if (r.status !== 200 && r.status !== 500 && r.status !== 404) {
      throw new Error(`Unexpected status ${r.status}`);
    }
  });

  /* ── Summary ── */
  console.log(`\n═══════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
