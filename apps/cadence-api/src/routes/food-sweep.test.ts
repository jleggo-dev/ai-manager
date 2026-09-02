/**
 * P3 SWEEP-SERVER — the /nutrition/sweep routes end-to-end: real services against a real Cadence
 * Postgres (HAS_DB pattern, per-process test user), auth mocked to inject that user, and the AI
 * seam (`ai/aim.ts`) mocked so nothing here can reach a model. Path shapes are the client
 * contract in apps/cadence-web/src/lib/api/meal-draft.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { FoodSweepProposal, MealItem, NutritionLog } from '@cadence/shared';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

// Per-process test user (services/test-user.ts's shape, inlined because vi.hoisted runs before
// imports). Marker f5d3; the pid keeps parallel runners out of each other's rows.
const USER = vi.hoisted(() => {
  const pid = (process.pid >>> 0).toString(16).padStart(8, '0').slice(-8);
  return `00000000-0000-4000-a000-f5d3${pid}`;
});

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = USER;
    next();
  },
}));

// Lazily-bound module refs (populated in beforeAll so a no-DB env skips without importing config).
let sql: (typeof import('../db/sql.ts'))['sql'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let getSweepLog: (typeof import('../repos/nutrition-sweep.ts'))['getSweepLog'];
let setPendingFoodSweep: (typeof import('../repos/users.ts'))['setPendingFoodSweep'];
let resetUserData: (typeof import('../services/dev-reset.ts'))['resetUserData'];
let makeApp: () => import('express').Express;

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function item(foodId: string, name: string, kcal: number): MealItem {
  return { name, qty: 1, unit: 'serving', food_id: foodId, est: { kcal } };
}

const MEMBERS = [item('zzq-rf-oats', 'oats', 150), item('zzq-rf-chia', 'chia seeds', 50)];

async function seedLogs(): Promise<NutritionLog[]> {
  const out: NutritionLog[] = [];
  for (const daysAgo of [1, 2, 3]) {
    out.push(
      await insertNutritionLog(USER, {
        date: iso(daysAgo),
        meal: 'breakfast',
        items: [...MEMBERS],
        input_method: 'text',
        raw_text: 'overnight oats with chia',
        macros: { kcal: 200 },
      }),
    );
  }
  return out;
}

function proposal(id: string, logs: NutritionLog[]): FoodSweepProposal {
  return {
    id,
    yield_servings: 1,
    name: 'Overnight oats',
    members: MEMBERS.map((m) => ({ food_id: m.food_id!, name: m.name, qty: m.qty!, unit: m.unit! })),
    seen_count: logs.length,
    slot: 'breakfast',
    line: 'Three mornings, both together.',
    macros_per_serving: { kcal: 200 },
    tidy_log_ids: logs.map((l) => l.log_id),
  };
}

/** The union of shapes these routes answer with — loose on purpose; assertions pin the details. */
interface SweepBody {
  sweep?: { proposals: unknown[] } | null;
  saved?: Record<string, unknown>[];
  tidy?: unknown;
  tidied?: number;
  reverted?: number;
  ok?: boolean;
}

/** Serve one request against a fresh listener — the repo's no-supertest pattern. */
async function call(pathname: string, init?: RequestInit): Promise<{ status: number; body: SweepBody | null }> {
  const server = makeApp().listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
    const body = (await res.json().catch(() => null)) as SweepBody | null;
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const jsonBody = (payload?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload ?? {}),
});

d('/nutrition/sweep routes', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ insertNutritionLog } = await import('../repos/nutrition.ts'));
    ({ getSweepLog } = await import('../repos/nutrition-sweep.ts'));
    ({ setPendingFoodSweep } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('../services/dev-reset.ts'));
    const { default: router } = await import('./food-sweep.ts');
    const express = (await import('express')).default;
    makeApp = () => {
      const a = express();
      a.use(express.json());
      a.use('/nutrition', router);
      return a;
    };
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
    await sql`update cadence.users set pending_food_sweep = null, last_food_sweep_at = null where id = ${USER}`;
  });

  it('GET /nutrition/sweep answers null when nothing is pending', async () => {
    const { status, body } = await call('/nutrition/sweep');
    expect(status).toBe(200);
    expect(body).toEqual({ sweep: null });
  });

  it('400s a commit body without an accept array — the service never runs', async () => {
    const { status } = await call('/nutrition/sweep/commit', jsonBody({ nope: true }));
    expect(status).toBe(400);
  });

  it('400s a tidy body without proposal_ids', async () => {
    const { status } = await call('/nutrition/sweep/tidy', jsonBody({}));
    expect(status).toBe(400);
  });

  it('carries the whole flow: read → commit → tidy → revert', async () => {
    const logs = await seedLogs();
    await setPendingFoodSweep(USER, {
      built_at: new Date().toISOString(),
      proposals: [proposal('c1', logs), { ...proposal('c2', [logs[0]!]), name: 'Not this one' }],
    });

    const read = await call('/nutrition/sweep');
    expect(read.status).toBe(200);
    expect(read.body?.sweep?.proposals).toHaveLength(2);

    const commit = await call('/nutrition/sweep/commit', jsonBody({ accept: ['c1'] }));
    expect(commit.status).toBe(200);
    expect(commit.body?.saved).toHaveLength(1);
    expect(commit.body?.saved?.[0]).toMatchObject({ name: 'Overnight oats', servings: 1, source: 'ai' });
    expect(commit.body?.tidy).toEqual([{ proposal_id: 'c1', log_count: 3 }]);

    // The ask is answered — the card never re-surfaces.
    expect((await call('/nutrition/sweep')).body).toEqual({ sweep: null });

    const tidy = await call('/nutrition/sweep/tidy', jsonBody({ proposal_ids: ['c1'] }));
    expect(tidy.status).toBe(200);
    expect(tidy.body).toEqual({ tidied: 3 });
    const bracketed = (await getSweepLog(USER, logs[0]!.log_id))!;
    expect(bracketed.parts[0]).toMatchObject({ name: 'Overnight oats', source: 'sweep' });
    expect(bracketed.macros).toEqual({ kcal: 200 }); // tidy changed no numbers

    const revert = await call('/nutrition/sweep/tidy/revert', jsonBody());
    expect(revert.status).toBe(200);
    expect(revert.body).toEqual({ reverted: 3 });
    expect((await getSweepLog(USER, logs[0]!.log_id))!.parts).toEqual([]);
  });

  it('dismiss clears the ask without saving anything', async () => {
    const logs = await seedLogs();
    await setPendingFoodSweep(USER, { built_at: new Date().toISOString(), proposals: [proposal('c1', logs)] });
    const { status, body } = await call('/nutrition/sweep/dismiss', jsonBody());
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect((await call('/nutrition/sweep')).body).toEqual({ sweep: null });
  });
});
