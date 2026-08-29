/**
 * FOOD-PHOTO EVAL — can a model actually see how much is on the plate?
 *
 * MANUAL, COSTS MONEY, TALKS TO PROD. Not CI, for the same reasons as `eval-tool-selection.ts`:
 * it spends real tokens per run and measures something stochastic. Run it when choosing a vision
 * model or changing a photo prompt; compare a before/after pair from the same day.
 *
 * WHY IT EXISTS. On 2026-08-20 two photo logs came back empty and were stored as settled 0-kcal
 * meals. The immediate cause was a quota wall with no failover, and that is fixed. The question it
 * left behind is the one this script answers: when the vision call DOES succeed, how good is it?
 * Nobody knew, because the only thing the app ever kept was the JSON — and a plausible-looking
 * `{"kcal": 320}` gives you no way to tell a model that read the cup from one that pattern-matched
 * "latte" to an average. The owner's proposal is the fix and the hypothesis at once: ask the eyes
 * for PROSE first, then convert. This measures both halves separately, which is the entire point —
 * one number for a two-step process tells you nothing about which step is failing.
 *
 * THE THREE THINGS IT RUNS, per case:
 *   baseline  — today's one-stage `parse-meal`: photo -> JSON, in one call. The thing to beat.
 *   stage 1   — `describe-meal-photo`: photo -> prose. Scored for what it SAW (recall, invented
 *               items, whether a portion was anchored to an object in frame, whether it admitted
 *               doubt). This is the measurement that did not exist before.
 *   stage 2   — `parse-meal-description`: prose -> JSON, no image. Scored for numbers.
 *
 * --sweep runs stage 1 across several models to compare eyesight, calling the provider directly.
 * That is deliberately NOT the app's path and is labelled so in the output: it isolates the model
 * from the job/profile/failover machinery, which is what you want when picking a model and exactly
 * what you do not want when validating the pipeline. Default (no --sweep) runs the app's path.
 *
 * WHAT IT CANNOT TELL YOU:
 *   1. Ground truth is thin. The two seed cases are `caption-only` (see the case file); kcal
 *      accuracy is SKIPPED for them rather than guessed. Until somebody fills in what was actually
 *      eaten, this measures description quality and number PLAUSIBILITY, not number correctness.
 *   2. Two cases is not a benchmark. It is two real failures. Treat a difference of one case as an
 *      anecdote and add photos before believing a ranking.
 *   3. A prose description is graded by string matching over hand-written aliases, so it rewards
 *      naming things the case file anticipated. Read the transcripts (--verbose), not just the table.
 *
 * Run:
 *   node --import tsx apps/cadence-api/scripts/eval-food-vision.ts
 *   node --import tsx apps/cadence-api/scripts/eval-food-vision.ts --sweep gpt-5-mini,gemini-3.1-pro
 *   ... [--case parfait] [--verbose] [--json out.json]
 */
import '../src/config.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signMealPhotoUrl } from '../src/services/meal-photos.ts';
import { runJobBySlug } from '../src/ai/aim.ts';
import { FOOD_VISION_CASES, type FoodVisionCase } from './eval-food-vision-cases.ts';
import { scoreDescription, scoreMacros, type DescriptionScore, type MacroScore } from './eval-food-vision-score.ts';
import { printReport, type CaseResult } from './eval-food-vision-report.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : (argv[i + 1] ?? '');
};
const has = (n: string) => argv.includes(`--${n}`);

const EVAL_USER = process.env.CADENCE_DEV_USER_ID || '';

/**
 * Prompts are read from the job config rather than copied here. A prompt that drifts from the one
 * the app runs makes the whole exercise a measurement of a file nobody deploys.
 */
