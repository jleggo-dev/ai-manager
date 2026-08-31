/**
 * The widget grammar CATALOG handed to the `progress-layout-compose` job (Wave 3 — the progress
 * talk, docs/cadence/PROGRESS-ENGINE.md "The widget grammar").
 *
 * Every entry is derived FROM `WIDGET_KINDS` (the frozen contract in
 * packages/cadence-shared/src/types/progress-widgets.ts), never a hand-maintained duplicate list:
 * the `Record<WidgetKind, ...>` maps below are keyed by the shared union type, so TypeScript
 * itself refuses to compile if a kind is ever added to the grammar and forgotten here — the same
 * "declared and executable are the same set" property the tool harness holds itself to.
 *
 * Grouping (temporal / non-temporal / page-level) and the "shows" wording follow
 * docs/cadence/PROGRESS-ENGINE.md's "The widget grammar" table.
 */
import { WIDGET_KINDS, type WidgetKind } from '@cadence/shared';

export type WidgetGroup = 'temporal' | 'non_temporal' | 'page_level';

export interface WidgetCatalogEntry {
  kind: WidgetKind;
  group: WidgetGroup;
  /** One line on what it shows — the model's only description of the kind, so it must stand alone. */
  shows: string;
  /** What `source` field it binds through, in plain words, and which values availability may allow. */
  source_hint: string;
}

const GROUP: Record<WidgetKind, WidgetGroup> = {
  rhythm: 'temporal',
  trend_vs_target: 'temporal',
  dated_sessions: 'temporal',
  weekly_bars: 'temporal',
  felt_week: 'temporal',
  shelf: 'non_temporal',
  stage_path: 'non_temporal',
  count_toward: 'non_temporal',
  balance: 'non_temporal',
  total: 'non_temporal',
  variety: 'non_temporal',
  repertoire: 'non_temporal',
  recap_rail: 'page_level',
  history: 'page_level',
};

const SHOWS: Record<WidgetKind, string> = {
  rhythm: 'a week-by-week calendar of kept and missed days for recurring commitments',
  trend_vs_target: 'a line moving toward a numeric target over time',
  dated_sessions: 'a dated list of individual sessions for one named activity',
  weekly_bars: 'a bar per week for a daily measure, like steps or calories',
  felt_week: 'a bar for each of the last four weeks, colored by how the daily check-ins felt that week',
  shelf: 'a collection of bests and firsts, with no time axis',
  stage_path: 'the named stages of a goal, marked done, current, or ahead',
  count_toward: 'how many of a fixed target so far, as a number and a bar',
  balance: 'the share of sessions that felt right, out of the total answered',
  total: 'a running total over a window ("340 minutes sat", "31,200 words")',
  variety: 'how many distinct things happened in a window ("14 different dinners")',
  repertoire: 'the pieces or material they keep, each marked learned, in progress, or not started',
  recap_rail: 'the weekly check-in cards',
  history: 'a plain dated feed of everything logged',
};

const SOURCE_HINT: Record<WidgetKind, string> = {
  rhythm: 'no source needed',
  trend_vs_target: 'source.measure — the only bindable value today is "weight"',
  dated_sessions: 'source.activity — an activity title that has logged sessions',
  weekly_bars: 'source.measure — "steps" or "kcal"',
  felt_week: 'no source needed — reads the daily check-in moods; always the last four weeks, whatever the window says',
  shelf: 'no source needed',
  stage_path: 'source.goal_id — one of the goals listed',
  count_toward: 'source.goal_id — one of the goals listed',
  balance: 'source.feedback_kind — "mind" or "movement"',
  total: 'source.goal_id — one of the goals listed',
  variety: 'no source needed',
  repertoire: 'source.goal_id — optional: set it to scope to one goal, omit it to show every item they keep',
  recap_rail: 'no source needed',
  history: 'no source needed',
};

/** The full catalog, in `WIDGET_KINDS` order — what the job's `<catalog>` variable serializes. */
export function widgetCatalog(): WidgetCatalogEntry[] {
  return WIDGET_KINDS.map((kind) => ({ kind, group: GROUP[kind], shows: SHOWS[kind], source_hint: SOURCE_HINT[kind] }));
}

/** Kinds that read as a slope over time — the composer leads with these only when the user's own
 *  framing is temporal (docs/cadence/PROGRESS-ENGINE.md "not everyone defines success linearly"). */
export const TEMPORAL_KINDS = new Set<WidgetKind>(WIDGET_KINDS.filter((k) => GROUP[k] === 'temporal'));

/** Collections, proportions, and presence — never a slope. */
export const NON_TEMPORAL_KINDS = new Set<WidgetKind>(WIDGET_KINDS.filter((k) => GROUP[k] === 'non_temporal'));

/** Page furniture, not user-composed content: `recap_rail`, `history`. */
export const PAGE_LEVEL_KINDS = new Set<WidgetKind>(WIDGET_KINDS.filter((k) => GROUP[k] === 'page_level'));
