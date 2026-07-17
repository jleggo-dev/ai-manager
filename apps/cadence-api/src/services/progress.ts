/**
 * The Progress module — ENTIRELY deterministic (the house rule flipped: here the app computes
 * everything and no LLM is involved; a coach-authored "spec" layer can later emit the same
 * ProgressCard shapes without touching this engine or the renderer).
 *
 * "Variable, coach-shaped" content falls out of the DATA: cards derive from the user's actual
 * goals (type + unit) and trends from activities that have real logged points — a user with no
 * fitness goals simply has no fitness cards.
 *
 * Metric keys in occurrence.value are model-chosen and messy in practice (distance_m observed
 * where the prompt said distance_km) — the alias normalizer folds known keys to canonical
 * metrics with unit conversion and IGNORES unknowns; it never guesses.
 */
import type { Goal, HistoryEntry, OccurrenceLog, ProgressCard, ProgressData, ProgressTrend, SeriesPoint } from '@cadence/shared';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser } from '../repos/users.ts';
import { listLoggedForProgress } from '../repos/occurrences.ts';
import { countGoalCompletions, listGoalEvents } from '../repos/goal-events.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { rollingConsistency } from './metrics.ts';

const WINDOW_DAYS = 90;
const LB_PER_KG = 2.2046226218;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/* ── Metric alias normalizer ───────────────────────────────────────────── */

/** Fold a raw value/rollup map into canonical metrics. Unknown keys are ignored, never guessed. */
export function canonicalMetrics(raw: Record<string, number> | null | undefined): { distance_km?: number; duration_min?: number; weight_kg?: number } {
  const out: { distance_km?: number; duration_min?: number; weight_kg?: number } = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    const key = k.toLowerCase();
    if (key === 'distance_km' || key === 'km') out.distance_km = (out.distance_km ?? 0) + v;
    else if (key === 'distance_m' || key === 'meters' || key === 'metres') out.distance_km = (out.distance_km ?? 0) + v / 1000;
    else if (key === 'distance_mi' || key === 'miles') out.distance_km = (out.distance_km ?? 0) + v * 1.609344;
    else if (key === 'duration_min' || key === 'time_min' || key === 'minutes') out.duration_min = (out.duration_min ?? 0) + v;
    else if (key === 'duration_sec' || key === 'seconds') out.duration_min = (out.duration_min ?? 0) + v / 60;
    else if (key === 'weight_kg') out.weight_kg = v;
    else if (key === 'weight_lb' || key === 'weight_lbs') out.weight_kg = v / LB_PER_KG;
  }
  return out;
}

/** Item-level fallback when the rollup map is empty: sum the app-normalized item quantities. */
function metricsFromItems(log: OccurrenceLog | null): { distance_km?: number; duration_min?: number } {
  if (!log?.items?.length) return {};
  let distance_km = 0;
  let duration_min = 0;
  for (const i of log.items) {
    if (i.done === false) continue;
    if (typeof i.distance_km === 'number') distance_km += i.distance_km;
    if (typeof i.duration_min === 'number') duration_min += i.duration_min;
  }
  return { ...(distance_km > 0 ? { distance_km } : {}), ...(duration_min > 0 ? { duration_min } : {}) };
}

/** Parse "55 lb" / "25 kg" load strings → kg. "bodyweight"/"zone 2" are skipped, not coerced. */
export function parseLoadKg(load: string | undefined): number | null {
  if (!load) return null;
  const m = /(\d+(?:\.\d+)?)\s*(lb|lbs|kg)/i.exec(load);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2]!.toLowerCase() === 'kg' ? n : n / LB_PER_KG;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── The assembled view ────────────────────────────────────────────────── */

const COUNTABLE_UNIT = /book|session|class|workout|chapter|badge|race/i;
const WEIGHTY_UNIT = /^(kg|kgs|lb|lbs|pound|pounds)$/i;

