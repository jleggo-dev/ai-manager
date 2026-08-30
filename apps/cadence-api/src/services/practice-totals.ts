/**
 * The countable side of a practice, added up.
 *
 * Extracted from the coach tool `get_practice_totals` (services/retrieval/registry.ts) so the
 * SAME computation backs both the coach's answer to "how much have I written this month?" and
 * the Progress Engine's `total` widget (docs/cadence/PROGRESS-ENGINE.md, W1-5) — two callers,
 * one math, never two. `aggregatePracticeTotals` is the pure half (fixture-testable, no DB);
 * `computePracticeTotals` is the thin fetch-then-aggregate wrapper both callers actually invoke.
 *
 * Deliberately metric-agnostic: words and minutes are why it exists (the mind and practice
 * pillars, where progress is not a weight or a pace), but reps and pages ride the same path for
 * free, and a metric this app has never heard of will still total correctly.
 */
import { listLoggedForProgress } from '../repos/occurrences.ts';

export interface PracticeTotal {
  title: string;
  metric: string;
  total: number;
  sessions: number;
}

/** One logged row's shape as `listLoggedForProgress` hands it back — just enough to total. */
export interface LoggedProgressRow {
  title: string;
  value: Record<string, number> | null;
}

/** Fold logged rows into per-(activity, metric) totals, most-logged first. Pure — no I/O. */
export function aggregatePracticeTotals(rows: LoggedProgressRow[]): PracticeTotal[] {
  const totals = new Map<string, PracticeTotal>();
  for (const r of rows) {
    for (const [metric, v] of Object.entries(r.value ?? {})) {
      if (!Number.isFinite(v)) continue;
      const key = `${r.title}|${metric}`;
      const cur = totals.get(key) ?? { title: r.title, metric, total: 0, sessions: 0 };
      cur.total += v;
      cur.sessions += 1;
      totals.set(key, cur);
    }
  }
  return [...totals.values()].sort((a, b) => b.sessions - a.sessions);
}

/** Fetch + aggregate for one user over the trailing `days` (clamped 1-365, default 30). */
export async function computePracticeTotals(
  userId: string,
  days: number,
): Promise<{ days: number; totals: PracticeTotal[] }> {
  const clampedDays = Math.min(365, Math.max(1, days));
  const from = new Date(Date.now() - clampedDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await listLoggedForProgress(userId, from);
  return { days: clampedDays, totals: aggregatePracticeTotals(rows) };
}
