/**
 * Smoke for goal realism assessment (§6.2). Over HTTP: seed a Spartan milestone goal + baseline,
 * POST /review/goals/:id/assess → the coach's verdict + stepping-stones, apply them (PATCH), and
 * confirm they persist. Then, in-process, prove capture preserves user-accepted milestones across
 * its replace-captured-goals churn.
 * Run: node --import tsx apps/cadence-api/scripts/smoke-assess-goal.ts
 */
import { randomUUID } from 'node:crypto';
import { sql } from '../src/db/sql.ts';
import { cadenceConfig } from '../src/config.ts';
import { resetUserData } from '../src/services/dev-reset.ts';
import { insertGoal, listGoalsByStatus } from '../src/repos/goals.ts';
import { runCaptureExtract } from '../src/services/capture.ts';

const BASE = 'http://localhost:3101';
const H = { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': 'account-2' };
const U = cadenceConfig.devAccounts['account-2'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const jget = async (p: string) => (await fetch(`${BASE}${p}`, { headers: H })).json();
const jpost = async (p: string, b?: unknown) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const jpatch = async (p: string, b: unknown) => (await fetch(`${BASE}${p}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) })).json();

async function main() {
  for (let i = 0; i < 25; i++) { try { if ((await fetch(`${BASE}/plan`, { headers: H })).ok) break; } catch {} await sleep(1000); }

  // ── Part 1: assess → apply → persist ────────────────────────────────────────────────
  await jpost('/dev/reset');
  await jpost('/review/goals', { title: 'Complete a Spartan Beast race in October', area: 'movement', type: 'milestone' });
  let review = await jget('/review');
  const goal = review.goals[0];
  await jpatch(`/review/goals/${goal.goal_id}`, { timeframe: { end: '2026-10-17' } });
  await jpatch('/review/baseline', { age: 48, weight_unit: 'lbs', weight_kg: { current: 88.5, start: 88.5, source: 'captured' }, constraints: [{ id: 'k', label: 'left knee — potential runner\'s knee', kind: 'physical', plan_around: true }] });

  const t = Date.now();
  const a = await jpost(`/review/goals/${goal.goal_id}/assess`);
  console.log(`\nassess (${((Date.now() - t) / 1000).toFixed(0)}s): verdict=${a.verdict}`);
  console.log(`  "${a.assessment}"`);
  console.log(`  stepping-stones: ${(a.milestones ?? []).map((m: { label: string; target_date?: string }) => `${m.label}${m.target_date ? ` (${m.target_date})` : ''}`).join(' | ')}`);
  if (a.suggested_target) console.log(`  suggested target: ${a.suggested_target.value} ${a.suggested_target.unit}`);
  if (a.suggested_end) console.log(`  suggested end: ${a.suggested_end}`);
  ok('assessment returned a valid verdict', ['on_track', 'stretch', 'unrealistic'].includes(a.verdict));
  ok('assessment has a warm coach note', typeof a.assessment === 'string' && a.assessment.length > 0);
  ok('assessment proposed ≥1 stepping-stone for a big race goal', Array.isArray(a.milestones) && a.milestones.length >= 1);
  ok('every proposed milestone is dated within the runway', (a.milestones ?? []).every((m: { target_date?: string }) => !m.target_date || (m.target_date > '2026-01-01' && m.target_date <= '2026-10-17')));

  // Apply (mirrors the UI's "Use these"): write milestones + any suggested target/date.
  const milestones = (a.milestones ?? []).map((m: { label: string; target_date?: string }) => ({ id: randomUUID(), label: m.label, target_date: m.target_date }));
  const patch: Record<string, unknown> = { milestones };
  if (a.suggested_target) patch.measure = { ...goal.measure, target: a.suggested_target.value, unit: a.suggested_target.unit };
  if (a.suggested_end) patch.timeframe = { ...goal.timeframe, end: a.suggested_end };
  await jpatch(`/review/goals/${goal.goal_id}`, patch);

  review = await jget('/review');
  const saved = review.goals[0];
  ok('applied stepping-stones persisted on the goal', (saved.milestones?.length ?? 0) === milestones.length && milestones.length > 0);

  // ── Part 2: capture preserves user-accepted milestones across its replace ────────────
  await resetUserData(U);
  await insertGoal(U, { title: 'Run a 10k', area: 'movement', type: 'milestone', status: 'captured', milestones: [{ id: 'm1', label: 'Build to a continuous 5k', target_date: '2026-08-01' }] } as never);
  await runCaptureExtract(U, { conversation_window: 'User: I want to run a 10k this spring — that is the goal I care about.' });
  const after = await listGoalsByStatus(U, ['captured']);
  const tenks = after.filter((g) => norm(g.title).includes('10k'));
  console.log(`\nafter capture re-run: ${after.map((g) => `"${g.title}" [${g.milestones?.length ?? 0} ms]`).join(', ')}`);
  ok('capture kept exactly one 10k goal (near-dup fuzzy-skipped)', tenks.length === 1);
  ok('user-added stepping-stone survived the capture replace', (tenks[0]?.milestones?.length ?? 0) >= 1);

  await resetUserData(U);
  console.log('\ncleaned up account-2');
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
