/**
 * LIVE EVAL: which cheaper model should decide what a described meal was
 * (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29).
 *
 * For every meal in eval-food-check-cases.ts it scores:
 *   - FLOOR    today's pipeline — the `parse-meal` job, then food-pricing's code-picked match
 *              (`priceParsedMeal`, pin:false so nothing is saved)
 *   - each MODEL through the food-check rounds (eval-food-check-protocol.ts): it asks for
 *              lookups, the real fan-out answers, it picks; code counts (eval-food-check-score.ts)
 *
 * Models run through the deployment's `/test`, on an e2e job pointed at per-model e2e profiles
 * with NO failover — the bench-evolve-models.ts pattern, because this machine holds no provider key.
 * Everything e2e-named is deleted on exit; `npm run cleanup:test-data` sweeps leftovers.
 *
 * Writes: AI Admin e2e rows (deleted) and the engine's own diagnostics. On Cadence, the USDA rung
 * may import shared foods it finds — exactly what the live tool does. No meal rows, no ai_log rows.
 *
 * Run:  DRY=1 USER_ID=… node --import tsx apps/cadence-api/scripts/eval-food-check.ts
 *       USER_ID=… MODELS=gpt-5.4-mini CASES=real-banana node --import tsx apps/cadence-api/scripts/eval-food-check.ts
 *       MODE=single SKIP_FLOOR=1 USER_ID=… node --import tsx apps/cadence-api/scripts/eval-food-check.ts
 *       USER_ID=… MODELS=gpt-5.4-mini npm run eval:food-check -- --prompt-from-config
 *
 * `--prompt-from-config` (or PROMPT_FROM_CONFIG=1) runs the SHIPPED shape: the e2e job is given the
 * config's own `food-check` promptTemplate, variables, strict schema and formatting rules, and each
 * call sends the VARIABLES production sends (meal, said, book, round_rule, guard_notes), through the
 * service's split, book and round loop (eval-food-check-single.ts → runMealConfig). The engine fills
 * the template exactly as in production — every variable wrapped in `<user_input name="…">`, every
 * variable cut at MAX_VARIABLE_LENGTH — so what the model reads here is what it reads live. That is
 * the eval of the job as synced, not of a prompt kept beside it.
 */
import { config as dotenv } from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';
import { FOOD_CHECK_CASES, type FoodCheckCase } from './eval-food-check-cases.ts';
import { priceItem, scoreMeal, within, type MealScore } from './eval-food-check-score.ts';
import { MAX_ROUNDS, runMeal, type Lookup, type RoundRun } from './eval-food-check-protocol.ts';
import { SINGLE_MAX_ROUNDS, runMealConfig, runMealSingle, withFatSecretRows } from './eval-food-check-single.ts';
import type { FanOutResult } from '../src/services/food-source-fanout.ts';
import type { SourceCandidate } from '../src/services/food-source-report.ts';
import type { BookLookup } from '../src/services/food-candidate-book.ts';
import type { FoodCheckVars } from '../src/services/food-check.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });
dotenv({ path: path.join(root, 'backend/.env') });

const { fanOutFoodSources } = await import('../src/services/food-source-fanout.ts');
const { toCandidate } = await import('../src/services/food-source-report.ts');
const { searchFatSecretFoods } = await import('../src/services/food-sources/fatsecret.ts');
const { refreshFatSecretFood } = await import('../src/services/food-sources/fatsecret-enrich.ts');
const { wideLookup } = await import('../src/services/food-candidate-sources.ts');
const { priceParsedMeal } = await import('../src/services/food-pricing.ts');
const { parseMealResult } = await import('../src/services/nutrition-parse.ts');
const { withAim } = await import('../src/ai/aim.ts');
const { cadenceConfig } = await import('../src/config.ts');
const { getProcessingJobBySlug, getAiProfile, createProcessingJob, updateProcessingJob } =
  await import('@ai-admin/core');
const { createAiProfile, deleteAiProfile } = await import('../../../backend/src/models/ai-profiles.ts');
const { deleteProcessingJob } = await import('../../../backend/src/models/processing-jobs.ts');

const V2_PROVIDER = '497b0910-b210-4694-855b-67e3ed8a3601';
const E2E_JOB_SLUG = 'e2e-foodcheck-eval';
/** Model calls per invocation, all models together. Real spend on the owner's account. */
const HARD_CAP = 300;
const CONCURRENCY = 4;
const DEFAULT_MODELS = ['gpt-5.4-mini', 'gemini-3.8-flash', 'claude-haiku-5-5', 'claude-sonnet-5-5'];

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const BASE = rawBase.includes('/_/backend') ? rawBase.replace(/\/+$/, '') : rawBase.replace(/\/+$/, '') + '/_/backend';
const RUN_BUDGET_MS = 180_000;
const dispatcher = new Agent({ headersTimeout: RUN_BUDGET_MS + 30_000, bodyTimeout: RUN_BUDGET_MS + 30_000 });

