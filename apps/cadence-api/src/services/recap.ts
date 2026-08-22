/**
 * A23 §2b — "Your weekly check-in", at last given a body.
 *
 * The `weekly_readout` job has existed in config since the beginning with ZERO callers: fully
 * specified, never invoked, its own description insisting "the app supplies ALL data as variables;
 * the model only narrates." Meanwhile `rollingConsistency` names the recap as its consumer in a
 * docstring nothing honours, and the check-in itself is a plan row that says "just tap it done".
 * This file is the missing half.
 *
 * The division of labour is the same one the whole ledger rests on: **code computes, the model
 * narrates.** Every number here comes out of Postgres and arithmetic; the job turns them into a
 * warm paragraph and asks how the week actually felt. Nothing it writes can change a number, and
 * the panel renders the numbers itself — so a failed narration costs the prose, never the read.
 *
 * It also answers the question DESIGN-PROMPT-food-plan.md closed on: the weigh-in and the check-in
 * were two unconnected Sunday tasks, and the recap now carries the weigh-in with it. One moment.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { listEpisodeRanges } from '../repos/episodes.ts';
import { findWeighInOccurrence, listOccurrences, listWeighInSeries } from '../repos/occurrences.ts';
import { getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { rollingConsistency } from './metrics.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { paceRead, type PaceRead } from './weight-trend.ts';

/** The window the check-in speaks to. Seven days, ending on the day it lands. */
const WEEK = 7;
/** The longer view the coach may reference so one ordinary week is not read as a trend. */
const ROLLING = 28;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface RecapNutrition {
  /** Days they recorded something — a provisional row still counts as showing up. */
  days_logged: number;
  /**
   * Days with numbers we actually trust, and the ONLY days the averages divide by. Reported
   * separately because "4 days logged, averaging 2000 kcal" would otherwise invite multiplying
   * two figures that were never about the same days.
   */
  days_counted: number;
  days_in_window: number;
  avg_kcal: number | null;
  target_kcal: number | null;
  avg_protein_g: number | null;
}

export interface RecapWeighIn {
  occurrence_id: string;
  date: string;
  /** Still open — the panel leads with the scale instead of the readout. */
  pending: boolean;
}

export interface WeeklyRecap {
  period: { from: string; to: string };
  consistency: { kept: number; window: number };
  rolling: { kept: number; window: number };
  goals: Array<{ title: string; area: string | null }>;
  nutrition: RecapNutrition | null;
  weight: PaceRead | null;
  episodes: Array<{ start: string; end: string }>;
  /** The coach's narration. Empty when the job failed — the numbers still stand. */
  note: string;
  weigh_in: RecapWeighIn | null;
}

