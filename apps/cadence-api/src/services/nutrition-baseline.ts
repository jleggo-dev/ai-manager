/**
 * The Baseline moment and the ADAPTIVE REVIEW — the coaching loop that owns macro targets.
 *
 * Split out of nutrition.ts (2026-08-22, A23) because it is a distinct responsibility from
 * recording a meal, and because Phase 3 grows it: today the loop reads the weigh-in trend alone
 * and nudges ±100–150 kcal, and the plan is to anchor it on an implied maintenance computed from
 * the ledger's own units (docs/cadence/DESIGN-consistent-ledger.md §3). Extracted before it grew,
 * per the size rule rather than after CI caught it.
 *
 * Suggest-never-auto-apply throughout: the deterministic gate decides whether to ASK for targets,
 * the model may propose, and only the user's tap commits (setTargets, in nutrition.ts).
 */
import { type Macros } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser, setMacroTargets } from '../repos/users.ts';
import { listWeighInSeries } from '../repos/occurrences.ts';
import { paceRead } from './weight-trend.ts';
import { getCalibration } from './calibration.ts';
import { clampProposal } from './energy-balance.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { sanitizeTargets } from './nutrition-day.ts';
import { wantsTargets } from './nutrition-parse.ts';
import { logAi } from './ai-log.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

export type BaselineRead =
  | { ready: false; days_logged: number; days_needed: number }
  | {
      ready: true;
      read: string;
      suggestion: string;
      rationale: string;
      /** Coach-proposed daily targets (S4) — suggest-never-auto-apply; null when not warranted
       *  (no eating/weight goal), already set (Settings owns edits), or the model declined. */
      proposed_targets: Macros | null;
      targets_rationale: string | null;
    };

/** Distinct logged days before the Baseline moment fires (also drives the day view's countdown). */
export const OBSERVE_DAYS_NEEDED = 7;

/**
 * The Baseline moment (module arc): after ~7 OBSERVED days, the coach gives their pattern read
 * and proposes exactly ONE gradual change. The gate is deterministic (distinct logged days);
 * the read is grounded in the actual log; the change is suggest-never-auto-apply — the caller
 * hands `suggestion` to the replan steer, and the existing preview→confirm flow owns the commit.
 */
