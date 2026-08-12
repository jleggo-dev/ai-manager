/**
 * Quick picks — the coach's own affordances, emitted with the turn that needs them.
 *
 * **Why this is a protocol and not five hard-coded screens.** Onboarding used to be a wizard: the
 * client knew the questions, their order, and their answer widgets. That client can only ever ask
 * what it was built to ask, so it re-asks what you already said and can't follow up. Here the
 * coach emits each question's pick set alongside the prose, in a fenced block the client strips
 * before rendering. The question order lives in the persona as a *suggested script*, not in a
 * state machine — so Cadence can skip, reorder, or follow up, and the same protocol carries into
 * weekly check-ins and plan adjustments without a second UI vocabulary.
 *
 * **Two layouts, deliberately only two.** `list` for labelled options (goals, times of day),
 * `tiles` for short scalars (counts, days, ratings). A third layout is a third thing to learn.
 *
 * **A pick composes a message; it never sends one.** Tapping writes plain words into the composer
 * and the user still presses send — so a tap and a typed sentence are the same act, and someone
 * who taps "3 days" then edits it to "3, but not Tuesdays" is on the supported path, not fighting
 * the UI. That is also why `say` is prose rather than a code: what the coach receives is what the
 * user can see they said.
 *
 * Everything here degrades. No block, a malformed block, a half-streamed block — the turn is
 * still ordinary text in an ordinary chat, which is the floor this must never fall below.
 */

/**
 * `list` = labelled option rows. `tiles` = a grid of short scalars. Those two are the entire
 * answer vocabulary, on purpose.
 *
 * `confirm` is not a third answer widget — it is the coach's BUILD PLAN tool. She emits it and the
 * client renders everything it has heard, with the button that builds (or rebuilds) the rhythm from
 * it. It carries no options because the content is the user's own captured data, not a menu.
 *
 * Deliberately repeatable, and deliberately the ONLY route to a plan. It was once "use it exactly
 * once, at the end of onboarding", which left the coach with nowhere to go the moment someone added
 * a goal after it — she fell back to naming a review screen that no longer exists. A plan is
 * rebuilt in the conversation that decided to rebuild it, whenever that conversation happens.
 */
export type CoachPickLayout = 'list' | 'tiles' | 'confirm';

/**
 * Canonical `area` (never goal "category" — see CLAUDE.md nomenclature). Used only to colour the
 * dot beside a row; nothing branches on it.
 */
export type CoachPickArea = 'movement' | 'nourishment' | 'mind' | 'practice';

export interface CoachPickOption {
  /** What the tile/row shows. For `tiles` keep it to a couple of characters ("3", "5+"). */
  label: string;
  /** The user's words for this option, dropped into the composer. Defaults to `label`. */
  say?: string;
  /** `tiles` only: the small line under the number ("most people keep this"). */
  hint?: string;
  /** `list` only: which area the row belongs to, for the dot's colour. */
  area?: CoachPickArea;
}

export interface CoachPicks {
  layout: CoachPickLayout;
  /** Whether more than one option can be selected. */
  multi: boolean;
  /**
   * Sentence opener for a composed multi-pick message ("I'd like to"). With a lead the `say`
   * fragments are joined and a full stop added; without one, a single `say` is used verbatim.
   */
  lead?: string;
  /** 0–1, the coach's own read on how far through intake this is. Drives the progress bar. */
  progress?: number;
  options: CoachPickOption[];
}

/** The fence the coach wraps its pick set in. Chosen to be inert if it ever leaks into view. */
export const COACH_PICKS_FENCE = 'cadence-picks';

/** More than this on one turn is a form, not a question. */
const MAX_OPTIONS = 8;

const OPEN_FENCE = new RegExp('```[ \\t]*' + COACH_PICKS_FENCE + '\\b', 'i');

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asArea(v: unknown): CoachPickArea | undefined {
  return v === 'movement' || v === 'nourishment' || v === 'mind' || v === 'practice' ? v : undefined;
}

function asOption(raw: unknown): CoachPickOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const label = asString(o.label);
  if (!label) return null;
  const option: CoachPickOption = { label };
  const say = asString(o.say);
  if (say) option.say = say;
  const hint = asString(o.hint);
  if (hint) option.hint = hint;
  const area = asArea(o.area);
  if (area) option.area = area;
  return option;
}

/**
 * Validate a decoded pick block. Returns null for anything we would not want to render — a
 * half-right pick set is worse than none, because the user can't tell which half to trust.
 */
export function coercePicks(raw: unknown): CoachPicks | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const layout: CoachPickLayout | null =
    o.layout === 'tiles' || o.layout === 'list' || o.layout === 'confirm' ? o.layout : null;
  if (!layout) return null;
  const raws = Array.isArray(o.options) ? o.options : [];
  const options = raws.map(asOption).filter((x): x is CoachPickOption => x !== null);
  // An answer widget with no answers is a dead end; the confirmation has no options by design.
  if (layout !== 'confirm' && !options.length) return null;
  const picks: CoachPicks = {
    layout,
    multi: o.multi === true,
    options: options.slice(0, MAX_OPTIONS),
  };
  const lead = asString(o.lead);
  if (lead) picks.lead = lead;
  if (typeof o.progress === 'number' && Number.isFinite(o.progress)) {
    picks.progress = Math.min(1, Math.max(0, o.progress));
  }
  return picks;
}

export interface ParsedCoachTurn {
  /** The turn with the pick block removed — what actually gets rendered. */
  text: string;
  /** The pick set, or null when the turn carries none (or is still streaming one). */
  picks: CoachPicks | null;
}

/**
 * Split a coach turn into its prose and its pick set.
 *
 * Stream-safe by construction: an opening fence with no closing fence yet means the block is
 * still arriving, so everything from the fence on is withheld and `picks` stays null. Without
 * that the user watches raw JSON type itself out mid-sentence.
 */
export function parseCoachTurn(raw: string): ParsedCoachTurn {
  const open = raw.match(OPEN_FENCE);
  if (open?.index === undefined) return { text: raw, picks: null };
  const before = raw.slice(0, open.index);
  const rest = raw.slice(open.index + open[0].length);
  const close = rest.indexOf('```');
  // Still streaming: hold the tail back rather than paint a fence and a JSON fragment.
  if (close === -1) return { text: before.trimEnd(), picks: null };
  const body = rest.slice(0, close);
  const after = rest.slice(close + 3);
  const text = `${before.trimEnd()}${after.trimEnd() ? `\n${after.trim()}` : ''}`.trim();
  let picks: CoachPicks | null = null;
  try {
    picks = coercePicks(JSON.parse(body));
  } catch {
    // Malformed JSON: the prose still asks the question, so drop the block and carry on.
  }
  return { text, picks };
}

/** "a, b and c" — the way someone would actually say a list out loud. */
function joinSpoken(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Turn a selection into the sentence that lands in the composer. Empty selection → empty string,
 * which is what leaves the send arrow inert.
 */
export function composePickMessage(picks: CoachPicks, selected: readonly number[]): string {
  const says = [...selected]
    .sort((a, b) => a - b)
    .map((i) => picks.options[i])
    .filter((o): o is CoachPickOption => !!o)
    .map((o) => o.say ?? o.label);
  if (!says.length) return '';
  const joined = joinSpoken(says);
  return picks.lead ? `${picks.lead} ${joined}.` : joined;
}
