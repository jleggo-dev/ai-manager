/**
 * LIVE BENCHMARK: the rebalance rung's remaining latency, model by model.
 *
 * Phase 1 (docs/cadence/PLAN-CHANGES.md) got a whole-week rebalance steer to 263s with 4 edits —
 * proof the diff path works, still over double the 120s budget. Output volume is no longer the
 * cost (4 edits ≈ 1–2K completion tokens); what remains is model deliberation through the relay.
 * So: run the SAME evolve-plan prompt on the SAME real inputs across a handful of catalog models
 * and see which one closes the gap without wrecking the edits.
 *
 * HOW the per-run model choice is reached (investigated 2026-09-01):
 *   - `executeJob` accepts `modelOverride` (backend/src/ai-manager/job-execution.ts), and an
 *     override also disables failover — a clean single-model run. But that is the IN-PROCESS
 *     engine, which needs CREDENTIAL_ENCRYPTION_KEY to decrypt provider keys, and dev machines
 *     hold no such key by design (aim-remote.ts exists for exactly this reason) — tried it, every
 *     call dies as a provider 401 before any tokens are generated.
 *   - The deployment's HTTP `/test` route DROPS modelOverride (backend/src/routes/
 *     processing-jobs.ts forwards only variables/promptOverride/attachments).
 *   - So this script does what probe-tool-loop.ts does: clone the real evolve-plan job config
 *     onto an e2e-named job, point it at per-model e2e profiles (same provider, same
 *     runtime_options, NO failover columns), and run each via the deployment's `/test` — the
 *     same executeJobById path production jobs take, decrypted by the deployment's own key.
 *     Everything e2e-named is deleted on exit, and `npm run cleanup:test-data` sweeps `e2e%`
 *     leftovers if the delete is interrupted.
 *
 * Rules of engagement:
 *   - HARD CAP of 8 job runs per invocation, enforced below — real paid calls on the owner's
 *     account at rebalance-sized prompts.
 *   - ONE run per model by default. n=1 is a POINTER, not a verdict (the "measure twice" house
 *     rule): shortlist here, then confirm with repeat runs (MODELS=<candidate>) before any
 *     profile change.
 *   - Read-only on Cadence: no ai_log rows, no pending_plan, nothing user-visible. The writes
 *     are AI Admin-side only: the e2e job/profiles (deleted) and the engine's own diagnostics.
 *   - Model ids are checked against the live devs-ai-v2 catalog first (Devs.ai silently removes
 *     ids); anything not in the catalog is skipped, not guessed at.
 *   - Edits are dry-run through applyPlanEdits — the SAME composer the real path uses — so the
 *     table shows whether a fast model's edits actually land, not just that JSON came back.
 *
 * Run:  DRY=1 node --import tsx apps/cadence-api/scripts/bench-evolve-models.ts   # plan, no spend
 *       USER_ID=... node --import tsx apps/cadence-api/scripts/bench-evolve-models.ts
 *       MODELS=claude-sonnet-5,gpt-5.4-mini STEER="..." node --import tsx apps/cadence-api/scripts/bench-evolve-models.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';
import type { Activity } from '@cadence/shared';
import type { PlanEdit } from '../src/services/plan-edit.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });
dotenv({ path: path.join(root, 'backend/.env') });

const { gatherReplanInputs } = await import('../src/services/replan.ts');
const { getActivePlan } = await import('../src/repos/plans.ts');
const { listActivities } = await import('../src/repos/activities.ts');
const { activityHandle, applyPlanEdits } = await import('../src/services/plan-edit.ts');
const { PLAN_EDIT_ACTIONS } = await import('../src/services/plan-edit-schema.ts');
const { describeRecurrence } = await import('../src/services/scheduling.ts');
const { parseJson } = await import('../src/services/plan-synthesis.ts');
const { weatherVarsForUser } = await import('../src/services/weather/weather.ts');
const { withAim } = await import('../src/ai/aim.ts');
const { cadenceConfig } = await import('../src/config.ts');
const { getProcessingJobBySlug, getAiProfile, createProcessingJob, updateProcessingJob } =
  await import('@ai-admin/core');
// createAiProfile/deletes aren't exported from core (nothing needed them before the e2e probes) —
// reach the backend models directly, the same modules core re-exports the others from
// (probe-tool-loop.ts precedent).
const { createAiProfile, deleteAiProfile } = await import('../../../backend/src/models/ai-profiles.ts');
const { deleteProcessingJob } = await import('../../../backend/src/models/processing-jobs.ts');

const HARD_CAP = 8;
const V2_PROVIDER = '497b0910-b210-4694-855b-67e3ed8a3601'; // devs-ai-v2, same id list-v2-models.ts uses
const E2E_JOB_SLUG = 'e2e-benchevolve-plan';

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const BASE =
  rawBase.includes('/_/backend') || rawBase.includes('localhost')
    ? rawBase.replace(/\/+$/, '')
    : rawBase.replace(/\/+$/, '') + '/_/backend';

// Node's default fetch kills the headers wait at 300s and /test sends nothing until the job
// finishes — the same trap aim-remote.ts documents. Budgeted like aim-remote: above the engine's
// own worst case, so a slow-but-successful run is measured instead of discarded.
const RUN_BUDGET_MS = 660_000;
const dispatcher = new Agent({ headersTimeout: RUN_BUDGET_MS + 30_000, bodyTimeout: RUN_BUDGET_MS + 30_000 });

/** Current primary, current failover, one gpt-class, one gemini-class — the four slots the
 *  benchmark brief names. Fast-tier picks for the non-claude slots on purpose: the question is
 *  whether a quicker model meets the 120s budget while still emitting edits that apply. */
