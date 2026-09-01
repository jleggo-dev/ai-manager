import {
  deriveWalkthrough,
  DEFAULT_WORK_SEC,
  DEFAULT_RECOVER_SEC,
  DEFAULT_ROUNDS,
  DEFAULT_SIT_MINUTES,
  DEFAULT_CYCLES,
  DEFAULT_PATTERN_ID,
  type OccurrenceSession,
  type SessionBlock,
  type SessionItem,
  type StepToolKind,
} from '@cadence/shared';

/**
 * Pure session-edit helpers for the Activity Builder (parcel W3-2). No React, no fetch — every
 * function here takes a `BuilderCard[]` (the builder's own working copy of `session.blocks`, one
 * card per block) and returns a new one, so `ActivityBuilder.tsx` is a thin `useState` wrapper and
 * these are unit-testable directly (owner mandate — the test bar names add/duplicate/delete/
 * reorder/retitle/total explicitly).
 *
 * **One card = one `SessionBlock`.** A straight (non-circuit) card carries exactly one item in
 * `block.items[0]` — so `deriveWalkthrough` turns it into exactly one `WalkthroughStep`, a 1:1
 * mapping with what the card shows. A circuit card is a `mode:'circuit'` block whose items are its
 * exercises; `deriveWalkthrough` already collapses a whole circuit block into ONE step, so that
 * mapping holds there too. This is what lets the footer total call `deriveWalkthrough` — the exact
 * function the walkthrough player itself runs — instead of re-deriving its own (possibly wrong)
 * arithmetic (law: never invent a number the player wouldn't also show).
 */

/** One card in the builder's working list. `id` exists ONLY for React keys / reorder identity —
 *  it never reaches the saved session (`sessionFromCards` strips it back down to plain blocks). */
export interface BuilderCard {
  id: string;
  block: SessionBlock;
}

/** The palette's step kinds (design C) — the tool catalog actually played by the walkthrough
 *  today. `photo` is deliberately absent: `StepTool.kind === 'photo'` has no renderer in
 *  `Walkthrough.tsx` (it falls through to a bare checkoff with no capture UI at all), so it is a
 *  dead tool, not a shippable one — see the ActivityBuilder report for the audit. */
export type PaletteStepKind =
  | 'timer'
  | 'interval'
  | 'reps'
  | 'circuit'
  | 'breathing'
  | 'meditate'
  | 'grounding'
  | 'checkoff'
  | 'read'
  | 'journal'
  | 'feeling_log'
  | 'measure';

