/**
 * The facts a practice session is built from — the whole shelf, read back.
 *
 * FACTS, NOT PICKS (owner ruling 2026-09-03). This module used to make the session's choices: it
 * computed the warm-up (the Keeping up item resting longest), the swap behind it, a capped Learning
 * list and the top of Up next, and the prompt told her to use exactly those. The owner ruled it out
 * — *"We don't need to give the coach ANY direction on how to pick warm-up pieces. It's a reasoning
 * model. It can reason and it can discuss the best thing with the user. We continue to try to
 * influence or bias the LLM's natural reasoning, but we shouldn't. That will make our application
 * seem unnatural."*
 *
 * So it now answers one question — WHAT IS ON THE SHELF — and hands every item over with the same
 * facts: its standing, when it was last practised, the tempo they settled on, the note saying where
 * the work is, its place in a collection, and the person's own words from the most recent session
 * that named it. It states what the four standings mean and stops there. Nothing marks an item,
 * nothing orders them, nothing counts how many to take. She reads the shelf and decides with the
 * person in front of her (TOOL-HARNESS.md: deterministic code is a tool she calls).
 *
 * Pure: no DB, no clock. The caller hands it the goal-scoped shelf and the recent logs it already
 * read for the prescribe prompt.
 */
import {
  DEFAULT_METER,
  REPERTOIRE_GROUPS,
  STANDING_MEANS,
  STANDING_NAMES,
  cappedLearned,
  learnedTotalLine,
  pieceQualifiers,
  settledTempo,
  type RepertoireLike,
} from '@cadence/shared';
import { ambiguousNeedles, itemNamedIn, matchHay } from './repertoire-match.ts';

/** One row of `listRecentLogsByTitle`, structurally — the same shape the prescribe prompt renders. */
export interface PracticeLogRow {
  date: string;
  log?: { summary?: string; raw_text?: string; items?: Array<{ name?: string; felt?: string }> } | null;
}

/** The person's own words from the most recent session that mentions a piece. */
export interface LastWords {
  date: string;
  words: string;
}

/** One item on the shelf, with everything on file about it. No item carries a rank against the
 *  others — `rank` is its printed position in a collection, a fact about the book, not a priority. */
export interface ItemFact {
  label: string;
  status: RepertoireLike['status'];
  /** ISO date of the last practice, or null where there has never been one. */
  last_practiced_on: string | null;
  /** The durable facts on the row — tempo, note, position — as one phrase. '' when it holds none. */
  detail: string;
  last_words: LastWords | null;
}

export interface PracticeFacts {
  items: ItemFact[];
}

/** A quoted log is one line in a prompt, not a transcript. */
const WORDS_CAP = 200;

/**
 * The durable facts on a row, as one phrase: the tempo they actually play it at, where the work is,
 * and the position the collection prints. Same words as the shelf render's own tempo line,
 * deliberately — the coach reads both in one prompt and one vocabulary is the point.
 *
 * The stored practice note (P8 — `bars 9-16`, `p. 240`, `first stanza`, `for 5th kyu`) is a fact
 * about how the item is being worked, and rides here beside the tempo rather than in front of it:
 * with no pick to justify any more, no fact on this line outranks another.
 */
function rowDetail(i: RepertoireLike): string {
  const parts: string[] = [];
  const tempo = settledTempo(i.meta);
  if (tempo) {
    parts.push(
      tempo.meter === DEFAULT_METER
        ? `settled tempo ${tempo.bpm} bpm`
        : `settled tempo ${tempo.bpm} bpm, ${tempo.meter} to the bar`,
    );
  }
  const q = pieceQualifiers(i.meta);
  if (q.description) parts.push(`description: ${q.description}`);
  if (q.note) parts.push(`note: ${q.note}`);
  if (q.composer) parts.push(`composer: ${q.composer}`);
  if (q.collection) parts.push(`collection: ${q.collection}`);
  if (q.rank !== undefined) parts.push(`rank ${q.rank}`);
  return parts.join(' · ');
}

/** The words of the most recent log that NAMES this piece, or null. Never a guess: the shelf-wide
 *  shared-needle rule applies, so a mention that could be either of two pieces decides for neither. */