/** Everything the recap says, computed. No AI in this function — that is the point of it. */
export async function buildRecapFacts(userId: string, today: string): Promise<Omit<WeeklyRecap, 'note'>> {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const from = iso(todayMs - (WEEK - 1) * 86_400_000);
  const rollingFrom = iso(todayMs - (ROLLING - 1) * 86_400_000);

  const [occurrences, rollingOccurrences, meals, goals, user, weighSeries, episodes] = await Promise.all([
    listOccurrences(userId, from, today),
    listOccurrences(userId, rollingFrom, today),
    listNutritionLogs(userId, from, today),
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    getUser(userId),
    listWeighInSeries(userId),
    listEpisodeRanges(userId, from, today),
  ]);
  const weighIn = await findWeighInOccurrence(userId, from, today);

  const at = new Date(todayMs);
  const summary = summarizeNutrition(meals, WEEK);
  const targets = user?.macro_targets ?? null;
  const targetKcal = typeof targets?.kcal === 'number' ? targets.kcal : null;

  // Averages count only the days they actually logged. Dividing by seven would quietly punish a
  // week they didn't record — the arithmetic version of counting what broke.
  const counted = meals.filter((m) => !m.provisional && typeof m.macros?.kcal === 'number');
  const byDay = new Map<string, number>();
  const proteinByDay = new Map<string, number>();
  for (const m of counted) {
    const day = String(m.date).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (m.macros?.kcal ?? 0));
    const p = m.macros?.protein_g;
    if (typeof p === 'number') proteinByDay.set(day, (proteinByDay.get(day) ?? 0) + p);
  }
  const avg = (m: Map<string, number>): number | null =>
    m.size ? Math.round([...m.values()].reduce((a, b) => a + b, 0) / m.size) : null;

  return {
    period: { from, to: today },
    consistency: rollingConsistency(occurrences, at, WEEK),
    rolling: rollingConsistency(rollingOccurrences, at, ROLLING),
    goals: goals.map((g) => ({ title: g.title, area: g.area ?? null })),
    nutrition: summary.days_logged
      ? {
          days_logged: summary.days_logged,
          days_counted: byDay.size,
          days_in_window: WEEK,
          avg_kcal: avg(byDay),
          target_kcal: targetKcal,
          avg_protein_g: avg(proteinByDay),
        }
      : null,
    weight: paceRead(weighSeries, user?.baseline?.weight_kg?.current),
    episodes,
    weigh_in: weighIn ? { ...weighIn, pending: weighIn.status === 'pending' } : null,
  };
}

/** Compact, model-facing shapes. Small on purpose: the job narrates, it does not analyse. */
function narrationVars(facts: Omit<WeeklyRecap, 'note'>): Record<string, string> {
  const outcomes: Record<string, unknown> = {};
  if (facts.nutrition) {
    outcomes.food = {
      days_logged: `${facts.nutrition.days_logged} of ${facts.nutrition.days_in_window}`,
      // Spelled out so the narration cannot quietly multiply the average by the wrong day count.
      avg_is_over_days: facts.nutrition.days_counted,
      avg_kcal: facts.nutrition.avg_kcal,
      target_kcal: facts.nutrition.target_kcal,
      avg_protein_g: facts.nutrition.avg_protein_g,
    };
  }
  if (facts.weight) {
    outcomes.weight = {
      kg_per_week: facts.weight.actual_kg_per_week,
      safe_kg_per_week: facts.weight.safe_kg_per_week,
      pace: facts.weight.pace,
      // Named so the narration can hedge rather than declare (A23 §2a).
      confidence: facts.weight.confidence,
    };
  }
  return {
    period: `${facts.period.from} to ${facts.period.to}`,
    goals_progress: JSON.stringify(facts.goals),
    consistency: `${facts.consistency.kept} of ${facts.consistency.window} days`,
    outcomes: Object.keys(outcomes).length ? JSON.stringify(outcomes) : '',
    episodes: facts.episodes.length ? JSON.stringify(facts.episodes) : '',
    rolling_window: `${facts.rolling.kept} of ${facts.rolling.window} days`,
  };
}

/**
 * The check-in: the week's facts, plus the coach's read of them.
 *
 * A narration failure is NOT fatal and must not read as one — the same rule the photo path learned
 * on 2026-08-20. The numbers are the check-in; the paragraph is how it sounds.
 */
export async function getWeeklyRecap(
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<WeeklyRecap> {
  const facts = await buildRecapFacts(userId, today);
  const vars = narrationVars(facts);

  let note = '';
  let error: string | null = null;
  try {
    const res = await runJobBySlug(userId, 'weekly-readout', vars);
    note = (res.formatted ?? res.raw ?? '').trim();
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[recap] weekly-readout failed — returning the week without its narration:', error);
  }

  void logAi(userId, {
    kind: 'weekly_readout',
    input: { period: vars.period, consistency: vars.consistency },
    output: { raw: note.slice(0, 2000) },
    meta: {
      days_logged: facts.nutrition?.days_logged ?? 0,
      has_weight: !!facts.weight,
      episodes: facts.episodes.length,
      ...(error ? { failed: true, error } : {}),
    },
  });

  return { ...facts, note };
}
