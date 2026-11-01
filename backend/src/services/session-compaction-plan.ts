/**
 * What the next compaction folds: which rows stay verbatim, which are summarized, which are
 * dropped, and where the mark moves. Pure, so `eval-compaction.ts` replays exactly what
 * production does. The runner is `session-compaction.ts`.
 */

import type { ChatSessionRow, ChatMessageRow } from '../types.ts';
import { MAX_VARIABLE_LENGTH } from '../ai-manager/job-execution-utils.ts';
import {
  buildCompactedHistory,
  estimateSessionTokens,
  estimateTokenCount,
  isInstruction,
  rowMatcher,
  type CompactionThreshold,
  type ResolvedSummarizer,
} from './session-compaction-history.ts';

/**
 * The most characters of dialogue one round hands the summarizer: the fold size.
 *
 * Pinned at 9,900, the size every compaction reading was measured at (eval:compaction, 94% over
 * four folds, 2026-10-31). It used to be derived from the engine's variable cap, which was 10,000
 * then: `interpolateTemplate` cut a longer transcript while the mark still moved past the whole
 * round, so the cut-off rows were neither summarized nor ever sent again (HARNESS-V3 P1b, finding
 * A). The cap was raised to 40,000 on 2026-11-01; the fold did NOT follow it, because a bigger
 * fold is a different summarizer input and wants its own reading before it goes live. The
 * `Math.min` keeps the fold under whatever the engine reads, so the P1b loss cannot come back.
 */
const FOLD_CHARS = 9_900;
export const TRANSCRIPT_BUDGET_CHARS = Math.min(FOLD_CHARS, MAX_VARIABLE_LENGTH - 100);

/**
 * The most summary the job can read back. `existingSummary` is a job variable like `transcript`,
 * and `interpolateTemplate` cuts every variable at `MAX_VARIABLE_LENGTH`. The structured summary
 * keeps its headings in a fixed order, so a cut drops the LAST ones (where things stand, what did
 * not work) without a word. Past this the planner refuses to fold and says so (see `NoCompaction`).
 * At ~130 words a round that is roughly the thirtieth fold (the eighth, at the old 10,000 cap); the
 * fix for a session that long is a fold of the summary onto itself, not a bigger cap — logged in
 * HARNESS-V3 C5.4.
 */
export const SUMMARY_BUDGET_CHARS = MAX_VARIABLE_LENGTH;

/** Appended when one row alone is longer than the budget and has to be shortened to fit. */
const CUT_MARK = ' … [cut to fit the summarizer]';

/** The kept tail never shrinks below this many exchanges, however big they are. */
const MIN_TAIL_EXCHANGES = 2;

/**
 * Split the uncompacted rows into what gets summarized and what stays verbatim, by TURNS.
 *
 * Counts back `keepN` real turns. App rows sitting just before the first kept turn stay with it —
 * they are that turn's context, and summarizing them away would leave the turn without it.
 */
export function splitForCompaction(
  pending: ChatMessageRow[],
  keepN: number,
  appRowPattern?: string,
): { toSummarize: ChatMessageRow[]; kept: ChatMessageRow[] } {
  const isAppRow = rowMatcher(appRowPattern);
  let cut = pending.length;
  let turns = 0;
  while (cut > 0 && turns < keepN) {
    cut -= 1;
    const m = pending[cut];
    if (m && !isAppRow(m)) turns += 1;
  }
  if (turns < keepN) return { toSummarize: [], kept: pending };
  for (let prev = pending[cut - 1]; prev && isAppRow(prev); prev = pending[cut - 1]) cut -= 1;
  return { toSummarize: pending.slice(0, cut), kept: pending.slice(cut) };
}

/**
 * Where each exchange starts: the first row after one of her replies. An exchange is the context
 * injected for a message, the message, and her reply, so splitting on these never separates a turn
 * from its context or a question from its answer.
 */
function exchangeStarts(rows: ChatMessageRow[]): number[] {
  const starts: number[] = [];
  rows.forEach((m, i) => {
    if (i === 0 || (m.role !== 'assistant' && rows[i - 1]?.role === 'assistant')) starts.push(i);
  });
  return starts;
}