function promptFor(jobName: string): string {
  const cfg = JSON.parse(readFileSync(path.join(REPO, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
    jobs?: Array<{ name?: string; config?: { promptTemplate?: string } }>;
  };
  const job = cfg.jobs?.find((j) => j.name === jobName);
  if (!job) throw new Error(`Job "${jobName}" is not in ai-admin.config.json`);
  const tpl = job.config?.promptTemplate;
  if (!tpl) throw new Error(`Job "${jobName}" has no promptTemplate`);
  return tpl;
}

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function imageUrlFor(c: FoodVisionCase): Promise<string> {
  if (c.photoRef) return signMealPhotoUrl(c.photoRef, 900);
  if (c.file) throw new Error(`Case "${c.key}" uses a local file; --sweep reads storage refs only for now`);
  throw new Error(`Case "${c.key}" has neither photoRef nor file`);
}

/**
 * Direct provider calls — used ONLY by --sweep. Deliberately NOT the app's path.
 *
 * It exists because it is the only mode that runs from a laptop. Image-bearing jobs take the
 * in-process route (see `runJobBySlug`: images ride in-process only), which needs
 * CREDENTIAL_ENCRYPTION_KEY to decrypt the stored provider key — a prod secret that is not on this
 * machine, so the app path 401s here and can only be run from the deployment. Rather than let that
 * stop the measurement, --sweep carries its own key and runs all three calls itself: the one-stage
 * baseline, stage 1, and stage 2. Same prompts, read from the same job config. What it does NOT
 * exercise is profile resolution, failover, and the audit trail — so it answers "which model sees
 * best", never "does the pipeline work".
 */
/**
 * `createResponse` hands back the raw SSE stream as `{ raw }`, not a parsed object — so the text
 * has to be assembled from the events, exactly as `sse-transform.ts` does for the app. This is
 * worth spelling out because getting it wrong is silent: the first version of this script read a
 * non-existent `output_text` field and scored FIVE different vendors at 0% recall / "empty reply"
 * on both photos. Ten identical zeros is an instrument fault, never a finding — a result that
 * uniform is the harness reporting on itself.
 */
function readSseText(raw: string): { text: string; inTokens: number | null; error: string | null } {
  let text = '';
  let done = '';
  let inTokens: number | null = null;
  let error: string | null = null;

  for (const line of (raw || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let e: Record<string, never>;
    try {
      e = JSON.parse(payload);
    } catch {
      continue;
    }
    const ev = e as unknown as {
      type?: string;
      delta?: string;
      text?: string;
      response?: { usage?: { input_tokens?: number }; error?: unknown; status?: string };
      message?: string;
    };
    if (ev.type === 'response.output_text.delta' && ev.delta) text += ev.delta;
    else if (ev.type === 'response.output_text.done' && ev.text) done = ev.text;
    else if (ev.type === 'response.completed' || ev.type === 'response.done') {
      if (ev.response?.usage?.input_tokens != null) inTokens = ev.response.usage.input_tokens;
    } else if (ev.type === 'response.failed' || ev.type === 'error') {
      error = JSON.stringify(ev.response?.error ?? ev.message ?? ev).slice(0, 300);
    }
  }
  return { text: text || done, inTokens, error };
}

async function callModel(
  model: string,
  prompt: string,
  imageUrl: string | null,
): Promise<{ text: string; ms: number; inTokens: number | null }> {
  const { DevsAiV2Client } = await import('../../../backend/src/integrations/devs-ai-v2/client.ts');
  const client = new DevsAiV2Client(
    process.env.DEVS_AI_BASE_URL || 'https://devs.ai',
    process.env.DEVS_AI_API_KEY || '',
  );
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }];
  if (imageUrl) content.push({ type: 'input_image', image_url: imageUrl });

  const t0 = Date.now();
  const res = (await client.createResponse({ model, input: [{ role: 'user', content }] })) as unknown as {
    raw?: string;
  };
  const { text, inTokens, error } = readSseText(res.raw ?? '');
  if (error && !text) throw new Error(`provider: ${error}`);
  return { text, ms: Date.now() - t0, inTokens };
}

async function runSweepCase(c: FoodVisionCase, models: string[], converter: string): Promise<CaseResult[]> {
  const imageUrl = await imageUrlFor(c);
  const hint = c.mealHint ?? '';
  const describePrompt = fill(promptFor('describe_meal_photo'), { caption: c.caption ?? '' });
  const baselinePrompt = fill(promptFor('parse_meal'), {
    meal_text: c.caption || '(no caption — read the photo)',
    meal_hint: hint,
  });
  const convertTpl = promptFor('parse_meal_description');

  const out: CaseResult[] = [];
  for (const model of models) {
    const r: CaseResult = { case: c, model };

    // One-stage: what ships today, same prompt, this model.
    try {
      const b = await callModel(model, baselinePrompt, imageUrl);
      r.baseline = scoreMacros(b.text, c);
      r.baselineRaw = b.text;
      r.baselineMs = b.ms;
    } catch (e) {
      r.baselineError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    // Stage 1: prose.
    try {
      const d = await callModel(model, describePrompt, imageUrl);
      r.description = d.text;
      r.desc = scoreDescription(d.text, c);
      r.describeMs = d.ms;
      r.describeInTokens = d.inTokens;
    } catch (e) {
      r.describeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    // Stage 2: numbers from that prose, no image, on the converter model. Held constant across the
    // sweep so a difference in the numbers is attributable to the DESCRIPTION and not to the maths.
    if (r.description) {
      try {
        const t = await callModel(
          converter,
          fill(convertTpl, { description: r.description, meal_text: c.caption ?? '', meal_hint: hint }),
          null,
        );
        r.twoStage = scoreMacros(t.text, c);
        r.twoStageRaw = t.text;
        r.twoStageMs = t.ms;
        r.converter = converter;
      } catch (e) {
        r.twoStageError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }
    out.push(r);
  }
  return out;
}

async function runPipeline(c: FoodVisionCase): Promise<CaseResult> {
  const images = [await imageUrlFor(c)];
  const hint = c.mealHint ?? '';
  const result: CaseResult = { case: c, model: 'app pipeline (job profile)' };

  // Baseline: what ships today.
  const tb = Date.now();
  try {
    const res = await runJobBySlug(
      EVAL_USER,
      'parse-meal',
      {
        meal_text: c.caption || '(no caption — read the photo)',
        meal_hint: hint,
      },
      { images },
    );
    result.baseline = scoreMacros(res.formatted ?? res.raw ?? '', c);
    result.baselineRaw = res.formatted ?? res.raw ?? '';
  } catch (e) {
    result.baselineError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  result.baselineMs = Date.now() - tb;

  // Stage 1 — prose.
  const t1 = Date.now();
  try {
    const res = await runJobBySlug(EVAL_USER, 'describe-meal-photo', { caption: c.caption ?? '' }, { images });
    result.description = res.formatted ?? res.raw ?? '';
    result.desc = scoreDescription(result.description, c);
  } catch (e) {
    result.describeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  result.describeMs = Date.now() - t1;

  // Stage 2 — numbers from prose, no image.
  if (result.description) {
    const t2 = Date.now();
    try {
      const res = await runJobBySlug(EVAL_USER, 'parse-meal-description', {
        description: result.description,
        meal_text: c.caption ?? '',
        meal_hint: hint,
      });
      result.twoStage = scoreMacros(res.formatted ?? res.raw ?? '', c);
      result.twoStageRaw = res.formatted ?? res.raw ?? '';
    } catch (e) {
      result.twoStageError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    result.twoStageMs = Date.now() - t2;
  }
  return result;
}

async function main() {
  const only = flag('case');
  const cases = only ? FOOD_VISION_CASES.filter((c) => c.key === only) : FOOD_VISION_CASES;
  if (!cases.length) throw new Error(`No case matches --case ${only}`);

  const sweepModels = (flag('sweep') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sweeping = has('sweep') && sweepModels.length > 0;
  const converter = flag('converter') || 'gpt-5-mini';

  if (!sweeping && !EVAL_USER) {
    throw new Error('CADENCE_DEV_USER_ID must be set to run the app pipeline (or use --sweep <models>)');
  }
  if (sweeping && !process.env.DEVS_AI_API_KEY) {
    throw new Error('--sweep calls the provider directly and needs DEVS_AI_API_KEY in backend/.env');
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    console.log(`\n▶ ${c.key} — ${c.note}`);
    if (sweeping) results.push(...(await runSweepCase(c, sweepModels, converter)));
    else results.push(await runPipeline(c));
  }

  printReport(results, { sweeping, verbose: has('verbose') });
  const out = flag('json');
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`\nwrote ${out}`);
  }
  process.exit(0);
}

export type { DescriptionScore, MacroScore };
main().catch((e) => {
  console.error('\nEVAL FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
