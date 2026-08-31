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
 * **The block carries content; the client works out the shape.** It used to name its own layout —
 * rows, a grid, a card — and each of those was a second thing the coach had to get right on top of
 * the question she was actually asking. On 2026-08-16 she got the second thing wrong: she called
 * `propose_plan_change`, the proposal landed in the database with exactly the right content, and
 * nothing appeared on screen, because the card was gated on a tag she had not emitted. Rows versus
 * grid is now derived from the options themselves (`derivePickLayout`, in the web app), which
 * cannot forget, and the change card follows the stored proposal rather than any tag at all.
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
 * Canonical `area` (never goal "category" — see CLAUDE.md nomenclature). Used only to colour the
 * dot beside a row; nothing branches on it.
 */
export type CoachPickArea = 'movement' | 'nourishment' | 'mind' | 'practice';

export interface CoachPickOption {
  /** What the tile/row shows. A bare value ("3", "45+") is what earns the grid; see the deriver. */
  label: string;
  /** The user's words for this option, dropped into the composer. Defaults to `label`. */
  say?: string;
  /** The small line under a scalar ("most people keep this"). Only the grid draws it. */
  hint?: string;
  /** Which area the option belongs to, for the dot's colour. Only rows draw it. */
  area?: CoachPickArea;
}

export interface CoachPicks {
  /**
   * The one thing the coach still declares, because it is not presentation: this block is her
   * BUILD PLAN tool, not an answer widget. The client renders everything it has heard, with the
   * button that builds (or rebuilds) the rhythm from it, so it carries no options — the content is
   * the user's own data, read from the store rather than retold by the turn.
   *
   * Deliberately repeatable, and deliberately the ONLY route to a plan. It was once "use it
   * exactly once, at the end of onboarding", which left the coach with nowhere to go the moment
   * someone added a goal after it — she fell back to naming a review screen that no longer exists.
   * A plan is rebuilt in the conversation that decided to rebuild it, whenever that happens.
   */
  build?: boolean;
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
  /**
   * A `layout` on the wire is ignored now — with one exception that has to survive.
   *
   * Sessions keep the instructions they were born with, so every conversation that was open when
   * this shipped is still emitting the old vocabulary: `"list"`, `"tiles"`, `"change"`. Those three
   * are pure presentation and dropping them costs nothing — the shape comes from the options, and
   * the change card follows the stored proposal. `"confirm"` is different in kind. It was never a
   * shape; it is the coach handing over the build card, and that card is the only route to a plan.
   * Ignoring it would leave a live conversation agreeing to build a week that then never gets
   * built — precisely the silence that cost a day on 2026-08-16. So it is translated, not dropped.
   *
   * Delete the second half of this line one release on, when no session can still be carrying the
   * old block.
   */
  const build = o.build === true || o.layout === 'confirm';
  const raws = Array.isArray(o.options) ? o.options : [];
  const options = raws.map(asOption).filter((x): x is CoachPickOption => x !== null);
  // An answer widget with no answers is a dead end; the build card has none by design.
  if (!build && !options.length) return null;
  const picks: CoachPicks = {
    multi: o.multi === true,
    options: options.slice(0, MAX_OPTIONS),
  };
  if (build) picks.build = true;
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
 * Consumes EVERY block, not just the first. A turn that ran tools can carry text from more than
 * one generation, and each may end in its own block; extracting one and letting the rest fall
 * through painted a whole block as raw JSON on the phone (2026-08-31). So all blocks are
 * stripped from the prose, and the LAST valid one is the turn's pick set — later text supersedes
 * earlier text the same way it does for the words around it.
 *
 * Stream-safe by construction: an opening fence with no closing fence yet means that block is
 * still arriving, so everything from that fence on is withheld. Without that the user watches
 * raw JSON type itself out mid-sentence.
 */
export function parseCoachTurn(raw: string): ParsedCoachTurn {
  const parts: string[] = [];
  let picks: CoachPicks | null = null;
  let rest = raw;
  for (;;) {
    const open = rest.match(OPEN_FENCE);
    if (open?.index === undefined) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, open.index));
    const afterOpen = rest.slice(open.index + open[0].length);
    const close = afterOpen.indexOf('```');
    // Still streaming: hold the tail back rather than paint a fence and a JSON fragment.
    if (close === -1) break;
    try {
      const parsed = coercePicks(JSON.parse(afterOpen.slice(0, close)));
      if (parsed) picks = parsed;
    } catch {
      // Malformed JSON: the prose still asks the question, so drop the block and carry on.
    }
    rest = afterOpen.slice(close + 3);
  }
  const text = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');
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
