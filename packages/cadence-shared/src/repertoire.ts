/**
 * Repertoire rendering — pure functions, shared so the API's prescribe path and the list screen
 * read one set of facts about a shelf.
 *
 * FACTS ONLY (owner ruling 2026-09-03). What the coach reads here says what is on file — the
 * standing, when each item was last worked, its settled tempo, its practice note — and what a
 * standing MEANS. It never says which item to choose, how many to take, or which order to prefer
 * them in. She is a reasoning model with the whole shelf in front of her and the person to talk to;
 * a computed "due next" pick used to ride these lines, and biasing her that way made the app read
 * as a program running her rather than a coach thinking. `pickDueNext` was deleted with it.
 *
 * `byRest` survives as a DISPLAY comparator only — the list screen orders an unranked Keeping-up
 * group by it and prints each row's date, so the order states a fact the person can check.
 */
import type { RepertoireStatus } from './types/repertoire.ts';
import { type MetronomeSpec, DEFAULT_METER, normalizeMetronome } from './metronome.ts';

/** The slice of an item the rotation and renderers need — repos and tools both satisfy it. */
export interface RepertoireLike {
  label: string;
  status: RepertoireStatus;
  kind?: string | null;
  last_practiced_at?: string | null;
  learned_at?: string | null;
  started_at?: string;
  /** Durable per-item facts. The settled tempo rides here — see `settledTempo`. */
  meta?: Record<string, unknown> | null;
  /** The name of the collection this item is in, joined from `cadence.repertoire_collections`, or
   *  null when it is in none. A NAME on the row rather than in `meta`: a collection is its own row
   *  now (migration 0056), so the name is stored once and every reader is handed the same copy of
   *  it — a rename cannot leave half a shelf on the old spelling. */
  collection_name?: string | null;
}

/* ── The settled tempo ───────────────────────────────────────────────────────────────────────
   Where the metronome's per-piece tempo lives, and the ONE place its meta keys are spelled. The
   dock used to keep this in localStorage alone, which meant a new phone lost the tempo you had
   settled on and the coach could never see it. `repertoire.meta` was reserved for exactly this
   from the start ("durable per-item facts (composer, book, settled metronome bpm)").

   Keys live here rather than at each call site for the same reason the weigh-in regex does: the
   web writes it, the API reads it, and the prescribe renderer prints it. Three spellings of
   'tempo_bpm' is a bug nobody sees until a tempo silently stops coming back. */
export const TEMPO_BPM_KEY = 'tempo_bpm';
export const TEMPO_METER_KEY = 'tempo_meter';

/** The settled tempo on an item, or undefined when there is none (or it is unusable). */
export function settledTempo(meta: Record<string, unknown> | null | undefined): MetronomeSpec | undefined {
  if (!meta) return undefined;
  const bpm = meta[TEMPO_BPM_KEY];
  const meter = meta[TEMPO_METER_KEY];
  return normalizeMetronome(typeof bpm === 'number' ? bpm : undefined, typeof meter === 'number' ? meter : undefined);
}

/** The meta PATCH recording a settled tempo. Merged into whatever meta already holds, never
 *  replacing it — a composer stored last month must survive tonight's tempo change. */
export function tempoMeta(spec: MetronomeSpec): Record<string, unknown> {
  return { [TEMPO_BPM_KEY]: spec.bpm, [TEMPO_METER_KEY]: spec.meter };
}

/* ── Qualifiers ─────────────────────────────────────────────────────────────────────────────
   The fields that tell two items with one title apart — who wrote it, and the person's own
   description of which one it is — plus, for material that has an order (a book, a grading
   ladder), its rank. Structured in `meta` so the title can stay short and the qualifier does the
   work: "Minuet in G Major" is three pieces on one shelf until Bach or "the fast one my teacher
   set" is named.

   TWO FIELDS LEFT THIS SET, both on owner rulings, and both the same way: no migration removed
   the key, so a row in the wild still carries it and the read simply never looks at it.

    - `catalogue`, 2026-09-03 — *"Catalogue number is very music-specific and adds little; that can
      go in the title or description. We're overly optimising for one use case."*
    - `collection`, 2026-09-03 — a collection is a ROW now (migration 0056), not a name copied onto
      every item. The name lives once, in `cadence.repertoire_collections`; the item carries a
      `collection_id` and reads its name back as `collection_name`. A name on each item could not be
      renamed in one place, could not exist before its first item, and was matched by spelling.

   Spelled ONCE here. The seed writes these, the item screen edits them, identity reads them for
   the collision check, and the list renders them on the row's second line — four call sites in
   three packages, which is exactly the hand-copied-key drift the weigh-in regex taught. */
