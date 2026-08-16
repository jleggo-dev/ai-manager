import type { CoachPicks } from '@cadence/shared';

/**
 * Which shape a pick set draws in — worked out from the options, never announced by the coach.
 *
 * **Why the client decides this.** She used to name the layout herself, in the same block as the
 * question, so every shape was a second thing to remember alongside the answer she was actually
 * giving. On 2026-08-16 she forgot the one that mattered: `propose_plan_change` stored a correct
 * proposal, she said "let me swap it now", and nothing appeared, because the tag that would have
 * drawn the card was missing. Four turns of the owner asking for a plan change she had already
 * made. Owner, on the wider point: *"some of these are really just UI. We could have Cadence
 * return a list and then deterministically figure out how to render them based on the number of
 * options or amount of text. Cadence doesn't need to know the specifics."*
 *
 * So the specifics live here, in one pure function that cannot forget them.
 *
 * `list` = labelled rows. `tiles` = a two-column grid of short values. Still only two shapes, for
 * the same reason there were only ever two: a third is a third thing to reason about.
 */
export type PickLayout = 'list' | 'tiles';

/**
 * Everything the shape may be decided from. Deliberately narrower than `CoachPicks` — `multi`,
 * `progress` and `build` say nothing about how a set reads, and putting them out of reach is
 * sturdier than a comment asking nobody to use them.
 */
export type PickContent = Pick<CoachPicks, 'options' | 'lead'>;

/**
 * The grid is for values you take in at a glance; rows are for choices you read.
 *
 * Six characters is where those two separate in our own copy. Every scalar the protocol asks for
 * fits inside it — "10", "45+", "Sep", "10 km" — and the canonical labelled question does not:
 * morning / midday / evening / flexible runs to eight. So the line is drawn on meaning, and it
 * sits well inside the mechanical ceiling: a tile label renders at 25px in a half-width cell,
 * which on a 375px screen holds roughly ten characters before it wraps into two lines of very
 * large type. Every label must clear it — one long one among short ones makes a ragged grid, and
 * the set is a set.
 */
const TILE_LABEL_MAX = 6;

/**
 * One tile is a half-width box beside nothing, because `.qp-tiles` is a two-column grid. A lone
 * option reads as an answer when it is a row and as a broken layout when it is a cell.
 */
const TILE_MIN_OPTIONS = 2;

/**
 * The protocol's own ceiling is six offered options, and a 2×3 grid of short values is still one
 * glance. Past that the block has already ignored that ceiling, and eight half-width boxes is a
 * keypad — rows degrade predictably where a four-deep grid does not.
 */
const TILE_MAX_OPTIONS = 6;

/**
 * Rows or grid, from the content alone.
 *
 * `lead` and `say` are in the input and deliberately never read. Neither reaches the screen —
 * `say` goes into the composer on a tap, `lead` only joins fragments into a sentence — and a shape
 * that moved with text nobody can see would be impossible to explain the first time it surprised
 * someone. `hint` is not a signal either: it is advisory content, and letting it ask for the grid
 * would put a wrapped 25px title on any long-labelled option that happened to carry one.
 */
export function derivePickLayout(content: PickContent): PickLayout {
  const { options } = content;
  if (options.length < TILE_MIN_OPTIONS || options.length > TILE_MAX_OPTIONS) return 'list';
  // An `area` is the coach saying these are labelled topics: it colours a row's dot, and a tile has
  // no dot to colour. A goal is never a scalar, however short someone's shorthand for one is.
  if (options.some((o) => o.area)) return 'list';
  // Code points, not UTF-16 units, so a single-glyph emoji counts as the one character it draws.
  if (options.some((o) => [...o.label.trim()].length > TILE_LABEL_MAX)) return 'list';
  return 'tiles';
}
