/**
 * The deterministic facts a practice session is built from — the standings, read back.
 *
 * A practice session IS the shape of the shelf: the warm-up comes from Keeping up (the item rested
 * longest), the learn part from Learning, the play-out from Keeping up again, Up next is named only
 * as a forecast, and Learned is never scheduled. Move a piece between standings and Thursday
 * changes in a way the person can predict.
 *
 * This module answers WHICH items those are, and nothing else. It does not assemble a session, pick
 * block labels, or decide how long anything takes — the coach does all of that with these facts in
 * front of her (TOOL-HARNESS.md: deterministic code is a tool she calls, never a pipeline that
 * calls her). Every rule here is one she may overrule for a reason she states.
 *
 * Pure: no DB, no clock. The caller hands it the goal-scoped shelf and the recent logs it already
 * read for the prescribe prompt.
 */
import { DEFAULT_METER, pickDueNext, pieceQualifiers, settledTempo, type RepertoireLike } from '@cadence/shared';
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

export interface LearningFact {
  label: string;
  /** What the row durably holds about how this piece is practised. '' when it holds nothing. */
  practice_note: string;
  last_words: LastWords | null;
}

export interface PracticeFacts {
  /** The Keeping up item resting longest — the warm-up. Null when nothing is in the rotation. */
  warmup_pick: RepertoireLike | null;
  /** The next-rested Keeping up item — what a swap offers. Null when the rotation holds one item. */
  next_rested: RepertoireLike | null;
  learning: LearningFact[];
  /** The first item of Up next, as a forecast. Never a step in the session. */
  up_next_top: RepertoireLike | null;
}

/** Enough Learning items to program from; more than this and the session is not the problem. */
const LEARNING_CAP = 4;

/** A quoted log is one line in a prompt, not a transcript. */
const WORDS_CAP = 200;

/**
 * The durable facts on a row, as one line: the tempo they actually play it at, and the qualifiers
 * that tell it from another piece with the same title. Same words as the shelf render's own tempo
 * line, deliberately — the coach reads both in one prompt and one vocabulary is the point.
 */
function practiceNote(i: RepertoireLike): string {
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
  if (q.composer) parts.push(`composer: ${q.composer}`);
  if (q.collection) parts.push(`collection: ${q.collection}`);
  if (q.catalogue) parts.push(`catalogue: ${q.catalogue}`);
  if (q.rank !== undefined) parts.push(`rank: ${q.rank}`);
  return parts.join('; ');
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
 * Up next in the user's order: a ranked ladder first (rank 1 is next), then anything unranked in
 * the order it arrived — which is the order `listRepertoire` returns and the order the shelf render
 * prints. A stable sort, so an unranked shelf is left exactly as the person arranged it.
 */
function firstQueued(items: RepertoireLike[]): RepertoireLike | null {
  const queued = items.filter((i) => i.status === 'queued');
  const ranked = queued
    .map((i, at) => ({ i, at, rank: pieceQualifiers(i.meta).rank ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at);
  return ranked[0]?.i ?? null;
}

/**
 * The four facts. `items` is the shelf already scoped to this session's goal; `recentLogs` are the
 * same-title logs the prescribe prompt already carries (newest first).
 */
export function practiceFacts(items: RepertoireLike[], recentLogs: PracticeLogRow[]): PracticeFacts {
  // Only 'known' rotates — pickDueNext enforces that, and the swap reuses it rather than spelling
  // the ordering a second time. Two spellings of "rested longest" would not throw; they would just
  // disagree, and the swap would offer a piece the warm-up already used.
  const warmup = pickDueNext(items);
  const next = warmup ? pickDueNext(items.filter((i) => i !== warmup)) : null;
  const ambiguous = ambiguousNeedles(items);
  const learning = items
    .filter((i) => i.status === 'working')
    .slice(0, LEARNING_CAP)
    .map((i) => ({
      label: i.label,
      practice_note: practiceNote(i),
      last_words: lastWordsFor(i, recentLogs, ambiguous),
    }));
  return { warmup_pick: warmup, next_rested: next, learning, up_next_top: firstQueued(items) };
}

/** "Arietta — settled tempo 72 bpm" — the label, plus what the row holds about it. */
const pieceLine = (i: RepertoireLike): string => {
  const note = practiceNote(i);
  return note ? `${i.label} — ${note}` : i.label;
};

function renderLearning(facts: PracticeFacts, working: number): string {
  const lines: string[] = [];
  for (const l of facts.learning) {
    lines.push(`- ${l.label}`);
    if (l.practice_note) lines.push(`  practice note: ${l.practice_note}`);
    lines.push(
      l.last_words
        ? `  last words ${l.last_words.date}: ${l.last_words.words}`
        : '  no words logged about this piece in the recent sessions',
    );
  }
  // Never a silent cut: a truncation nobody declares is a lie about how much is being learned.
  if (working > facts.learning.length) lines.push(`…and ${working - facts.learning.length} more in Learning`);
  return lines.join('\n');
}

/**
 * The four prompt variables, as text. Empty strings mean "say nothing about this" — for a goal with
 * no shelf, and for a shelf that could not be READ (`items` null), where the prescribe prompt's
 * {{repertoire}} already says so. An empty tag is ignored by the template, so a non-practice session
 * is byte-identical to what it was before these existed.
 */
export function practiceVariables(
  items: RepertoireLike[] | null,
  recentLogs: PracticeLogRow[],
): { warmup_pick: string; next_rested: string; learning: string; up_next_top: string } {
  if (!items?.length) return { warmup_pick: '', next_rested: '', learning: '', up_next_top: '' };
  const facts = practiceFacts(items, recentLogs);
  return {
    warmup_pick: facts.warmup_pick ? pieceLine(facts.warmup_pick) : '',
    next_rested: facts.next_rested ? pieceLine(facts.next_rested) : '',
    learning: renderLearning(facts, items.filter((i) => i.status === 'working').length),
    up_next_top: facts.up_next_top ? pieceLine(facts.up_next_top) : '',
  };
}