const userId = process.env.USER_ID ?? '';
const dry = process.env.DRY === '1';
const models = (process.env.MODELS ?? DEFAULT_MODELS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const caseFilter = (process.env.CASES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const cases = caseFilter.length ? FOOD_CHECK_CASES.filter((c) => caseFilter.includes(c.id)) : FOOD_CHECK_CASES;
const OUT = process.env.OUT ?? path.join(os.tmpdir(), 'eval-food-check-results.json');
/**
 * `rounds` = the model asks for lookups, then picks (eval-food-check-protocol.ts).
 * `single` = software splits and fans out first, the model gets one call (eval-food-check-single.ts).
 */
const PROMPT_FROM_CONFIG = process.argv.includes('--prompt-from-config') || process.env.PROMPT_FROM_CONFIG === '1';
const MODE: 'rounds' | 'single' | 'config' = PROMPT_FROM_CONFIG
  ? 'config'
  : process.env.MODE === 'single'
    ? 'single'
    : 'rounds';
const skipFloor = process.env.SKIP_FLOOR === '1' || PROMPT_FROM_CONFIG;
/** The shipped job, read once: its prompt is what `config` mode runs and its schema what the e2e job gets. */
const shippedJob = (() => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
    jobs: Array<{
      slug: string;
      config: { promptTemplate: string; variables?: unknown; expectedSchema?: unknown; formattingRules?: unknown };
    }>;
  };
  const job = cfg.jobs.find((j) => j.slug === 'food-check');
  if (!job) throw new Error('food-check job missing from ai-admin.config.json');
  return job.config;
})();
/** FatSecret rows per lookup in the wide book. Each is a billed fetch; the eval pays it on purpose. */
const FATSECRET_ROWS = 5;

interface TestRunBody {
  raw?: string;
  formatted?: string;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}