export async function buildProgress(userId: string): Promise<ProgressData> {
  const from = iso(Date.now() - WINDOW_DAYS * 86_400_000);
  // confirmed AND committed: a count goal ("read 100 books") is trackable even if it never
  // produces plan activities, and replan-era goals can sit at confirmed indefinitely.
  const [goals, user, rows, events] = await Promise.all([
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    getUser(userId),
    listLoggedForProgress(userId, from),
    listGoalEvents(userId, 30),
  ]);

  /* Series from logs */
  const weightSeries: SeriesPoint[] = [];
  const paceByTitle = new Map<string, SeriesPoint[]>();
  const loadByTitle = new Map<string, SeriesPoint[]>();
  for (const r of rows) {
    const m = { ...metricsFromItems(r.log), ...canonicalMetrics(r.value) };
    if (m.weight_kg) weightSeries.push({ date: r.date, value: round1(m.weight_kg) });
    // Pace only when BOTH legs exist in the same log and the distance is a real run (≥1km).
    if (m.distance_km && m.duration_min && m.distance_km >= 1) {
      const arr = paceByTitle.get(r.title) ?? [];
      arr.push({ date: r.date, value: round1(m.duration_min / m.distance_km) });
      paceByTitle.set(r.title, arr);
    }
    // Top parsed load per session, keyed by activity TITLE (the cross-plan history key).
    let top = 0;
    for (const i of r.log?.items ?? []) {
      const kg = parseLoadKg(i.load);
      if (kg && i.done !== false && kg > top) top = kg;
    }
    if (top > 0) {
      const arr = loadByTitle.get(r.title) ?? [];
      arr.push({ date: r.date, value: round1(top) });
      loadByTitle.set(r.title, arr);
    }
  }

  /* Goal cards — deterministic type/unit mapping */
  const cards: ProgressCard[] = [];
  const baseline = (user?.baseline ?? {}) as { weight_kg?: { current?: number; start?: number }; weight_unit?: string };
  const userUnit = baseline.weight_unit === 'lb' ? 'lb' : 'kg';
  const toUserUnit = (kg: number) => (userUnit === 'lb' ? round1(kg * LB_PER_KG) : round1(kg));

  for (const g of goals) {
    const unit = (g.measure?.unit ?? '').trim();
    const target = g.measure?.target;
    if (g.type === 'target' && typeof target === 'number' && WEIGHTY_UNIT.test(unit)) {
      const latestKg = weightSeries.length ? weightSeries[weightSeries.length - 1]!.value : baseline.weight_kg?.current ?? null;
      const startKg = baseline.weight_kg?.start ?? (weightSeries.length ? weightSeries[0]!.value : null);
      cards.push({
        kind: 'latest_vs_target',
        title: g.title,
        unit: userUnit,
        latest: latestKg !== null ? toUserUnit(latestKg) : null,
        start: startKg !== null && startKg !== undefined ? toUserUnit(startKg) : null,
        target, // targets are stated in the user's own unit at capture time
        series: weightSeries.map((p) => ({ date: p.date, value: toUserUnit(p.value) })),
      });
    } else if (g.type === 'target' && typeof target === 'number' && COUNTABLE_UNIT.test(unit)) {
      cards.push({
        kind: 'count',
        title: g.title,
        goal_id: g.goal_id,
        current: await countGoalCompletions(userId, g.goal_id),
        target,
        unit: unit || 'done',
      });
    } else if (g.type === 'milestone' && g.timeframe?.end) {
      const days = Math.max(0, Math.ceil((new Date(g.timeframe.end + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000));
      const ms = g.milestones ?? [];
      cards.push({
        kind: 'countdown',
        title: g.title,
        end: g.timeframe.end,
        days_left: days,
        milestones_done: ms.filter((m) => (m as { done?: boolean }).done).length,
        milestones_total: ms.length,
      });
    } else if (g.type === 'recurring') {
      const now = new Date();
      const past = await listOccurrences(userId, iso(Date.now() - 6 * 86_400_000), iso(Date.now()));
      const { kept, window } = rollingConsistency(past as never, now, 7);
      cards.push({ kind: 'consistency', title: g.title, kept, window });
    }
  }

  // Observe-phase food card — appears only when meals are actually logged (stable chrome,
  // variable content). days_logged doubles as the nutrition module's phase signal.
  const foodDays = summarizeNutrition(
    await listNutritionLogs(userId, iso(Date.now() - 6 * 86_400_000), iso(Date.now())),
    7,
  ).days_logged;
  if (foodDays > 0) cards.push({ kind: 'consistency', title: 'Food log', kept: foodDays, window: 7 });

  /* Activity trends — only titles with ≥2 honest points (sparse-but-honest rule) */
  const trends: ProgressTrend[] = [];
  for (const [title, series] of paceByTitle) {
    if (series.length >= 2) trends.push({ title, metric: 'pace_min_per_km', label: 'Pace', unit: 'min/km', series, direction_good: 'down' });
  }
  for (const [title, series] of loadByTitle) {
    if (series.length >= 2) {
      trends.push({
        title,
        metric: 'top_load_kg',
        label: 'Top load',
        unit: userUnit,
        series: series.map((p) => ({ date: p.date, value: toUserUnit(p.value) })),
        direction_good: 'up',
      });
    }
  }

  /* History — done sessions with summaries + accomplishments, newest first */
  const history: HistoryEntry[] = [
    ...rows
      .filter((r) => r.log?.summary)
      .map((r): HistoryEntry => ({ at: r.date, kind: 'session', title: r.title, detail: r.log!.summary })),
    ...events.map((e): HistoryEntry => ({ at: e.at.slice(0, 10), kind: 'event', title: e.label, detail: (e.meta as { activity_title?: string } | null)?.activity_title ? `logged with ${(e.meta as { activity_title?: string }).activity_title}` : 'accomplishment' })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 40);

  return { cards, trends, history };
}