export const COMPOSER_KEY = 'composer';
/** 1-based position in an ordered collection. Present on every item of a goal ⇒ the list is a ladder. */
export const RANK_KEY = 'rank';

/**
 * The person's own words for WHICH ONE this is — "the fast one in G", "the one my teacher set",
 * "the version with the repeat". Free text, and the answer to the same question the composer and
 * the collection answer, for the many items that have neither: a kata, a poem, a prayer, a book.
 *
 * Added 2026-09-03 on the owner's ruling, together with the removal of `catalogue`: a BWV number
 * is one domain's way of saying which one, and a sentence is everybody's. The coach may write it
 * (`update_repertoire`), the item screen edits it, and the matcher reads its words, so "the fast
 * one in G" resolves against the row that says so.
 */
export const DESCRIPTION_KEY = 'description';

/**
 * The practice note — how it is going, right now: "bars 9-16", "p. 240", "first stanza",
 * "for 5th kyu". Unlike the qualifiers above it says nothing about WHICH item this is; it is what
 * is on file about how the work is going. Read by both consumers of "the durable facts on a row"
 * (the coach's own line in session-practice-facts.ts, and this row's second line on the list
 * screen) so the two never drift into separate vocabularies for the same fact. Folded into the
 * SAME qualifier read/patch below rather than a parallel pair of functions, so the item screen's
 * one PATCH writes the note alongside composer/description/rank in a single merge.
 *
 * The schema key stays `practice_note`; the person sees "Notes" (CLAUDE.md's nomenclature rule).
 */
export const PRACTICE_NOTE_KEY = 'practice_note';

export interface PieceQualifiers {
  composer?: string;
  /** See `DESCRIPTION_KEY` — their own words for which one it is. Capped at `DESCRIPTION_MAX`. */
  description?: string;
  rank?: number;
  /** See `PRACTICE_NOTE_KEY` — how the work is going, not WHICH item this is. */
  note?: string;
}

/** A qualifier is a phrase, not a paragraph. */
const QUALIFIER_MAX = 120;

/** The description gets twice the room: it is a sentence about which one this is, and the fields
 *  it replaces for non-music domains (a catalogue number, an opus) were terse in a way a sentence
 *  is not. Still bounded — it rides the coach's context on every practice turn. */
export const DESCRIPTION_MAX = 240;

const boundedString = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const qualifierString = (v: unknown): string | undefined => boundedString(v, QUALIFIER_MAX);

/** The qualifiers on an item, or nothing where a field is absent or unusable. Never throws. */
export function pieceQualifiers(meta: Record<string, unknown> | null | undefined): PieceQualifiers {
  if (!meta) return {};
  const out: PieceQualifiers = {};
  const composer = qualifierString(meta[COMPOSER_KEY]);
  const description = boundedString(meta[DESCRIPTION_KEY], DESCRIPTION_MAX);
  const note = qualifierString(meta[PRACTICE_NOTE_KEY]);
  const rank = meta[RANK_KEY];
  if (composer) out.composer = composer;
  if (description) out.description = description;
  if (note) out.note = note;
  if (typeof rank === 'number' && Number.isInteger(rank) && rank >= 1) out.rank = rank;
  return out;
}

/** The meta PATCH for a set of qualifiers — only the fields given, so a partial edit never blanks
 *  the others. Merged into meta by the repo, never written whole. */
export function qualifierMeta(q: PieceQualifiers): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const composer = qualifierString(q.composer);
  const description = boundedString(q.description, DESCRIPTION_MAX);
  const note = qualifierString(q.note);
  if (composer) patch[COMPOSER_KEY] = composer;
  if (description) patch[DESCRIPTION_KEY] = description;
  if (note) patch[PRACTICE_NOTE_KEY] = note;
  if (typeof q.rank === 'number' && Number.isInteger(q.rank) && q.rank >= 1) patch[RANK_KEY] = q.rank;
  return patch;
}