async function runRemote(jobId: string, variables: Record<string, unknown>): Promise<RoundRun> {
  const t0 = Date.now();
  const res = await undiciFetch(`${BASE}/api/processing-jobs/${jobId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables, callingApplication: cadenceConfig.aim.callingApplication }),
    dispatcher,
    signal: AbortSignal.timeout(RUN_BUDGET_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`/test → ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as TestRunBody;
  return {
    raw: body.formatted ?? body.raw ?? '',
    ms: Date.now() - t0,
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
  };
}

async function liveCatalog(): Promise<Set<string>> {
  const res = await fetch(`${BASE}/api/providers/${V2_PROVIDER}/models`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return new Set(((await res.json()) as Array<{ model_id: string }>).map((m) => m.model_id));
}

/** Same lookup, same answer for every model — and the fan-out runs once per distinct lookup. */
const lookupCache = new Map<string, Promise<FanOutResult>>();
function lookup(l: Lookup): Promise<FanOutResult> {
  const key = `${l.q.toLowerCase()}|${(l.measure ?? '').toLowerCase()}|${(l.brand ?? '').toLowerCase()}`;
  let p = lookupCache.get(key);
  if (!p) {
    p = fanOutFoodSources(userId, { query: l.q, brand: l.brand ?? null, measure: l.measure ?? null });
    lookupCache.set(key, p);
  }
  return p;
}

/**
 * The wide book: the free rungs plus FatSecret's top rows, each fetched in full so she sees per-100 g
 * numbers for every latte and not the first one a lexical score happened to rank highest.
 */
const fatSecretCache = new Map<string, Promise<SourceCandidate[]>>();
function fatSecretRows(l: Lookup): Promise<SourceCandidate[]> {
  const key = `${l.q.toLowerCase()}|${(l.brand ?? '').toLowerCase()}`;
  let p = fatSecretCache.get(key);
  if (!p) {
    p = (async () => {
      const hits = await searchFatSecretFoods([l.brand, l.q].filter(Boolean).join(' '), FATSECRET_ROWS).catch(() => []);
      const rows = await Promise.all(hits.map((h) => refreshFatSecretFood(h.food_id).catch(() => null)));
      return rows.flatMap((f) => (f ? [toCandidate(f, 'fatsecret', l.measure ?? null)] : []));
    })();
    fatSecretCache.set(key, p);
  }
  return p;
}
async function lookupWide(l: Lookup): Promise<FanOutResult> {
  const [base, rows] = await Promise.all([lookup(l), fatSecretRows(l)]);
  return withFatSecretRows(base, rows);
}

/** Config mode uses the PRODUCTION lookup (food-candidate-sources.ts), cached per distinct lookup. */
const prodLookupCache = new Map<string, Promise<FanOutResult>>();
let prodLookup: ((l: BookLookup) => Promise<FanOutResult>) | null = null;
function lookupProd(l: BookLookup): Promise<FanOutResult> {
  prodLookup ??= wideLookup(userId);
  const key = `${l.q.toLowerCase()}|${(l.measure ?? '').toLowerCase()}|${(l.brand ?? '').toLowerCase()}`;
  let p = prodLookupCache.get(key);
  if (!p) {
    p = prodLookup(l);
    prodLookupCache.set(key, p);
  }
  return p;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export interface CaseResult {
  model: string;
  mode: 'rounds' | 'single' | 'config';
  case: string;
  score: MealScore | null;
  seconds: number;
  rounds: number;
  promptTokens: number;
  completionTokens: number;
  lookups: number;
  error: string | null;
  items: unknown[];
  /** What the model was shown — so a scoring fix can re-score without re-running models. */
  shown?: unknown[];
}

let spent = 0;
function spend(): void {
  spent += 1;
  if (spent > HARD_CAP) throw new Error(`hard cap of ${HARD_CAP} model calls reached`);
}

async function floorFor(parseJobId: string, c: FoodCheckCase): Promise<CaseResult> {
  const t0 = Date.now();
  try {
    spend();
    const r = await runRemote(parseJobId, { meal_text: c.text, meal_hint: c.meal });
    const shaped = parseMealResult(r.raw, c.meal);
    const ledger = await priceParsedMeal(
      userId,
      { items: shaped.items, macros: shaped.macros, confidence: shaped.confidence },
      { pin: false },
    );
    const kcal = ledger.items.reduce((s, i) => s + (i.est?.kcal ?? 0), 0);
    const protein = ledger.items.reduce((s, i) => s + (i.est?.protein_g ?? 0), 0);
    const kcalOk = within(kcal, c.kcal, c.kcalTol ?? 0.2);
    const proteinOk = within(protein, c.protein_g, c.proteinTol ?? 0.25);
    return {
      model: 'floor (today)',
      mode: MODE,
      case: c.id,
      score: {
        kcal: Math.round(kcal),
        protein_g: Math.round(protein * 10) / 10,
        kcalOk,
        proteinOk,
        right: kcalOk && proteinOk,
        madeUpIds: 0,
        estimates: ledger.items.filter((i) => !i.food_id).length,
        flagged: 0,
        flagsWanted: c.flag?.length ? 1 : 0,
      },
      seconds: (Date.now() - t0) / 1000,
      rounds: 1,
      promptTokens: r.promptTokens ?? 0,
      completionTokens: r.completionTokens ?? 0,
      lookups: 0,
      error: null,
      items: ledger.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        kcal: i.est?.kcal,
        food_id: i.food_id ?? null,
      })),
    };
  } catch (e) {
    return {
      model: 'floor (today)',
      mode: MODE,
      case: c.id,
      score: null,
      seconds: (Date.now() - t0) / 1000,
      rounds: 0,
      promptTokens: 0,
      completionTokens: 0,
      lookups: 0,
      error: String(e).slice(0, 200),
      items: [],
    };
  }
}

async function modelFor(model: string, jobId: string, c: FoodCheckCase): Promise<CaseResult> {
  const run = (prompt: string) => {
    spend();
    return runRemote(jobId, { prompt });
  };
  /** Config mode: the job holds the shipped template, so the call carries only its variables. */
  const runVars = (vars: FoodCheckVars) => {
    spend();
    return runRemote(jobId, { ...vars });
  };
  const meal =
    MODE === 'config'
      ? await runMealConfig(c, { run: runVars, lookup: lookupProd })
      : MODE === 'single'
        ? await runMealSingle(c, { run, lookup, lookupWide })
        : await runMeal(c, { run, lookup });
  const outcomes = (meal.final ?? []).map((i) => priceItem(i, meal.shown));
  return {
    model,
    mode: MODE,
    case: c.id,
    score: meal.final ? scoreMeal(c, meal.final, outcomes) : null,
    seconds: meal.rounds.reduce((s, r) => s + r.ms, 0) / 1000,
    rounds: meal.rounds.length,
    promptTokens: meal.rounds.reduce((s, r) => s + (r.promptTokens ?? 0), 0),
    completionTokens: meal.rounds.reduce((s, r) => s + (r.completionTokens ?? 0), 0),
    lookups: meal.lookups.length,
    error: meal.error,
    items: (meal.final ?? []).map((i, k) => ({ ...i, outcome: outcomes[k] })),
    shown: [...meal.shown.values()],
  };
}

