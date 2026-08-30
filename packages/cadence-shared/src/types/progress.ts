/* ── Progress module (deterministic; LLM never computes numbers) ─────────────── */

import type { GoalArea } from './baseline.ts';

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** One dashboard card. The KIND union is the whole "coach-defined dashboard" contract:
 *  which cards exist derives from the user's actual goals + logged data (variable content,
 *  stable renderer); an LLM spec layer can later emit the same shapes. */
export type ProgressCard =
  | {
      kind: 'latest_vs_target';
      area: GoalArea;
      title: string;
      unit: string;
      /** The most recent raw reading. Kept, but no longer the headline — see `trend` (A23 §2c). */
      latest: number | null;
      start: number | null;
      target: number;
      series: SeriesPoint[];
      /**
       * The SMOOTHED current value, and what the card leads with. A morning's weight is mostly
       * water; showing it as the number is what makes stepping on a scale feel like a verdict.
       * Null until there is enough series to smooth, in which case the raw latest stands in.
       */
      trend?: number | null;
      /** Signed change per week in the same unit — negative is down. */
      rate_per_week?: number | null;
      /** How much data is behind the trend, so the UI can hedge rather than assert. */
      confidence?: 'low' | 'medium' | 'high' | null;
    }
  | { kind: 'count'; area: GoalArea; title: string; goal_id: string; current: number; target: number; unit: string }
  | {
      kind: 'countdown';
      area: GoalArea;
      title: string;
      end: string;
      days_left: number;
      milestones_done: number;
      milestones_total: number;
    }
  | { kind: 'consistency'; area: GoalArea; title: string; kept: number; window: number };

/** A per-activity trend derived from session logs (pace, top load). */
export interface ProgressTrend {
  title: string; // activity title (the cross-plan history key)
  metric: 'pace_min_per_km' | 'top_load_kg' | 'distance_km' | 'duration_min';
  label: string; // human: "Pace", "Top load"
  unit: string;
  series: SeriesPoint[];
  direction_good: 'down' | 'up'; // pace down = better; load up = better
}

export interface HistoryEntry {
  at: string; // ISO or YYYY-MM-DD
  kind: 'session' | 'event';
  title: string; // activity title or event label
  detail: string; // log summary or event context
}

export interface ProgressData {
  cards: ProgressCard[];
  trends: ProgressTrend[];
  history: HistoryEntry[];
  /** The raw ledger rows behind `history`'s event entries (newest first, bounded) — kept whole so
   *  readers can filter by kind; `history` merges and truncates, which loses that. Optional
   *  because older stored copies of this shape predate the field. */
  events?: GoalEvent[];
}

/** A countable, dated accomplishment ("finished Dune") — powers count-goal progress (20/100)
 *  and the History feed. goal_id nullable: deleting a goal never erases history. */
export interface GoalEvent {
  event_id: string;
  user_id: string;
  goal_id?: string | null;
  kind: 'completion' | 'note';
  label: string;
  at: string;
  meta?: Record<string, unknown> | null;
}