/**
 * Split by SIZE: keep the newest whole exchanges whose rows (injected ones included) add up to at
 * most `keepTailUnits`, and never fewer than the last two. What is summarized therefore ends on
 * her reply.
 */
export function splitTailByUnits(
  pending: ChatMessageRow[],
  keepTailUnits: number,
): { toSummarize: ChatMessageRow[]; kept: ChatMessageRow[] } {
  const starts = exchangeStarts(pending);
  let cut = pending.length;
  let units = 0;
  let exchanges = 0;
  for (const start of [...starts].reverse()) {
    const size = pending.slice(start, cut).reduce((sum, m) => sum + estimateTokenCount(m.content || ''), 0);
    if (exchanges >= MIN_TAIL_EXCHANGES && units + size > keepTailUnits) break;
    units += size;
    cut = start;
    exchanges += 1;
  }
  return { toSummarize: pending.slice(0, cut), kept: pending.slice(cut) };
}

interface TranscriptCut {
  transcript: string;
  /** Dialogue rows in the transcript. */
  summarizedRows: number;
  /** Index in the input of the last row the round covers (a dialogue row). */
  lastIndex: number;
  /** True when the budget, not the kept tail, ended the round. */
  budgetCut: boolean;
}

const line = (m: ChatMessageRow) => `${m.role}: ${m.content}`;

/**
 * The summarizer's `transcript`: dialogue rows in order, `role: content`, blank-line joined, up to
 * `budget` characters. Rows that don't fit stay after the mark for the next round. When the budget
 * cuts, the round ends on her last reply that fit, so a question is not summarized while its
 * answer stays verbatim. One row longer than the whole budget is shortened (and says so) rather
 * than blocking every round after it. Null when there is no dialogue at all.
 */
export function cutTranscript(
  rows: ChatMessageRow[],
  isAppRow: (m: ChatMessageRow) => boolean,
  budget: number = TRANSCRIPT_BUDGET_CHARS,
): TranscriptCut | null {
  const dialogue = rows.flatMap((m, i) => (isAppRow(m) ? [] : [{ i, m }]));
  const first = dialogue[0];
  if (!first) return null;
  let taken = 0;
  let length = 0;
  for (const { m } of dialogue) {
    const add = (taken ? 2 : 0) + line(m).length;
    if (length + add > budget) break;
    taken += 1;
    length += add;
  }
  if (taken === 0) {
    const text = line(first.m).slice(0, budget - CUT_MARK.length) + CUT_MARK;
    return { transcript: text, summarizedRows: 1, lastIndex: first.i, budgetCut: true };
  }
  const budgetCut = taken < dialogue.length;
  let kept = dialogue.slice(0, taken);
  if (budgetCut) {
    const lastReply = kept.map((d) => d.m.role).lastIndexOf('assistant');
    if (lastReply >= 0) kept = kept.slice(0, lastReply + 1);
  }
  return {
    transcript: kept.map((d) => line(d.m)).join('\n\n'),
    summarizedRows: kept.length,
    lastIndex: (kept[kept.length - 1] ?? first).i,
    budgetCut,
  };
}

/** What one compaction would do: the summarizer's input and where the mark moves to. */
export interface CompactionPlan {
  estimatedTokens: number;
  /** The summarizer's `transcript` variable: the dialogue rows, `role: content`, blank-line joined. */
  transcript: string;
  summarizedRows: number;
  droppedAppRows: number;
  /** The new `summary_through_at`. */
  through: string;
  /** Length of `transcript`; never more than `TRANSCRIPT_BUDGET_CHARS`. */
  transcriptChars: number;
  /** The budget ended this round; there is more to fold, and an after-reply run goes again. */
  budgetCut: boolean;
  /** How many units the request shrinks by once the round lands (before the new summary's size). */
  removedUnits: number;
}

