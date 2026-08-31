/* ── The widget grammar (Progress Engine) ──────────────────────────────────────
 * Design + rationale: docs/cadence/PROGRESS-ENGINE.md. The coach composes WHAT
 * (a ProgressLayout of WidgetSpecs); deterministic code decides HOW — binding
 * resolvers load the data, renderers draw it, and the brand physics (a missed
 * day is neutral, absent data is "not read" never zero, detours are shelter)
 * live in the renderers, enforced by construction.
 *
 * Contract rule — the display-side twin of declared-equals-executable: every
 * kind in WIDGET_KINDS has a renderer AND a binding resolver, and that parity
 * is CI-gated. A section that cannot bind is omitted WITH evidence
 * (WidgetOmission), never silently. This file is the seam between parcels:
 * treat it as frozen during a wave — if it blocks you, report, don't edit.
 */

import type { GoalArea } from './baseline.ts';
import type { HistoryEntry, SeriesPoint } from './progress.ts';

/* Temporal kinds read differently at different windows; non-temporal kinds
 * (shelf, stage_path, count_toward, balance, total, variety, repertoire) are
 * collections, proportions and presence — progress that is not a slope. A
 * layout is ordered sections, never an imposed timeline. */
export const WIDGET_KINDS = [
  'rhythm',
  'trend_vs_target',
  'dated_sessions',
  'weekly_bars',
  'felt_week',
  'shelf',
  'stage_path',
  'count_toward',
  'balance',
  'total',
  'variety',
  'repertoire',
  'recap_rail',
  'history',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export type ProgressWindow = 'week' | 'month' | 'all';

/** What a section watches. Exactly one of the selectors is typically set; the
 *  resolver for the kind knows which it needs and omits-with-evidence otherwise. */
export interface WidgetSource {
  /** A named measure ('weight', 'steps', 'kcal', 'water'…). */
  measure?: string;
  /** A goal (count_toward, stage_path, and goal-scoped shelves). */
  goal_id?: string;
  /** An activity title — the cross-plan history key (dated_sessions). */
  activity?: string;
  /** Session-feedback kind for balance ('movement' | 'mind'). */
  feedback_kind?: string;
  /** 'inherit' follows the page's window control (the default). */
  window?: ProgressWindow | 'inherit';
}

/** Captions bind to COMPUTED facts, never frozen prose — re-windowing must
 *  never need the model and words must never go stale. `template` interpolates
 *  {field} names from the resolved payload. */
export interface WidgetCaption {
  template: string;
}

export interface WidgetSpec {
  id: string;
  kind: WidgetKind;
  /** Warm section heading ("Your runs"). Copy names the goal, never the area. */
  title?: string;
  source?: WidgetSource;
  caption?: WidgetCaption;
  /** The linked goal's area — stamped by the SERVER from the goal row itself (one writer per
   *  fact; the composing model never sets it). Drives the card chip's family color. */
  area?: GoalArea;
  /** The linked goal's end date (YYYY-MM-DD), same provenance — drives the "34 days out" tag. */
  deadline?: string;
}

/** The page composition. The DEFAULT layout is computed deterministically from
 *  goals/areas and never stored; committed layouts live in
 *  cadence.progress_layouts (draft → committed, superseded lineage — mirrors
 *  plans). */
export interface ProgressLayout {
  version: 1;
  status: 'default' | 'draft' | 'committed';
  sections: WidgetSpec[];
}

/* ── Payloads (what a binding resolver hands a renderer) ─────────────────── */

export type RhythmDayState = 'kept' | 'missed' | 'upcoming' | 'unscheduled' | 'checkin';
export interface RhythmWeek {
  start: string; // YYYY-MM-DD (Monday)
  label: string; // "Aug 25–31"
  days: { date: string; state: RhythmDayState }[];
  kept: number;
  scheduled: number; // scheduled-days-only denominator (metrics.ts rule)
  detour?: { type: string; label: string } | null;
}
export interface RhythmPayload {
  weeks: RhythmWeek[]; // most recent first
}

/** Weight-style trend. Same fields the latest_vs_target card already ships. */
export interface TrendVsTargetPayload {
  unit: string;
  latest: number | null;
  start: number | null;
  target: number;
  series: SeriesPoint[];
  trend?: number | null;
  rate_per_week?: number | null;
  confidence?: 'low' | 'medium' | 'high' | null;
}

export interface DatedSession {
  date: string;
  title: string;
  distance_km?: number | null;
  duration_min?: number | null;
  avg_hr?: number | null;
  /** A personal best — the ONE place warm accent is allowed on this widget. */
  best?: boolean;
}
export interface DatedSessionsPayload {
  activity: string;
  sessions: DatedSession[]; // dated, ascending
  total: number;
  last_4_weeks: number;
  usual_hr?: number | null;
}

export interface WeeklyBarsPayload {
  unit: string; // 'steps/day', 'kcal'
  weeks: { label: string; value: number | null }[]; // null = not read, NEVER zero
  latest?: number | null;
}

/** Four side-by-side weeks colored by how the daily check-ins felt (mood, 1–5). `value` is that
 *  week's mean over the days that had a mood noted; null = NO day did — an unread week, drawn as
 *  an outline, never a zero. Always the trailing four weeks: the card honestly ignores the page's
 *  window control. */
export interface FeltWeekPayload {
  /** Oldest → newest; `days` = how many days that week had a mood noted. */
  weeks: { label: string; value: number | null; days: number }[];
}

export interface ShelfPayload {
  events: { label: string; at: string }[]; // bests & firsts — a collection, no axis
}

export interface StagePathPayload {
  stages: { label: string; state: 'done' | 'current' | 'ahead' }[];
  note?: string | null; // "part two — four chapters in"
}

export interface CountTowardPayload {
  current: number;
  target: number;
  unit: string;
}

/** "Calmer after {positive} of {total} {noun}" — counts what happened; the
 *  complement is never rendered as its own (red) series. */
export interface BalancePayload {
  positive_label: string;
  positive: number;
  total: number;
  noun: string;
}

export interface TotalPayload {
  value: number;
  unit: string; // 'minutes sat', 'words'
  window_label: string; // 'this month', 'since July'
}

export interface VarietyPayload {
  count: number;
  noun: string; // 'different dinners'
  window_label: string;
}

/** One repertoire item's standing, as the card shows it. Derived from RepertoireItem:
 *  known → 'learned'; working + practiced → 'in_progress'; working, never practiced →
 *  'not_started' (the coach proposed it, they haven't picked it up). Parked items are
 *  deliberately set aside and never appear here. */
export interface RepertoireCardItem {
  label: string;
  state: 'learned' | 'in_progress' | 'not_started';
  /** 'YYYY-MM' — the month it crossed to learned in front of us. null for items they already
   *  knew when they told us (backfilled): learned, honestly, but with no date to show. */
  learned_month?: string | null;
  /** Whole weeks since they started working it (min 1) — in-progress items only. */
  weeks_in?: number | null;
}

/** "Measured in pieces, not minutes" — the list of what they're learning or already have.
 *  `learned`/`in_progress` count the WHOLE repertoire; `items` may be capped for the card. */
export interface RepertoirePayload {
  items: RepertoireCardItem[];
  learned: number;
  in_progress: number;
  /** Plural word for what these are ('pieces', 'katas') — 'items' when the kind is unknown. */
  noun: string;
}

export interface RecapRailPayload {
  /** `line` is the coach's/receipt's one-sentence conclusion — nullable on purpose (honest v1:
   *  rows persisted before anything writes conclusions back simply have none, and "no line yet"
   *  must stay distinguishable from an empty one; the renderer skips it when absent). */
  recaps: { week_of: string; facts_line: string; line?: string | null; detour?: boolean }[];
}

export interface HistoryPayload {
  entries: HistoryEntry[];
}

export type WidgetPayload =
  | { kind: 'rhythm'; data: RhythmPayload }
  | { kind: 'trend_vs_target'; data: TrendVsTargetPayload }
  | { kind: 'dated_sessions'; data: DatedSessionsPayload }
  | { kind: 'weekly_bars'; data: WeeklyBarsPayload }
  | { kind: 'felt_week'; data: FeltWeekPayload }
  | { kind: 'shelf'; data: ShelfPayload }
  | { kind: 'stage_path'; data: StagePathPayload }
  | { kind: 'count_toward'; data: CountTowardPayload }
  | { kind: 'balance'; data: BalancePayload }
  | { kind: 'total'; data: TotalPayload }
  | { kind: 'variety'; data: VarietyPayload }
  | { kind: 'repertoire'; data: RepertoirePayload }
  | { kind: 'recap_rail'; data: RecapRailPayload }
  | { kind: 'history'; data: HistoryPayload };

/** Guards report evidence, never silent null: an unbindable section is listed
 *  here and simply not rendered. */
export interface WidgetOmission {
  id: string;
  kind: WidgetKind;
  reason: string;
}

export interface ResolvedSection {
  spec: WidgetSpec;
  payload: WidgetPayload;
}

/** The assembled page (integration target: GET /me/progress-page?window=). */
export interface ProgressPage {
  window: ProgressWindow;
  layout_status: ProgressLayout['status'];
  sections: ResolvedSection[];
  omissions: WidgetOmission[];
}