function summary(results: CaseResult[]): void {
  const byModel = new Map<string, CaseResult[]>();
  for (const r of results) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`\n${pad('model', 22)}right  kcal-ok  made-up  flagged  failed  avg s  avg tok in/out`);
  for (const [model, rs] of byModel) {
    const ok = rs.filter((r) => r.score);
    const n = rs.length;
    const sum = (f: (r: CaseResult) => number) => rs.reduce((s, r) => s + f(r), 0);
    console.log(
      `${pad(model, 22)}${pad(`${ok.filter((r) => r.score!.right).length}/${n}`, 7)}` +
        `${pad(`${ok.filter((r) => r.score!.kcalOk).length}/${n}`, 9)}` +
        `${pad(String(sum((r) => r.score?.madeUpIds ?? 0)), 9)}` +
        `${pad(`${sum((r) => r.score?.flagged ?? 0)}/${sum((r) => r.score?.flagsWanted ?? 0)}`, 9)}` +
        `${pad(String(n - ok.length), 8)}${pad((sum((r) => r.seconds) / n).toFixed(1), 7)}` +
        `${Math.round(sum((r) => r.promptTokens) / n)}/${Math.round(sum((r) => r.completionTokens) / n)}`,
    );
  }
}

async function main(): Promise<void> {
  if (!userId || !KEY) throw new Error('set USER_ID (whose foods the lookups see) and AI_ADMIN_API_KEY');
  const catalog = await liveCatalog();
  const runnable = models.filter(
    (m) => catalog.has(m) || (console.log(`skipping ${m} — not in the live catalog`), false),
  );
  const perMeal = MODE === 'rounds' ? MAX_ROUNDS : SINGLE_MAX_ROUNDS;
  const calls = cases.length * ((skipFloor ? 0 : 1) + runnable.length * perMeal);
  console.log(
    `${cases.length} meals · mode ${MODE} · ${skipFloor ? '' : 'floor + '}${runnable.join(', ')} · at most ${calls} model calls (cap ${HARD_CAP})`,
  );
  if (dry) return;

  const results: CaseResult[] = [];
  const profileIds: string[] = [];
  let jobId = '';
  try {
    await withAim(userId, async () => {
      const parseJob = await getProcessingJobBySlug('parse-meal');
      if (!parseJob) throw new Error('parse-meal job not found');
      if (!skipFloor) {
        results.push(...(await pool(cases, CONCURRENCY, (c) => floorFor(parseJob.id, c))));
        console.log('floor done');
      }

      const base = (await getAiProfile(parseJob.ai_profile_id as string)) as {
        provider_id?: string;
        mode?: string;
        profile_type?: string;
        runtime_options?: Record<string, unknown>;
      };
      // Config mode runs the shipped job's own template and variables through the engine, so the
      // prompt the model reads is built the production way (wrapped, capped) — plus the strict
      // schema and the formatting rules, so the output contract matches too.
      const config =
        MODE === 'config'
          ? {
              promptTemplate: shippedJob.promptTemplate,
              variables: shippedJob.variables,
              expectedResponseFormat: 'json',
              expectedSchema: shippedJob.expectedSchema,
              formattingRules: shippedJob.formattingRules,
            }
          : {
              promptTemplate: '{{prompt}}',
              variables: [{ name: 'prompt', description: 'the round prompt', required: true }],
            };
      const existing = await getProcessingJobBySlug(E2E_JOB_SLUG);
      const fields = {
        description: 'E2E food-check eval (eval-food-check.ts). Swept by cleanup:test-data.',
        config,
        is_active: true,
      };
      const job = existing
        ? await updateProcessingJob(existing.id, fields).then(() => existing)
        : await createProcessingJob({ slug: E2E_JOB_SLUG, name: 'e2e foodcheck eval', ...fields });
      jobId = job.id;

      for (const model of runnable) {
        const profile = await createAiProfile({
          name: `e2e-foodcheck ${model}`,
          slug: `e2e-foodcheck-${Date.now()}`,
          provider_id: base.provider_id,
          external_ai_id: model,
          mode: base.mode,
          profile_type: base.profile_type,
          runtime_options: base.runtime_options,
          is_active: true,
        } as never);
        profileIds.push(profile.id);
        await updateProcessingJob(jobId, { ai_profile_id: profile.id });
        results.push(...(await pool(cases, CONCURRENCY, (c) => modelFor(model, jobId, c))));
        console.log(`${model} done`);
      }
    });
  } finally {
    await withAim(userId, async () => {
      if (jobId) await deleteProcessingJob(jobId).catch((e) => console.warn('job cleanup failed:', String(e)));
      for (const id of profileIds)
        await deleteAiProfile(id).catch((e) => console.warn('profile cleanup failed:', String(e)));
    }).catch((e) => console.warn('cleanup failed (cleanup:test-data sweeps e2e%):', String(e)));
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }
  summary(results);
  console.log(`\nspent ${spent} model calls · full results: ${OUT}`);
}

await main();
process.exit(0);