/** Nothing to do this time, and why when it was close (`skipped` is for the log). */
export interface NoCompaction {
  estimatedTokens: number;
  transcript?: undefined;
  skipped?: string;
  /** The skip is a fault to look at, not a quiet day: the caller logs it as a warning. */
  loud?: true;
}

/**
 * The smallest fold worth running: the policy's `minRemovedUnits`, or a tenth of the trigger when
 * it names none. Never more than half the trigger. The guard only ever DELAYS a fold (everything
 * that ages out of the tail adds to what the next one would remove), and this cap bounds the delay,
 * so a mistyped minimum cannot let a session grow past ~1.5× its trigger plus the tail.
 */
export const minRemovedUnitsFor = (s: ResolvedSummarizer): number =>
  Math.min(s.minRemovedUnits ?? Math.round(s.triggerTokens / 10), Math.floor(s.triggerTokens / 2));

/**
 * Decide whether a history needs compacting and, if so, exactly what gets summarized. Pure — the
 * same function the live path and `eval-compaction.ts` run, so the eval measures what production
 * does. Returns `{ estimatedTokens }` alone when nothing is due, plus `skipped` when it was due
 * but not worth a fold.
 */
export function planCompaction(
  session: ChatSessionRow,
  messages: ChatMessageRow[],
  summarizer: ResolvedSummarizer,
  threshold: CompactionThreshold,
): CompactionPlan | NoCompaction {
  const sent = buildCompactedHistory(session, messages, summarizer);
  const estimatedTokens = estimateSessionTokens(session, sent);
  const limit = threshold === 'ceiling' ? summarizer.ceilingTokens : summarizer.triggerTokens;
  if (estimatedTokens < limit) return { estimatedTokens };

  // A summary the job could only read in part is never folded on: the cut would be silent.
  const summaryChars = (session.session_summary ?? '').length;
  if (summaryChars > SUMMARY_BUDGET_CHARS) {
    return {
      estimatedTokens,
      loud: true,
      skipped: `the summary is ${summaryChars} chars, over the ${SUMMARY_BUDGET_CHARS} the job can read; a fold would cut its last headings`,
    };
  }

  // Instructions, pinned rows and the summary row are held out: buildCompactedHistory re-attaches them.
  const isPinned = rowMatcher(summarizer.pinnedRowPattern);
  const pending = sent.filter((m) => !isInstruction(m) && !isPinned(m));
  const { toSummarize } = summarizer.keepTailUnits
    ? splitTailByUnits(pending, summarizer.keepTailUnits)
    : splitForCompaction(pending, summarizer.keepLastNTurns, summarizer.appRowPattern);
  if (!toSummarize.length) return { estimatedTokens, skipped: 'the kept tail is the whole conversation' };

  // App rows are dropped, not summarized (see `appRowPattern`); the round ends on a dialogue row.
  const isAppRow = rowMatcher(summarizer.appRowPattern);
  const cut = cutTranscript(toSummarize, isAppRow);
  if (!cut) return { estimatedTokens, skipped: 'no dialogue before the kept tail' };
  const covered = toSummarize.slice(0, cut.lastIndex + 1);
  const through = toSummarize[cut.lastIndex]?.created_at;
  if (!through) return { estimatedTokens };

  // Measure the request as it will be once the mark moves, so rows that survive (pinned, newest of
  // a source) are not counted as removed.
  const after = buildCompactedHistory(
    { ...session, session_summary: session.session_summary || ' ', summary_through_at: through },
    messages,
    summarizer,
  );
  const removedUnits = estimatedTokens - estimateSessionTokens(session, after);
  const minimum = minRemovedUnitsFor(summarizer);
  if (!cut.budgetCut && removedUnits < minimum) {
    return { estimatedTokens, skipped: `would remove ${removedUnits} units, under the ${minimum} minimum` };
  }
  return {
    estimatedTokens,
    transcript: cut.transcript,
    summarizedRows: cut.summarizedRows,
    droppedAppRows: covered.length - cut.summarizedRows,
    through,
    transcriptChars: cut.transcript.length,
    budgetCut: cut.budgetCut,
    removedUnits,
  };
}