const DEFAULT_MODELS = ['claude-sonnet-5', 'anthropic-claude-4-5-sonnet', 'gpt-5.4-mini', 'gemini-3.6-flash'];

const models = (process.env.MODELS ?? DEFAULT_MODELS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const steer =
  process.env.STEER ??
  'Monday and Tuesday feel too light and everything is stacked late in the week - spread real ' +
    'strength and cardio work earlier across the week and clear the Wednesday pile-up.';
const dry = process.env.DRY === '1';

if (models.length > HARD_CAP) {
  console.error(`refusing: ${models.length} models > hard cap of ${HARD_CAP} runs`);
  process.exit(1);
}

async function liveCatalog(): Promise<Set<string>> {
  const res = await fetch(`${BASE}/api/providers/${V2_PROVIDER}/models`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ model_id: string }>;
  return new Set(arr.map((m) => m.model_id));
}

/** Mirrors the PRIVATE builder in src/services/plan-evolve.ts (currentPlanForJob) — the handle
 *  and cadence come from the same imports (activityHandle, describeRecurrence), so the part that
 *  must not drift can't. If plan-evolve.ts ever exports its builder, delete this and import it. */
function currentPlanForJob(activities: Activity[], goalTitleById: Record<string, string>): unknown[] {
  return activities.map((a) => ({
    handle: activityHandle(a.commitment_id),
    title: a.title,
    kind: a.kind,
    cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
    recurrence: a.schedule?.recurrence ?? '',
    ...(a.schedule?.time_of_day ? { time_of_day: a.schedule.time_of_day } : {}),
    ...(a.schedule?.duration_min ? { duration_min: a.schedule.duration_min } : {}),
    ...(a.target ? { target: a.target } : {}),
    ...(a.goal_id && goalTitleById[a.goal_id] ? { goal_title: goalTitleById[a.goal_id] } : {}),
  }));
}

/** Mirror of plan-evolve.ts's private coerceEdits, trimmed to what the dry-run apply needs:
 *  alias the action names models reach for, drop non-edits. */
const ACTION_ALIASES: Record<string, PlanEdit['action']> = { rename: 'rework', retitle: 'rework', reschedule: 'move' };
function coerceEdits(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      ...e,
      action: (ACTION_ALIASES[String(e.action ?? '').toLowerCase()] ??
        String(e.action ?? '').toLowerCase()) as PlanEdit['action'],
    }))
    .filter((e) => (PLAN_EDIT_ACTIONS as readonly string[]).includes(e.action)) as unknown as PlanEdit[];
}