let seq = 0;
/** A short, locally-unique card id. Not cryptographic — it only has to out-live one draft. */
export function newCardId(): string {
  seq += 1;
  return `card_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneBlock(block: SessionBlock): SessionBlock {
  return JSON.parse(JSON.stringify(block)) as SessionBlock;
}

/** Load an existing session into the builder's working list (edit mode, or a seed pressed). */
export function cardsFromSession(session: OccurrenceSession | null | undefined): BuilderCard[] {
  return (session?.blocks ?? []).map((block) => ({ id: newCardId(), block: cloneBlock(block) }));
}

/** Compose the plain, ID-free session the save call sends — the exact shape `createUserRoutine`
 *  expects, and the exact shape the walkthrough player reads back later. */
export function sessionFromCards(cards: BuilderCard[], note = ''): OccurrenceSession {
  return {
    blocks: cards.map((c) => cloneBlock(c.block)),
    note,
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

/** A fresh, empty session — "Start blank instead". */
export function blankSession(): OccurrenceSession {
  return { blocks: [], note: '', generated_at: new Date().toISOString(), version: 1 };
}

/* ── add / duplicate / delete / reorder / retitle ───────────────────────────────────────────── */

export function addCard(cards: BuilderCard[], block: SessionBlock): BuilderCard[] {
  return [...cards, { id: newCardId(), block }];
}

/** Insert the palette's default step for one kind, at the end — "＋ Add step". */
export function addStepOfKind(cards: BuilderCard[], kind: PaletteStepKind): BuilderCard[] {
  return addCard(cards, defaultBlockFor(kind));
}

/** Duplicate the card at `index`, landing immediately after it — a deep copy, never a shared ref. */
export function duplicateCard(cards: BuilderCard[], index: number): BuilderCard[] {
  const source = cards[index];
  if (!source) return cards;
  const copy: BuilderCard = { id: newCardId(), block: cloneBlock(source.block) };
  const next = [...cards];
  next.splice(index + 1, 0, copy);
  return next;
}

export function deleteCard(cards: BuilderCard[], index: number): BuilderCard[] {
  if (index < 0 || index >= cards.length) return cards;
  return cards.filter((_, i) => i !== index);
}

/** Swap two adjacent cards. Up/down buttons, never a pointer-drag — REQ (owner mandate: a
 *  pointer-drag reorder is unreliable under test and on device). A no-op at either edge. */
function swap(cards: BuilderCard[], a: number, b: number): BuilderCard[] {
  if (a < 0 || b < 0 || a >= cards.length || b >= cards.length) return cards;
  const next = [...cards];
  const ca = next[a];
  const cb = next[b];
  if (!ca || !cb) return cards;
  next[a] = cb;
  next[b] = ca;
  return next;
}

export function moveCardUp(cards: BuilderCard[], index: number): BuilderCard[] {
  return swap(cards, index, index - 1);
}

export function moveCardDown(cards: BuilderCard[], index: number): BuilderCard[] {
  return swap(cards, index, index + 1);
}

/** Rename a card — the item's name for a straight card (what the player titles the step), the
 *  block's own label for a circuit (what `deriveWalkthrough` titles a rotated set). Kept in sync
 *  on both so a card never shows one name while carrying another underneath. */
export function retitleCard(cards: BuilderCard[], index: number, name: string): BuilderCard[] {
  const card = cards[index];
  if (!card) return cards;
  const block = cloneBlock(card.block);
  block.label = name;
  const first = block.items[0];
  if (block.mode !== 'circuit' && first) first.name = name;
  return replaceAt(cards, index, block);
}

function replaceAt(cards: BuilderCard[], index: number, block: SessionBlock): BuilderCard[] {
  const card = cards[index];
  if (!card) return cards;
  const next = [...cards];
  next[index] = { id: card.id, block };
  return next;
}

/* ── tool-specific field edits ───────────────────────────────────────────────────────────────── */

/** Merge a patch into a straight card's one item — minutes, sets/reps/load, the interval numbers,
 *  a breathing pattern, a write prompt, measure metric/unit: whatever field the card's own tool
 *  exposes. A no-op on a circuit card (it has no single item to patch — see `updateCircuitRounds`
 *  / `updateCircuitExercise`). */
export function updateCardItem(cards: BuilderCard[], index: number, patch: Partial<SessionItem>): BuilderCard[] {
  const card = cards[index];
  if (!card || card.block.mode === 'circuit') return cards;
  const block = cloneBlock(card.block);
  const first = block.items[0];
  if (!first) return cards;
  Object.assign(first, patch);
  return replaceAt(cards, index, block);
}

export function updateCircuitRounds(cards: BuilderCard[], index: number, rounds: number): BuilderCard[] {
  const card = cards[index];
  if (!card || card.block.mode !== 'circuit') return cards;
  const block = cloneBlock(card.block);
  block.rounds = Math.max(1, Math.round(rounds));
  return replaceAt(cards, index, block);
}

export function updateCircuitExercise(
  cards: BuilderCard[],
  index: number,
  exIndex: number,
  patch: Partial<SessionItem>,
): BuilderCard[] {
  const card = cards[index];
  if (!card || card.block.mode !== 'circuit') return cards;
  const block = cloneBlock(card.block);
  const ex = block.items[exIndex];
  if (!ex) return cards;
  Object.assign(ex, patch);
  return replaceAt(cards, index, block);
}

export function addCircuitExercise(cards: BuilderCard[], index: number): BuilderCard[] {
  const card = cards[index];
  if (!card || card.block.mode !== 'circuit') return cards;
  const block = cloneBlock(card.block);
  const letter = String.fromCharCode(65 + block.items.length);
  block.items = [...block.items, { name: `Exercise ${letter}`, reps: 10 }];
  return replaceAt(cards, index, block);
}

export function removeCircuitExercise(cards: BuilderCard[], index: number, exIndex: number): BuilderCard[] {
  const card = cards[index];
  if (!card || card.block.mode !== 'circuit' || card.block.items.length <= 1) return cards;
  const block = cloneBlock(card.block);
  block.items = block.items.filter((_, i) => i !== exIndex);
  return replaceAt(cards, index, block);
}

/* ── the tool catalog's default step, per palette kind ──────────────────────────────────────── */

/** What "＋ Add step" inserts for one palette row — a sensible, already-runnable default. Every
 *  item names its `tool` explicitly (the coach's own convention) so there is never a moment of
 *  ambiguity for `inferTool` to resolve differently than intended. */
export function defaultBlockFor(kind: PaletteStepKind): SessionBlock {
  switch (kind) {
    case 'timer':
      return oneItemBlock({ name: 'Timer', tool: 'timer', duration_min: 5 });
    case 'interval':
      return oneItemBlock({
        name: 'Intervals',
        tool: 'interval',
        interval_work_sec: DEFAULT_WORK_SEC,
        interval_recover_sec: DEFAULT_RECOVER_SEC,
        interval_rounds: DEFAULT_ROUNDS,
      });
    case 'reps':
      return oneItemBlock({ name: 'Reps & sets', tool: 'reps', sets: 3, reps: 10 });
    case 'circuit':
      return {
        label: 'Circuit',
        mode: 'circuit',
        rounds: 3,
        items: [
          { name: 'Exercise A', reps: 10 },
          { name: 'Exercise B', reps: 10 },
        ],
      };
    case 'breathing':
      return oneItemBlock({
        name: 'Breathing',
        tool: 'breathing',
        breath_pattern: DEFAULT_PATTERN_ID,
        breath_cycles: DEFAULT_CYCLES,
      });
    case 'meditate':
      return oneItemBlock({
        name: 'Quiet sit',
        tool: 'meditate',
        duration_min: DEFAULT_SIT_MINUTES,
        meditate_bells: 'start_end',
      });
    case 'grounding':
      return oneItemBlock({ name: 'Grounding', tool: 'grounding', grounding_game: 'senses' });
    case 'checkoff':
      return oneItemBlock({ name: 'Check off', tool: 'checkoff' });
    case 'read':
      return oneItemBlock({ name: 'Cue card', tool: 'read', detail: '', duration_min: 1 });
    case 'journal':
      return oneItemBlock({ name: 'Write', tool: 'journal', detail: 'What do you want to write?' });
    case 'feeling_log':
      return oneItemBlock({ name: 'Feeling check-in', tool: 'feeling_log' });
    case 'measure':
      // Deliberately no `tool` — `measure` has no `SessionItemTool` member (see occurrence.ts);
      // `inferTool` reads it from `measure_metric`/`measure_unit` alone.
      return oneItemBlock({ name: 'Measure', measure_metric: 'Weight', measure_unit: 'kg' });
    default: {
      const _exhaustive: never = kind;
      return oneItemBlock({ name: _exhaustive });
    }
  }
}

function oneItemBlock(item: SessionItem): SessionBlock {
  return { label: item.name, items: [item] };
}

/* ── the footer's honest total ──────────────────────────────────────────────────────────────── */

/** What bucket a resolved tool counts toward on the footer — grouped by what a person would call
 *  it, not by the internal tool name. `null` for the coach-only insight tools, which the builder
 *  never emits and so never needs to count. Exported so `builderCatalog.ts` can colour a card's
 *  tool chip by the SAME grouping the footer counts by — one mapping, not two that can drift. */
export function stepBucket(kind: StepToolKind): string | null {
  switch (kind) {
    case 'read':
    case 'checkoff':
      return 'cue';
    case 'timer':
    case 'interval':
    case 'breathing':
    case 'meditate':
      return 'timed';
    case 'reps':
    case 'circuit':
      return 'set';
    case 'journal':
      return 'write';
    case 'measure':
      return 'measure';
    case 'feeling_log':
      return 'check-in';
    case 'grounding':
      return 'grounding';
    case 'photo':
    case 'rings':
    case 'insight':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

const PLURAL: Record<string, string> = {
  cue: 'cues',
  timed: 'timed',
  set: 'sets',
  write: 'writes',
  measure: 'measures',
  'check-in': 'check-ins',
  grounding: 'grounding',
};

export interface StepSummary {
  /** Ordered, present buckets only — a bucket with zero steps is never shown ("never invent"). */
  counts: { bucket: string; count: number }[];
  totalMin: number;
}

/** Tally the cards via `deriveWalkthrough` — the SAME function the walkthrough player runs — so
 *  the footer can never show a total the player would then contradict. */
export function stepSummary(cards: BuilderCard[]): StepSummary {
  const wt = deriveWalkthrough(sessionFromCards(cards));
  const order = ['cue', 'timed', 'set', 'write', 'measure', 'check-in', 'grounding'];
  const tally = new Map<string, number>();
  for (const step of wt.steps) {
    const bucket = stepBucket(step.tool.kind);
    if (!bucket) continue;
    tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
  }
  const counts = order.filter((b) => tally.has(b)).map((bucket) => ({ bucket, count: tally.get(bucket) ?? 0 }));
  return { counts, totalMin: wt.total_min };
}

/** "1 cue · 2 timed · 1 write · Total ~25 min" — an empty draft reads "Add a step to begin." so
 *  the footer never claims a total for nothing. */
export function formatStepSummary(cards: BuilderCard[]): string {
  const { counts, totalMin } = stepSummary(cards);
  if (counts.length === 0) return 'Add a step to begin.';
  const parts = counts.map(({ bucket, count }) => `${count} ${count === 1 ? bucket : (PLURAL[bucket] ?? bucket)}`);
  return `${parts.join(' · ')} · Total ~${totalMin} min`;
}