function lastWordsFor(item: RepertoireLike, logs: PracticeLogRow[], ambiguous: ReadonlySet<string>): LastWords | null {
  for (const row of logs) {
    const log = row.log;
    if (!log) continue;
    const names = (log.items ?? []).map((it) => it.name);
    const hay = matchHay([log.summary, log.raw_text, ...names]);
    if (!hay || !itemNamedIn(item.label, hay, ambiguous)) continue;
    // Their own words first — the summary is our sentence about the session, the raw text is
    // theirs. Bounded, because this is one line of a prompt.
    const body = (log.raw_text ?? '').trim() || (log.summary ?? '').trim();
    if (!body) continue;
    const felt = (log.items ?? []).find(
      (it) => it.name && it.felt && itemNamedIn(item.label, matchHay([it.name]), ambiguous),
    )?.felt;
    const words = body.length > WORDS_CAP ? `${body.slice(0, WORDS_CAP)}…` : body;
    return { date: row.date, words: felt ? `${words} (felt ${felt})` : words };
  }
  return null;
}

/**
 * Every item on the shelf, in the order the shelf came in. `items` is already scoped to this
 * session's goal; `recentLogs` are the same-title logs the prescribe prompt already carries (newest
 * first). The order is left exactly as `listRepertoire` returned it — a re-sort here would be an
 * ordering she could read as a ranking, which is the thing this file no longer does.
 */
export function practiceFacts(items: RepertoireLike[], recentLogs: PracticeLogRow[]): PracticeFacts {
  const ambiguous = ambiguousNeedles(items);
  return {
    items: items.map((i) => ({
      label: i.label,
      status: i.status,
      last_practiced_on: i.last_practiced_at ? i.last_practiced_at.slice(0, 10) : null,
      detail: rowDetail(i),
      last_words: lastWordsFor(i, recentLogs, ambiguous),
    })),
  };
}

/** "Arietta · Keeping up · last practised 2026-08-20 · settled tempo 72 bpm" — every segment a fact,
 *  and only the ones the row actually holds. The last-practised segment is the exception: it always
 *  prints, because "never" is itself the fact, and an absent segment would read as an oversight. */
function itemLine(f: ItemFact): string {
  const segments = [
    f.label,
    STANDING_NAMES[f.status],
    `last practised ${f.last_practiced_on ?? 'never'}`,
    f.detail,
    f.last_words ? `last words ${f.last_words.date}: ${f.last_words.words}` : '',
  ].filter(Boolean);
  return `- ${segments.join(' · ')}`;
}

/**
 * What each standing means, in one line, assembled from `@cadence/shared`'s own words so the
 * prescribe prompt and the chat render can never define a standing two different ways.
 *
 * It is here because the flat list names a standing per line and a definition has to come from
 * somewhere; the grouped render (`renderRepertoire`) carries the same four sentences as its group
 * headers. `Up next`'s "Never start one unless they ask" rides along, which is the point — it is a
 * consent boundary, not a picking rule, and the ruling kept it.
 */
function standingsLine(): string {
  const defs = REPERTOIRE_GROUPS.map(({ status }) => `${STANDING_NAMES[status]} — ${STANDING_MEANS[status]}`);
  return `Standings: ${defs.join('. ')}.`;
}

/**
 * The ONE prompt variable, as text: what they play, with the standings defined above it.
 *
 * An empty string means "say nothing about this" — for a goal with no shelf, and for a shelf that
 * could not be READ (`items` null), where `session-generate.ts` substitutes its own fault text so a
 * failed read can never be mistaken for an empty record. An empty tag is ignored by the template.
 *
 * Four variables became one here (2026-09-03): `warmup_pick`, `next_rested`, `learning` and
 * `up_next_top` each existed to tell her which item went where, and the prompt lines that consumed
 * them went with them.
 */
export function practiceVariables(
  items: RepertoireLike[] | null,
  recentLogs: PracticeLogRow[],
): { repertoire: string } {
  if (!items?.length) return { repertoire: '' };
  // Read over the WHOLE shelf first, then choose what to print. The order matters: the last-words
  // matcher's shared-needle rule is shelf-wide, so a Minuet hidden below the Learned cap must still
  // make "worked the Minuet" ambiguous. Filtering before matching would let a cut change what a log
  // is taken to mean.
  const facts = practiceFacts(items, recentLogs);
  const factOf = new Map<RepertoireLike, ItemFact>();
  items.forEach((i, at) => factOf.set(i, facts.items[at]!));
  const lineOf = (i: RepertoireLike): string => itemLine(factOf.get(i)!);

  // Learning, Up next and Keeping up in full — a session is built from those, and a cut there hides
  // live material. Learned is the one capped group (owner ruling 2026-09-03), read through
  // `@cadence/shared`'s own helpers so this and the chat render show the same twelve and state the
  // same total; a second spelling of "12 most recent" is how the two would drift.
  const active = items.filter((i) => i.status !== 'retired').map(lineOf);
  const { shown, total } = cappedLearned(items);
  const learned = total ? [learnedTotalLine(total, shown.length), ...shown.map(lineOf)] : [];
  return { repertoire: [standingsLine(), ...active, ...learned].join('\n') };
}