interface TestRunBody {
  raw?: string;
  formatted?: string;
  durationMs?: number;
  model?: string;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}

/** One `/test` execution on the deployment — the same executeJobById path production takes. */
async function runRemote(jobId: string, variables: Record<string, unknown>): Promise<TestRunBody> {
  const res = await undiciFetch(`${BASE}/api/processing-jobs/${jobId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables, callingApplication: cadenceConfig.aim.callingApplication }),
    dispatcher,
    signal: AbortSignal.timeout(RUN_BUDGET_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`/test → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TestRunBody;
}

interface RunResult {
  model: string;
  wallS: number;
  engineS: number | null;
  completionTokens: number | null;
  promptTokens: number | null;
  edits: number;
  applied: number;
  rejected: number;
  note: string;
}

function summarize(
  model: string,
  wallS: number,
  body: TestRunBody,
  applied: ReturnType<typeof applyPlanEdits> | null,
  edits: PlanEdit[],
  parsed: Record<string, unknown> | null,
): RunResult {
  const note =
    parsed == null
      ? 'UNPARSEABLE output'
      : parsed.rebuild === true
        ? 'model escalated rebuild:true'
        : ((typeof parsed.note === 'string' ? parsed.note : '') || '').slice(0, 90);
  return {
    model,
    wallS,
    engineS: body.durationMs != null ? body.durationMs / 1000 : null,
    completionTokens: body.usage?.completion_tokens ?? null,
    promptTokens: body.usage?.prompt_tokens ?? null,
    edits: edits.length,
    applied: applied?.changes.length ?? 0,
    rejected: applied?.rejected.length ?? 0,
    note,
  };
}

function printTable(results: RunResult[]): void {
  console.log('\nmodel                          wall     engine   prompt   compl    edits  applied  rejected  note');
  for (const r of results) {
    console.log(
      [
        r.model.padEnd(31),
        (r.wallS < 0 ? 'failed' : `${r.wallS.toFixed(1)}s`).padEnd(9),
        (r.engineS == null ? '—' : `${r.engineS.toFixed(1)}s`).padEnd(9),
        String(r.promptTokens ?? '—').padEnd(9),
        String(r.completionTokens ?? '—').padEnd(9),
        String(r.edits).padEnd(7),
        String(r.applied).padEnd(9),
        String(r.rejected).padEnd(10),
        r.note,
      ].join(''),
    );
  }
}

async function main(): Promise<void> {
  const userId = process.env.USER_ID ?? '';
  if (!userId) {
    console.error('set USER_ID (the plan being evolved — the benchmark uses a real active plan)');
    process.exit(1);
  }
  if (!KEY) {
    console.error('no AI Admin API key (AI_ADMIN_API_KEY) — the deployment runs the models here');
    process.exit(1);
  }

  const catalog = await liveCatalog();
  const runnable = models.filter((m) => {
    if (catalog.has(m)) return true;
    console.log(`skipping ${m} — not in the live devs-ai-v2 catalog`);
    return false;
  });
  if (runnable.length === 0) {
    console.error('no runnable models');
    process.exit(1);
  }

  const inputs = await gatherReplanInputs(userId);
  const plan = await getActivePlan(userId);
  const activities = plan ? await listActivities(plan.plan_id) : [];
  if (!inputs || activities.length === 0) {
    console.error('nothing to evolve — no committed goals or no active plan');
    process.exit(1);
  }
  const goalTitleById: Record<string, string> = {};
  for (const g of inputs.goals) goalTitleById[g.goal_id] = g.title;
  const { weather } = await weatherVarsForUser(userId).catch(() => ({ weather: '' }));

  // The exact variable set evolveByEdits sends (plan-evolve.ts), plus the clock vars aim.ts adds
  // to every job — identical across models by construction, so the model is the only variable.
  const d = new Date();
  const variables: Record<string, unknown> = {
    goals: JSON.stringify(inputs.goals),
    baseline: JSON.stringify(inputs.baseline),
    equipment: JSON.stringify(inputs.equipment),
    current_plan: JSON.stringify(currentPlanForJob(activities, goalTitleById)),
    recent_activity: JSON.stringify(inputs.recentActivity ?? ''),
    user_steer: steer.trim().slice(0, 500),
    weather,
    today: d.toISOString().slice(0, 10),
    day_of_week: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  };

  console.log(`user ${userId} · goals ${inputs.goals.length} · plan ${activities.length} activities`);
  console.log(`steer: ${steer}`);
  console.log(`models (1 run each, sequential, via ${BASE}): ${runnable.join(', ')}\n`);
  if (dry) {
    console.log('DRY=1 — stopping before any AI Admin row or model call. Spend would be:', runnable.length, 'run(s)');
    return;
  }

  // Clone the REAL evolve-plan job config onto an e2e job (the real job is never touched), and
  // read the real profile once for provider/mode/runtime_options to clone per model — WITHOUT the
  // failover columns, so a slow candidate times out and reports, rather than silently switching.
  const cleanupProfileIds: string[] = [];
  let e2eJobId = '';
  const results: RunResult[] = [];
  try {
    await withAim(userId, async () => {
      const realJob = await getProcessingJobBySlug('evolve-plan');
      if (!realJob) throw new Error('evolve-plan job not found (is it synced?)');
      const realProfile = (await getAiProfile(realJob.ai_profile_id as string)) as {
        provider_id?: string;
        mode?: string;
        profile_type?: string;
        runtime_options?: Record<string, unknown>;
      };
      const existing = await getProcessingJobBySlug(E2E_JOB_SLUG);
      const jobFields = {
        description: 'E2E benchmark clone of evolve-plan (bench-evolve-models.ts). Swept by cleanup:test-data.',
        config: realJob.config,
        is_active: true,
      };
      const job = existing
        ? await updateProcessingJob(existing.id, jobFields).then(() => existing)
        : await createProcessingJob({ slug: E2E_JOB_SLUG, name: 'e2e benchevolve plan', ...jobFields });
      e2eJobId = job.id;

      for (const model of runnable) {
        const profile = await createAiProfile({
          name: `e2e-benchevolve ${model}`,
          slug: `e2e-benchevolve-${Date.now()}`,
          provider_id: realProfile.provider_id,
          external_ai_id: model,
          mode: realProfile.mode,
          profile_type: realProfile.profile_type,
          runtime_options: realProfile.runtime_options,
          is_active: true,
        } as never);
        cleanupProfileIds.push(profile.id);
        await updateProcessingJob(e2eJobId, { ai_profile_id: profile.id });

        console.log(`→ ${model} …`);
        const t0 = Date.now();
        try {
          const body = await runRemote(e2eJobId, variables);
          const wallS = (Date.now() - t0) / 1000;
          const parsed = parseJson(body.formatted ?? body.raw ?? '');
          const edits = coerceEdits(parsed?.edits);
          const applied = edits.length ? applyPlanEdits(activities, edits, goalTitleById) : null;
          const r = summarize(model, wallS, body, applied, edits, parsed);
          results.push(r);
          console.log(
            `  ${r.wallS.toFixed(1)}s · ${r.edits} edits (${r.applied} apply, ${r.rejected} rejected) · ${r.note}`,
          );
        } catch (e) {
          results.push(summarize(model, -1, {}, null, [], null));
          results[results.length - 1]!.note = `FAILED: ${String(e).slice(0, 120)}`;
          console.log(`  FAILED — ${String(e).slice(0, 200)}`);
        }
      }
    });
  } finally {
    // Best-effort: anything left behind is e2e-named and swept by cleanup:test-data.
    await withAim(userId, async () => {
      if (e2eJobId) await deleteProcessingJob(e2eJobId).catch((e) => console.warn('job cleanup failed:', String(e)));
      for (const id of cleanupProfileIds) {
        await deleteAiProfile(id).catch((e) => console.warn('profile cleanup failed:', String(e)));
      }
    }).catch((e) => console.warn('cleanup failed (sweep will catch the e2e% rows):', String(e)));
  }

  printTable(results);
  console.log(
    `\nspent: ${results.length} live job run(s) (cap ${HARD_CAP}). n=1 per model — a pointer, not a verdict.`,
  );
}

await main();
process.exit(0); // the AI Admin engine keeps DB pools open; the work above is done and awaited