/** The practice note on its own, or undefined where there is none (or it is blank) — for a caller
 *  that wants just this one fact rather than the whole qualifier bundle. Same trim-and-cap rule as
 *  every other qualifier string (`qualifierString`): trimmed, capped at 120 characters, never
 *  thrown on a bad shape. */
export function practiceNoteOf(meta: Record<string, unknown> | null | undefined): string | undefined {
  if (!meta) return undefined;
  return qualifierString(meta[PRACTICE_NOTE_KEY]);
}

/** The description on its own, for the renders that print it as a fact. Same shape as
 *  `practiceNoteOf`, at the description's own bound. */
export function descriptionOf(meta: Record<string, unknown> | null | undefined): string | undefined {
  if (!meta) return undefined;
  return boundedString(meta[DESCRIPTION_KEY], DESCRIPTION_MAX);
}

const time = (iso?: string | null): number => (iso ? new Date(iso).getTime() : Number.NaN);

/** Longest-rest-first: never-practiced beats practiced; ties break by started_at (oldest first),
 *  then by codepoint label order — locale-independent, so the order is identical on a dev laptop
 *  and a UTC server rather than dependent on ICU data or row order.
 *
 *  A DISPLAY order, and since 2026-09-03 nothing but that: the list screen sorts an unranked
 *  Keeping-up group by it and shows each row's date, so the order only restates a fact already on
 *  the row. It no longer feeds anything the coach reads — `pickDueNext`, which returned the first
 *  of this order and rode the prompt as "DUE NEXT", was deleted under the facts-not-picks ruling.
 *  Lives in `@cadence/shared` because a comparator that decides what a person sees belongs in one
 *  place (CLAUDE.md), never hand-copied per call site. */
