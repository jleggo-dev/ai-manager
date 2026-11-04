/**
 * What the person changed about the session's structure, as facts (walkthrough v3 Phase 6b/6c).
 * Read by the Recap ("You changed 3 things", one row per entry, each with Every time / Just
 * today) and by the how_to write (R5: a learned structure is one plain sentence appended to
 * `activity.how_to`, the free text every future session already reads). The copy is fixed here
 * and no model writes it:
 *
 *   alternate  "Bench press + dumbbell row, alternating"   → "alternate bench press and dumbbell row"
 *   sequence   "Farmer carry + hip thrust, in sequence"   → "farmer carry, then hip thrust"
 *   spread     "Dead hang, one set at a time"              → "dead hang one set at a time"
 *   reorder    "Pull-ups after dead hang"                  → "pull-ups after dead hang"
 *   swap       "Glute bridge → hip thrust"                 → "hip thrust instead of glute bridge"
 *
 * Swaps come from Phase 5's changes (the steps handed in carry `swapped_from`), so one list
 * holds every change the person made.
 */
import type { WalkthroughStep } from './walkthrough.ts';
import { type PlayedShape, distinctSteps, isCombined, spreadSteps } from './played-shape.ts';
import { groupTitle, shortNames } from './played-lines.ts';

export type StructureChangeKind = 'alternate' | 'sequence' | 'spread' | 'reorder' | 'swap';

export interface StructureChange {
  kind: StructureChangeKind;
  /** Stable across re-renders: the kind and the steps it names. */
  key: string;
  /** The fact as the Recap shows it. */
  words: string;
  /** The sentence Every time appends to `activity.how_to`. */
  sentence: string;
  /** A preview of the order, one short name per turn, for a combined group. */
  pills?: string[];
  rounds?: number;
}

const lower = (s: string) => s.trim().toLowerCase();

/** Every change, in the order it sits in the session: combined groups and spread steps by
 *  position, then moved steps, then swaps. */
export function structureDiff(steps: readonly WalkthroughStep[], shape: PlayedShape): StructureChange[] {
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const out: StructureChange[] = [];
  const spread = spreadSteps(shape);
  const noted = new Set<string>();

  for (const g of shape) {
    if (isCombined(g)) {
      const ids = distinctSteps(g);
      const names = ids.map(title);
      const short = shortNames(names);
      const pills = g.turns
        .slice(0, Math.min(g.turns.length, ids.length * 2))
        .map((t) => short[ids.indexOf(t.stepId)] ?? '');
      const rounds = g.turns.reduce((m, t) => Math.max(m, t.set + 1), 0);
      const mode = g.mode ?? 'alternate';
      const key = `${mode}:${ids.join('+')}`;
      out.push(
        mode === 'alternate'
          ? {
              kind: 'alternate',
              key,
              words: `${groupTitle(names)}, alternating`,
              sentence: `alternate ${names.map(lower).join(' and ')}`,
              pills,
              rounds,
            }
          : {
              kind: 'sequence',
              key,
              words: `${groupTitle(names)}, in sequence`,
              sentence: names.map(lower).join(', then '),
              pills,
              rounds,
            },
      );
      continue;
    }
    for (const id of distinctSteps(g)) {
      const groups = spread.get(id);
      if (!groups || noted.has(id)) continue;
      noted.add(id);
      const singles = groups.filter((x) => !isCombined(x));
      const oneAtATime = singles.every((x) => x.turns.length === 1);
      const name = title(id);
      out.push(
        oneAtATime
          ? {
              kind: 'spread',
              key: `spread:${id}`,
              words: `${name}, one set at a time`,
              sentence: `${lower(name)} one set at a time`,
            }
          : {
              kind: 'spread',
              key: `spread:${id}`,
              words: `${name}, in ${singles.length} places`,
              sentence: `${lower(name)} in ${singles.length} places`,
            },
      );
    }
  }

  out.push(...reorders(steps, shape, spread));

  for (const s of steps) {
    if (s.swapped_from) {
      out.push({
        kind: 'swap',
        key: `swap:${s.id}`,
        words: `${s.swapped_from} → ${lower(s.title)}`,
        sentence: `${lower(s.title)} instead of ${lower(s.swapped_from)}`,
      });
    }
    if (s.tool.kind === 'circuit') {
      s.tool.exercises.forEach((ex, i) => {
        if (ex.swapped_from) {
          out.push({
            kind: 'swap',
            key: `swap:${s.id}:${i}`,
            words: `${ex.swapped_from} → ${lower(ex.name)}`,
            sentence: `${lower(ex.name)} instead of ${lower(ex.swapped_from)}`,
          });
        }
      });
    }
  }
  return out;
}

/**
 * Steps dragged to a new place, among the steps that were not combined or spread (those are
 * already said). The moved ones are the steps outside the longest run that kept the prescribed
 * order; each is named with what it now follows.
 */
function reorders(
  steps: readonly WalkthroughStep[],
  shape: PlayedShape,
  spread: Map<string, unknown>,
): StructureChange[] {
  const skip = new Set<string>(spread.keys());
  for (const g of shape) if (isCombined(g)) for (const id of distinctSteps(g)) skip.add(id);
  const played: string[] = [];
  for (const g of shape) for (const id of distinctSteps(g)) if (!skip.has(id) && !played.includes(id)) played.push(id);
  const prescribed = steps.map((s) => s.id).filter((id) => played.includes(id));
  const kept = new Set(longestCommonSubsequence(prescribed, played));
  const title = (id: string) => steps.find((s) => s.id === id)?.title ?? id;
  return played
    .filter((id) => !kept.has(id))
    .map((id) => {
      const before = played[played.indexOf(id) - 1];
      const words = before ? `${title(id)} after ${title(before).toLowerCase()}` : `${title(id)} first`;
      return { kind: 'reorder', key: `reorder:${id}`, words, sentence: words.toLowerCase() };
    });
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = the longest common run of a[i..] and b[j..], in a flat table.
  const dp = new Array<number>((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number) => dp[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const x = a[i];
    if (x !== undefined && x === b[j]) {
      out.push(x);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  return out;
}

/* ── The how_to write (R5) ── */

/** Sentences in a how_to are joined with this; the coach's own free text before them is kept whole. */
const JOIN = '; ';

const normalizeSentence = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.;]+$/, '');

export type AppendHowTo =
  | { status: 'written'; how_to: string }
  /** The sentence was already there — the same sentence twice is one. */
  | { status: 'present'; how_to: string }
  /** Adding it would run past `max`; nothing is written, and nothing already there is dropped. */
  | { status: 'full'; how_to: string };

/**
 * `existing` with one plain sentence appended, bounded and de-duplicated. The existing text is
 * never rewritten: the person's and the coach's earlier instructions stand, and a sentence the
 * text already holds (case and spacing aside) is not added twice.
 */
export function appendHowTo(existing: string | null | undefined, sentence: string, max: number): AppendHowTo {
  const add = normalizeSentence(sentence);
  const current = (existing ?? '').trim();
  const parts = current.split(/;\s*/).map(normalizeSentence).filter(Boolean);
  if (!add || parts.some((p) => p.toLowerCase() === add.toLowerCase())) return { status: 'present', how_to: current };
  const next = current ? `${current.replace(/[.;\s]+$/, '')}${JOIN}${add}` : add;
  if (next.length > max) return { status: 'full', how_to: current };
  return { status: 'written', how_to: next };
}