export async function getBaselineRead(userId: string): Promise<BaselineRead> {
  const to = today();
  const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10); // 14d window: a slow logger still crosses the gate
  const meals = await listNutritionLogs(userId, from, to);
  const summary = summarizeNutrition(meals, 14);
  if (summary.days_logged < OBSERVE_DAYS_NEEDED) {
    return { ready: false, days_logged: summary.days_logged, days_needed: OBSERVE_DAYS_NEEDED };
  }

  const [goals, user, weighSeries] = await Promise.all([
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    getUser(userId),
    listWeighInSeries(userId),
  ]);
  const hasTargets = !!user?.macro_targets && Object.keys(user.macro_targets).length > 0;

  // Two proposal modes. INITIAL (Baseline moment): propose targets only when a goal warrants them and
  // none are set. ADAPTIVE (recurring): once targets ARE set and the weigh-in trend is trustworthy,
  // propose an ADJUSTED target from the trend vs. a safe rate — throttled to ~weekly via last_reviewed.
  const currentKg = user?.baseline?.weight_kg?.current;
  // A23 §2a: the smoothed fit, not a line through two mornings — one bloated Sunday must not read
  // as a stalled month and buy the user a calorie cut.
  const pace = paceRead(weighSeries, currentKg);
  const lastReviewed = user?.macro_targets?.last_reviewed;
  const dueForReview = !lastReviewed || Date.now() - Date.parse(lastReviewed) >= 7 * 86_400_000;
  const proposeAdaptive = hasTargets && pace !== null && dueForReview;
  const propose = proposeAdaptive || (!hasTargets && wantsTargets(goals));

  const weightTrend = proposeAdaptive ? pace : null;

  // A23 §3 — hand the model the maintenance the app computed rather than letting it reason toward
  // a number from the trend alone. Anchored beats blind: the old ADAPTIVE REVIEW clause could only
  // nudge ±100-150 kcal because it had nothing to nudge FROM.
  const calibration = await getCalibration(userId, today()).catch(() => null);

  const res = await runJobBySlug(userId, 'nutrition-baseline', {
    summary: JSON.stringify(summary),
    meals: JSON.stringify(
      meals.map((m) => ({ date: m.date, meal: m.meal, items: m.items.map((i) => i.name), flags: m.flags })),
    ),
    goals: JSON.stringify(goals.map((g) => ({ title: g.title, area: g.area, type: g.type, measure: g.measure }))),
    baseline: JSON.stringify(user?.baseline ?? {}),
    propose_targets: propose ? 'yes' : 'no',
    weight_trend: weightTrend ? JSON.stringify(weightTrend) : '',
    current_targets: proposeAdaptive ? JSON.stringify(user?.macro_targets ?? {}) : '',
    implied_maintenance: calibration?.maintenance
      ? JSON.stringify({
          // Ledger units, and named as such: this is maintenance as THIS APP counts calories, not
          // a measured fact about their metabolism, and the difference matters to how it is said.
          kcal_in_app_units: calibration.maintenance.maintenance_kcal,
          from_days_logged: calibration.maintenance.complete_days,
          confidence: calibration.maintenance.confidence,
          app_would_suggest_kcal: calibration.proposed?.kcal ?? null,
        })
      : '',
  });
  const raw = res.formatted ?? res.raw ?? '';
  const parsed = JSON.parse(raw) as {
    read?: unknown;
    suggestion?: unknown;
    rationale?: unknown;
    proposed_targets?: unknown;
    targets_rationale?: unknown;
  };
  const read = typeof parsed.read === 'string' ? parsed.read.trim() : '';
  const suggestion = typeof parsed.suggestion === 'string' ? parsed.suggestion.trim().slice(0, 300) : '';
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  if (!read || !suggestion) throw new Error('nutrition-baseline returned an incomplete read');
  // The deterministic gate is the wall — a proposal the app didn't ask for is discarded.
  const sanitized = propose ? sanitizeTargets(parsed.proposed_targets) : null;
  // …and the guardrails are the second wall (A23 §3). "Never more than ~15% below maintenance" and
  // "small steps, never a big swing" were sentences in the prompt — requests a model was asked to
  // remember. Now that maintenance is a number they are enforceable, and a rule that CAN be
  // enforced should not be left as a request.
  let proposedTargets = sanitized;
  if (sanitized && typeof sanitized.kcal === 'number') {
    const clamped = clampProposal(sanitized.kcal, {
      current_kcal: typeof user?.macro_targets?.kcal === 'number' ? user.macro_targets.kcal : null,
      maintenance_kcal: calibration?.maintenance?.maintenance_kcal ?? null,
      adjustments: user?.macro_targets?.adjustments ?? [],
      today: today(),
    });
    proposedTargets = { ...sanitized, kcal: clamped.kcal };
  }
  const targetsRationale =
    proposedTargets && typeof parsed.targets_rationale === 'string' ? parsed.targets_rationale.trim() : null;

  // Throttle: stamp the review time so an adaptive proposal doesn't re-fire until ~a week out
  // (whether or not the user accepts). Merge-write — keeps the macros + other settings intact.
  if (proposeAdaptive) await setMacroTargets(userId, { ...user?.macro_targets, last_reviewed: today() });

  void logAi(userId, {
    kind: 'nutrition_baseline',
    input: { summary },
    output: { raw: raw.slice(0, 2000) },
    meta: { days_logged: summary.days_logged, proposed_targets: !!proposedTargets, adaptive: proposeAdaptive },
  });
  return {
    ready: true,
    read,
    suggestion,
    rationale,
    proposed_targets: proposedTargets,
    targets_rationale: targetsRationale,
  };
}
