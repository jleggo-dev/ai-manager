/**
 * The deterministic gate between the `progress-layout-compose` job and `cadence.progress_layouts`
 * (TOOL-HARNESS.md's governing rule, applied to a job result instead of a tool call: "never trust
 * the model's shape beyond the schema" — strict json_schema only guarantees TYPES, never that a
 * `goal_id` is real or a `kind` is one this build actually renders).
 *
 * Pure and fixture-tested (no DB, no job call) — every fact it checks against (`availability`,
 * `goalIds`) is handed in by the caller, which is what makes it unit-testable and keeps this file
 * the ONE place "is this layout safe to show someone" is decided.
 *
 * All-or-nothing: a hard failure REJECTS the whole layout with the evidence (never a silent drop
 * of the one bad section — a half-applied proposal is worse than none, same reasoning
 * `propose_plan_change` uses for an edit it cannot carry out). Harmless JSON noise (whitespace,
 * an unknown extra key, a bad `window` value) is normalized rather than rejected — it is not
 * evidence of a wrong DECISION, just of shape the schema did not fully pin down.
 */
import { WIDGET_KINDS, type ProgressLayout, type WidgetKind, type WidgetSpec } from '@cadence/shared';
import type { ProgressAvailability } from './progress-layout-availability.ts';

const KNOWN_KINDS = new Set<string>(WIDGET_KINDS);
const MAX_SECTIONS = 24;
const MAX_TITLE = 80;
const MAX_ID = 100;
const MAX_CAPTION = 200;
const VALID_WINDOWS = new Set(['week', 'month', 'all', 'inherit']);

/** "Copy names the goal, never the area" (progress-widgets.ts) — a bare area word is exactly the
 *  mistake that rule exists to catch. */
const AREA_WORDS = new Set(['movement', 'nourishment', 'mind', 'practice']);

export interface ComposeValidationContext {
  availability: ProgressAvailability;
  /** The exact goal ids the job was shown — a `goal_id` the model names must be one of these. */
  goalIds: readonly string[];
}

export type ComposeValidation = { ok: true; layout: ProgressLayout } | { ok: false; reasons: string[] };

/** Loosely-typed mirror of what the job's `expectedSchema` guarantees the SHAPE of — never trusted
 *  for CONTENT, which is exactly what every check below exists to do instead. */
interface RawSection {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  source?: {
    measure?: unknown;
    goal_id?: unknown;
    activity?: unknown;
    feedback_kind?: unknown;
    window?: unknown;
  } | null;
  caption?: { template?: unknown } | null;
}