export function byRest(a: RepertoireLike, b: RepertoireLike): number {
  const at = time(a.last_practiced_at);
  const bt = time(b.last_practiced_at);
  const aNever = Number.isNaN(at);
  const bNever = Number.isNaN(bt);
  if (aNever !== bNever) return aNever ? -1 : 1;
  if (!aNever && at !== bt) return at - bt;
  const as = time(a.started_at);
  const bs = time(b.started_at);
  if (!Number.isNaN(as) && !Number.isNaN(bs) && as !== bs) return as - bs;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** "worked today" / "worked 3 days ago" — relative day-counts, never calendar dates: the server
 *  clock is UTC, and a local-looking date would be wrong for anyone west of it by evening. */
const practicedNote = (i: RepertoireLike, now: number): string => {
  const t = time(i.last_practiced_at);
  if (Number.isNaN(t)) return 'not worked yet while on file';
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0 ? 'worked today' : days === 1 ? 'worked yesterday' : `worked ${days} days ago`;
};

/** "settled tempo 72 bpm" — the tempo they actually practise this at, so a prescription can meet
 *  them where they are instead of guessing. The meter is named only when it is not the common 4,
 *  where printing it would be noise on every line. */
const tempoNote = (i: RepertoireLike): string | null => {
  const t = settledTempo(i.meta);
  if (!t) return null;
  return t.meter === DEFAULT_METER ? `settled tempo ${t.bpm} bpm` : `settled tempo ${t.bpm} bpm, ${t.meter} to the bar`;
};

/** "note: bars 9-16" — how the work on this item is going, stored by the item screen (P8) and read
 *  through the one qualifier reader, never a hand-spelled meta key. Added to this render 2026-09-03:
 *  it was already on the row's second line and in the prescribe facts, and holding it back here left
 *  her reading "worked yesterday" with no way to know what was worked on. */
const noteMark = (i: RepertoireLike): string | null => {
  const note = practiceNoteOf(i.meta);
  return note ? `note: ${note}` : null;
};

/** "description: the fast one in G" — the person's own words for which item this is, so a request
 *  phrased their way ("the fast one") reaches her already resolved. */
const descriptionMark = (i: RepertoireLike): string | null => {
  const description = descriptionOf(i.meta);
  return description ? `description: ${description}` : null;
};

/** "collection: Suzuki Book 2" — the group this item belongs to, read off the joined name rather
 *  than `meta` (migration 0056). A fact about the item like every other mark on the line: it says
 *  which one this is when a title alone does not, and says nothing about what to do with it. */
const collectionMark = (i: RepertoireLike): string | null => {
  const name = typeof i.collection_name === 'string' ? i.collection_name.trim() : '';
  return name ? `collection: ${name}` : null;
};

/**
 * How many Learned items she is shown, and the ONLY cap on what she reads (owner ruling
 * 2026-09-03).
 *
 * What they are working on — Learning, Up next, Keeping up — goes in full: those are the facts a
 * session is built from and a cut there hides live material. Learned only grows, and a reading
 * record can reach several hundred, so she gets the most recent 12 plus the total, and asks
 * `get_repertoire` for the rest when the conversation is actually about it. Owner: *"a 500-piece
 * Learned list should not go to the coach every turn; the total plus the ability to ask for more
 * limits tokens and gives her a more relevant list."*
 */
export const LEARNED_CAP = 12;

/**
 * When a finished item was last touched: the LATER of the day they finished it and any practice
 * since. NaN when it carries neither date (backfilled — they already knew it when they told us).
 *
 * Both dates are practices, so ranking on either alone hides half the shelf: a piece finished in
 * 2019 and played last week is recent, and so is one finished last week and never touched again.
 */
function lastTouched(i: RepertoireLike): number {
  const dates = [time(i.last_practiced_at), time(i.learned_at)].filter((t) => !Number.isNaN(t));
  return dates.length ? Math.max(...dates) : Number.NaN;
}

/** Most recently touched first; an item with no date at all sorts last, never at a guessed
 *  position among the dated ones, with the label breaking a tie so the order is stable. */
export function byLastTouched(a: RepertoireLike, b: RepertoireLike): number {
  const at = lastTouched(a);
  const bt = lastTouched(b);
  const aNone = Number.isNaN(at);
  const bNone = Number.isNaN(bt);
  if (aNone !== bNone) return aNone ? 1 : -1;
  if (!aNone && at !== bt) return bt - at;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** The Learned items she is shown, most recently touched first, and how many there are in all.
 *  Both renders read this one function so the coach's context block and the prescribe prompt can
 *  never disagree about which twelve, or about the number. */
export function cappedLearned(items: RepertoireLike[]): { shown: RepertoireLike[]; total: number } {
  const learned = items.filter((i) => i.status === 'retired');
  return { shown: [...learned].sort(byLastTouched).slice(0, LEARNED_CAP), total: learned.length };
}

/** "Learned: 214 items — 12 most recent shown" — the count is always stated, so a capped group can
 *  never read as the whole record. Domain-neutral noun: the same row holds kata, books and verses
 *  (P8), so "pieces" would be wrong for three of the four. */
export function learnedTotalLine(total: number, shown: number): string {
  const head = `Learned: ${total} item${total === 1 ? '' : 's'}`;
  return total > shown ? `${head} — ${shown} most recent shown` : head;
}

/**
 * The four groups, in the order she reads them, each header DEFINING its standing.
 *
 * Two things every header must do, because this text is read by a MODEL (tool-catalog.ts, "HOW TO
 * WRITE THE STRINGS IN THIS FILE"):
 *
 *  1. **State what the group MEANS, and stop there.** Until 2026-09-03 these headers gave orders —
 *     "draw warm-up and play-out material from here, longest rest first", "keep it to one or two",
 *     "propose the top one". The owner ruled all of it out: *"We don't need to give the coach ANY
 *     direction on how to pick... We continue to try to influence or bias the LLM's natural
 *     reasoning, but we shouldn't. That will make our application seem unnatural."* She has the
 *     whole shelf and the person in front of her; a definition is what she is missing, not a rule.
 *  2. **Name the status word she writes back.** The user-facing label and the schema word differ
 *     on purpose, and one pair collides outright: the group called "Learned" is `retired`, while
 *     `learned` is the verb for the opposite move (crossed into Keeping up just now, celebrated
 *     once). Without the word in the header she would write status "learned" to file something
 *     under Learned and land it back among what they still play, with a cheer attached.
 *
 * The one imperative left is `queued`'s "Never start one unless they ask". It is a consent
 * boundary, not a picking rule — it says what she may not do to their material unasked, and says
 * nothing about which item today's work comes from. (The same distinction keeps "nothing is saved
 * until they confirm" in the tool descriptions.)
 *
 * Exported (2026-09-02, P6 "the room") for the GROUP ORDER only: the list screen renders its four
 * sections in exactly this array's order (`working, queued, known, retired`), read off here so the
 * screen and the coach can never disagree about which standing comes first. The HEADER TEXT below
 * is not for the screen — it is third-person and names the schema word by design, because it is a
 * prompt string a MODEL reads, and putting it in front of a person would break the
 * warm-UI/boring-prompt split CLAUDE.md's nomenclature rule draws. The screen carries its own
 * short, warm line per standing instead (`GROUP_LINES` in `repertoireListCopy.ts`, web package) —
 * a first attempt at reusing this text verbatim for the UI was wrong and was reverted (owner
 * review, 2026-09-02).
 */
/**
 * Schema word → the standing's name. The web's own `STANDING_WORDS` (repertoireItemCopy.ts) is the
 * same four words for the SCREEN, where they are button labels; these are the ones the coach reads,
 * and they live here because the header above and the API's per-item line (session-practice-facts)
 * both need them and a third hand-typed copy is how a name drifts.
 */
export const STANDING_NAMES: Record<RepertoireStatus, string> = {
  working: 'Learning',
  queued: 'Up next',
  known: 'Keeping up',
  retired: 'Learned',
};

/**
 * What each standing MEANS — the definition half of what she is handed, spelled once.
 *
 * `queued`'s second sentence is a consent boundary, not a picking rule: it says what she may not do
 * to their material unasked. The facts-not-picks ruling removed the rules ("draw warm-up material
 * from here", "keep it to one or two") and kept this, because the two are different things — one
 * biases her reasoning, the other protects the person's material from being started for them.
 */
export const STANDING_MEANS: Record<RepertoireStatus, string> = {
  working: 'being worked on now',
  queued: "not started, in the user's own order. Never start one unless they ask",
  known: 'learned and still played',
  retired: 'finished; not played any more',
};

export const REPERTOIRE_GROUPS: Array<{ status: RepertoireStatus; header: string }> = (
  ['working', 'queued', 'known', 'retired'] as const
).map((status) => ({
  status,
  header: `${STANDING_NAMES[status]} (status "${status}") — ${STANDING_MEANS[status]}:`,
}));

/**
 * The compact text both consumers inject — get_repertoire's render and prescribe-session's
 * {{repertoire}} variable. One renderer so the coach in chat and the coach programming a session
 * read the same facts in the same words. Empty string when there is nothing on file.
 *
 * Every line is a FACT about one item — its kind, when it was last worked, its settled tempo, the
 * collection it is in, its practice note — and nothing on it ranks one item against another. No
 * item is marked, and no header says which group today's work comes from.
 *
 * Learning, Up next and Keeping up go in FULL. Learned is the one capped group — the 12 most
 * recently touched, under a line stating how many there are in all, so she can see the size of the
 * record and ask `get_repertoire` for the rest (`LEARNED_CAP`). `now` is injectable for tests;
 * callers omit it. `allLearned` lifts the cap, and exists for exactly one caller: `get_repertoire`
 * answering the ask the total line invites.
 */
export function renderRepertoire(
  items: RepertoireLike[],
  now = Date.now(),
  opts: { allLearned?: boolean } = {},
): string {
  if (!items.length) return '';
  const line = (i: RepertoireLike): string => {
    const marks = [
      i.kind,
      practicedNote(i, now),
      tempoNote(i),
      collectionMark(i),
      descriptionMark(i),
      noteMark(i),
    ].filter(Boolean);
    return `  - ${i.label} (${marks.join('; ')})`;
  };
  const sections: string[] = [];
  for (const spec of REPERTOIRE_GROUPS) {
    const members = items.filter((i) => i.status === spec.status);
    if (!members.length) continue;
    if (spec.status === 'retired') {
      const { shown, total } = opts.allLearned
        ? { shown: [...members].sort(byLastTouched), total: members.length }
        : cappedLearned(members);
      sections.push(`${spec.header}\n  ${learnedTotalLine(total, shown.length)}\n${shown.map(line).join('\n')}`);
      continue;
    }
    sections.push(`${spec.header}\n${members.map(line).join('\n')}`);
  }
  return sections.join('\n');
}
