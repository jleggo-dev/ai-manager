/**
 * Does the LIVE coach actually reach for `breathing`, and does it configure it correctly?
 *
 * The tool catalog is injected at request time, so adding a tool changes the coach's BEHAVIOUR
 * without changing any stored prompt — which means nothing in CI can tell us whether the model
 * picks it up, ignores it, over-reaches for it, or fills it in wrongly. This probe runs the real
 * prescribe-session job against prod AI Admin with the new catalog and checks what comes back.
 *
 * Read-only w.r.t. Cadence: /test executes the job but writes nothing to any plan.
 *
 * Run: node --import tsx apps/cadence-api/scripts/probe-coach-tools.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BREATH_PATTERNS,
  clampCycles,
  isBreathPatternId,
  patternById,
  renderCoachToolCatalog,
  SESSION_TOOL_KINDS,
} from '@cadence/shared';
import { normalizeSession } from '../src/services/session-normalize.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const BASE = (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app') + '/_/backend';
if (!KEY) throw new Error('No AI_ADMIN_API_KEY');

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/** Scenarios chosen to test BOTH directions: does it reach for breathing where it belongs, and
 *  does it leave it alone where it doesn't? A tool that fires everywhere is as broken as one
 *  that never fires. */
const SCENARIOS = [
  {
    name: 'evening wind-down (should use breathing)',
    expect: 'breathing',
    activity: 'Evening wind-down — 10 min, mind/practice, helps me get to sleep',
    goals: 'Sleep better and feel calmer in the evenings',
    baseline: 'Sleeps ~5h, gets into bed wired. No physical constraints.',
    equipment: 'None — a bedroom',
  },
  {
    name: 'morning settling practice (should use breathing)',
    expect: 'breathing',
    activity: 'Morning practice — 6 min, mind/practice, start the day steady',
    goals: 'Be calmer day to day; build a daily practice',
    baseline: 'New to practice, no experience with meditation.',
    equipment: 'None',
  },
  {
    name: 'strength session (breathing at most as a settle step)',
    expect: 'mostly-not-breathing',
    activity: 'Lower body strength — 45 min, movement',
    goals: 'Get stronger; squat bodyweight for reps',
    baseline: 'Trains 3x/week. Cranky right knee — plan around it.',
    equipment: 'Dumbbells, bench, resistance bands',
  },
  {
    name: 'easy run (should NOT be breathing)',
    expect: 'not-breathing',
    activity: 'Easy run — 30 min zone 2, movement',
    goals: 'Run a 10k in the autumn',
    baseline: 'Runs 20km/week comfortably.',
    equipment: 'Road shoes',
  },
];

function variablesFor(s: (typeof SCENARIOS)[number]) {
  return {
    activity: s.activity,
    goals: s.goals,
    baseline: s.baseline,
    equipment: s.equipment,
    recent_logs: '',
    phase: 'discover',
    sessions_logged: '0',
    occurrence_date: '2026-08-03',
    weather: '',
    tool_catalog: renderCoachToolCatalog(),
  };
}

function parseSession(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

async function main() {
  const jobs = (await api('GET', '/api/processing-jobs')) as unknown as { data?: unknown[] } | unknown[];
  const list = (Array.isArray(jobs) ? jobs : (jobs.data ?? [])) as Array<Record<string, unknown>>;
  const job = list.find((j) => j.slug === 'prescribe-session');
  if (!job) throw new Error(`prescribe-session not found among ${list.length} jobs`);
  console.log(`prescribe-session → ${String(job.id)}\n`);

  let problems = 0;
  for (const s of SCENARIOS) {
    process.stdout.write(`── ${s.name}\n`);
    let out: Record<string, unknown>;
    try {
      out = await api('POST', `/api/processing-jobs/${String(job.id)}/test`, {
        variables: variablesFor(s),
        callingApplication: 'platform:cadence',
      });
    } catch (e) {
      console.log(`   REQUEST FAILED: ${(e as Error).message}\n`);
      problems += 1;
      continue;
    }

    const raw = String(out.raw ?? out.formatted ?? '');
    const parsed = parseSession(raw);
    if (!parsed) {
      console.log(`   could not parse JSON. First 200 chars: ${raw.slice(0, 200)}\n`);
      problems += 1;
      continue;
    }

    // Run it through the SAME normalizer the app uses — if it survives that, it renders.
    const norm = normalizeSession(parsed);
    if (!norm) {
      console.log('   normalizeSession rejected the output\n');
      problems += 1;
      continue;
    }

    const items = norm.blocks.flatMap((b) => b.items);
    const breaths = items.filter((i) => i.tool === 'breathing');
    const tools = [...new Set(items.map((i) => i.tool ?? '(inferred)'))];
    console.log(`   ${norm.blocks.length} blocks, ${items.length} items · tools: ${tools.join(', ')}`);

    for (const b of breaths) {
      const rawPattern = (parsed as { blocks?: Array<{ items?: Array<Record<string, unknown>> }> }).blocks
        ?.flatMap((bl) => bl.items ?? [])
        .find((i) => i.name === b.name)?.breath_pattern;
      const kept = b.breath_pattern;
      const valid = isBreathPatternId(String(rawPattern ?? ''));
      const pattern = patternById(kept);
      const clamped = clampCycles(pattern, b.breath_cycles);
      const flag = valid ? '' : `  ⚠ model emitted "${String(rawPattern)}" (not in catalog → dropped)`;
      console.log(
        `   breathing: "${b.name}" · pattern=${String(kept ?? '(none)')} cycles=${String(b.breath_cycles ?? '(none)')} → plays ${pattern.id} × ${clamped}${flag}`,
      );
      if (!valid) problems += 1;
    }

    const hit = breaths.length > 0;
    if (s.expect === 'breathing' && !hit) {
      console.log('   ⚠ expected breathing, got none');
      problems += 1;
    }
    if (s.expect === 'not-breathing' && hit) {
      console.log('   ⚠ breathing used where it probably should not be');
      problems += 1;
    }
    // Off-catalog tool names would mean the catalog isn't teaching cleanly.
    const off = items.map((i) => i.tool).filter((t) => t && !SESSION_TOOL_KINDS.includes(t));
    if (off.length) {
      console.log(`   ⚠ off-catalog tools: ${off.join(', ')}`);
      problems += 1;
    }
    console.log();
  }

  console.log(`patterns in catalog: ${BREATH_PATTERNS.map((p) => p.id).join(', ')}`);
  console.log(problems === 0 ? '\nAll scenarios behaved.' : `\n${problems} thing(s) to look at.`);
}

main().catch((e) => {
  console.error('PROBE FAILED:', (e as Error).message);
  process.exit(1);
});