function cleanSource(kind: WidgetKind, raw: RawSection['source']): WidgetSpec['source'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<WidgetSpec['source']> = {};
  if (kind === 'trend_vs_target' && typeof raw.measure === 'string') out.measure = raw.measure.trim();
  if (kind === 'weekly_bars' && typeof raw.measure === 'string') out.measure = raw.measure.trim();
  if (typeof raw.goal_id === 'string' && raw.goal_id.trim()) out.goal_id = raw.goal_id.trim();
  if (typeof raw.activity === 'string' && raw.activity.trim()) out.activity = raw.activity.trim();
  if (typeof raw.feedback_kind === 'string' && raw.feedback_kind.trim()) out.feedback_kind = raw.feedback_kind.trim();
  if (typeof raw.window === 'string' && VALID_WINDOWS.has(raw.window)) {
    out.window = raw.window as NonNullable<WidgetSpec['source']>['window'];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Per-kind: is the section's source pointed at something `availability`/`goalIds` says is real? */
function sourceReasons(
  index: number,
  kind: WidgetKind,
  source: WidgetSpec['source'],
  ctx: ComposeValidationContext,
): string[] {
  const at = `section[${index}] (${kind})`;
  const { availability, goalIds } = ctx;

  if (kind === 'trend_vs_target') {
    if (source?.measure !== 'weight')
      return [`${at}: only binds to the "weight" measure today, got ${JSON.stringify(source?.measure ?? null)}`];
    if (!availability.has_weight) return [`${at}: no weight data on file yet — cannot bind`];
    return [];
  }
  if (kind === 'weekly_bars') {
    if (source?.measure !== 'steps' && source?.measure !== 'kcal') {
      return [`${at}: source.measure must be "steps" or "kcal", got ${JSON.stringify(source?.measure ?? null)}`];
    }
    return [];
  }
  if (kind === 'dated_sessions') {
    const activity = source?.activity;
    if (!activity) return [`${at}: needs source.activity naming a logged activity`];
    if (!availability.activities.includes(activity)) {
      const known = availability.activities.slice(0, 8).join(', ') || 'none logged yet';
      return [`${at}: "${activity}" has no logged sessions — available activities: ${known}`];
    }
    return [];
  }
  if (kind === 'stage_path' || kind === 'count_toward' || kind === 'total') {
    const goalId = source?.goal_id;
    if (!goalId) return [`${at}: needs source.goal_id naming one of the user's goals`];
    if (!goalIds.includes(goalId)) return [`${at}: goal_id "${goalId}" is not one of the goals it was shown`];
    return [];
  }
  if (kind === 'balance') {
    const fk = source?.feedback_kind;
    if (fk === 'mind' || fk === 'movement') {
      if (!availability.has_feedback[fk]) return [`${at}: no answered ${fk} feedback on file yet — cannot bind`];
      return [];
    }
    return [`${at}: source.feedback_kind must be "mind" or "movement", got ${JSON.stringify(fk ?? null)}`];
  }
  if (kind === 'variety') {
    if (!availability.has_food_usage) return [`${at}: no food log usage on file yet — cannot bind`];
    return [];
  }
  if (kind === 'felt_week') {
    if (!availability.has_felt) return [`${at}: no daily check-in moods in the last four weeks — cannot bind`];
    return [];
  }
  if (kind === 'repertoire') {
    if (!availability.has_repertoire) return [`${at}: no repertoire on file yet — cannot bind`];
    const goalId = source?.goal_id;
    if (goalId && !goalIds.includes(goalId)) {
      return [`${at}: goal_id "${goalId}" is not one of the goals it was shown`];
    }
    if (goalId && !availability.repertoire_goal_ids.includes(goalId)) {
      return [`${at}: no repertoire items for goal "${goalId}" — leave source.goal_id off to show everything`];
    }
    return [];
  }
  // rhythm, shelf, recap_rail, history: no source-existence gate — see the parcel report for why.
  return [];
}

function titleReasons(index: number, kind: WidgetKind, title: unknown): string[] {
  const at = `section[${index}] (${kind})`;
  if (typeof title !== 'string' || !title.trim()) return [`${at}: needs a title — copy names the goal, never the area`];
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE) return [`${at}: title is too long (${trimmed.length} > ${MAX_TITLE} chars)`];
  if (AREA_WORDS.has(trimmed.toLowerCase())) {
    return [`${at}: title "${trimmed}" names an area, not the thing being watched — needs a warm, specific title`];
  }
  return [];
}

/**
 * Validate a job result deterministically and, only on success, return the CLEAN layout to write
 * — `version`/`status` are never taken from the model (constants, forced here) and every section
 * is rebuilt from only its known-good fields (never a passthrough of whatever extra keys the
 * model added).
 */
export function validateComposedLayout(raw: unknown, ctx: ComposeValidationContext): ComposeValidation {
  const reasons: string[] = [];
  const sectionsRaw = (raw as { sections?: unknown } | null)?.sections;
  if (!raw || typeof raw !== 'object' || !Array.isArray(sectionsRaw)) {
    return { ok: false, reasons: ['the job did not return a "sections" array'] };
  }
  if (sectionsRaw.length === 0) return { ok: false, reasons: ['"sections" was empty — nothing to propose'] };
  if (sectionsRaw.length > MAX_SECTIONS) {
    return { ok: false, reasons: [`"sections" has ${sectionsRaw.length} entries, more than the ${MAX_SECTIONS} cap`] };
  }

  const seenIds = new Set<string>();
  const historyIndices: number[] = [];
  const clean: WidgetSpec[] = [];

  sectionsRaw.forEach((entry, index) => {
    const s = entry as RawSection;
    const at = `section[${index}]`;
    if (!s || typeof s !== 'object') {
      reasons.push(`${at}: not an object`);
      return;
    }
    const kind = typeof s.kind === 'string' ? s.kind : '';
    if (!KNOWN_KINDS.has(kind)) {
      reasons.push(`${at}: kind ${JSON.stringify(s.kind ?? null)} is not one of the catalog's kinds`);
      return;
    }
    const widgetKind = kind as WidgetKind;

    const id = typeof s.id === 'string' ? s.id.trim() : '';
    if (!id) reasons.push(`${at} (${widgetKind}): needs a non-empty id`);
    else if (id.length > MAX_ID) reasons.push(`${at} (${widgetKind}): id is too long (${id.length} > ${MAX_ID} chars)`);
    else if (seenIds.has(id)) reasons.push(`${at} (${widgetKind}): id "${id}" is used by more than one section`);
    else seenIds.add(id);

    reasons.push(...titleReasons(index, widgetKind, s.title));

    const source = cleanSource(widgetKind, s.source);
    reasons.push(...sourceReasons(index, widgetKind, source, ctx));

    let caption: WidgetSpec['caption'];
    if (s.caption != null) {
      const template = typeof s.caption === 'object' ? s.caption.template : undefined;
      if (typeof template !== 'string' || !template.trim()) {
        reasons.push(`${at} (${widgetKind}): caption is present but has no usable "template"`);
      } else if (template.length > MAX_CAPTION) {
        reasons.push(`${at} (${widgetKind}): caption template is too long (${template.length} > ${MAX_CAPTION} chars)`);
      } else {
        caption = { template: template.trim() };
      }
    }

    if (widgetKind === 'history') historyIndices.push(index);

    // Built unconditionally: when `reasons` ends up non-empty the whole layout is rejected below
    // and `clean` is discarded, so this only ever ships once every check above has passed.
    clean.push({
      id,
      kind: widgetKind,
      title: typeof s.title === 'string' ? s.title.trim() : '',
      ...(source ? { source } : {}),
      ...(caption ? { caption } : {}),
    });
  });

  if (historyIndices.length > 1) {
    reasons.push(`"history" appears ${historyIndices.length} times — at most one is allowed`);
  } else if (historyIndices.length === 1 && historyIndices[0] !== sectionsRaw.length - 1) {
    reasons.push(
      `"history" must be the last section (found at position ${historyIndices[0]! + 1} of ${sectionsRaw.length})`,
    );
  }

  if (reasons.length) return { ok: false, reasons };

  return { ok: true, layout: { version: 1, status: 'draft', sections: clean } };
}
