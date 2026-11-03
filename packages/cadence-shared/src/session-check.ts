/**
 * The session checker (walkthrough v3, Phase 3a). It reads a normalized session and returns
 * findings: facts about steps the app cannot play as written, or shapes it is not sure of. It
 * changes nothing. The findings go back to the coach as facts (the repair loop in the API,
 * session-repair.ts) and she decides — never a regex that rewrites her session.
 *
 * Why it exists: the owner's 2026-11-02 gym session held a farmer carry stored as `tool: "reps"`,
 * sets 4, reps 1, with the 40–45 seconds only in the cue text, so it played as a "1 rep" dial. An
 * audit of 1,319 stored items found about nine like it, every one a timed effort done in sets.
 *
 * Severity is a fact about the app, not a verdict about the coaching: an `error` is a step the
 * app cannot play as written (a timer with no time), a `question` is a shape that may be right
 * (one rep in several sets is a carry written as reps — or a single max-effort set written
 * oddly). A tempo cue on a rep count ("pause 2 seconds at the top") is neither: more than twenty
 * stored items mention seconds only to pace each rep, which is why time in a reps item's cue is at
 * most a question and never an error.
 *
 * Every rule is a router that fails silently when wrong, so each one lands with a table of
 * positives AND near-misses (session-check.test.ts) — the near-misses are the real shapes from the
 * stored data that must produce NO finding.
 */
import type { OccurrenceSession, SessionBlock, SessionItem } from './types/occurrence.ts';
import { BLOCK_LABEL_MAX, ITEM_DETAIL_MAX, ITEM_LOAD_MAX, ITEM_NAME_MAX } from './session-limits.ts';

export type SessionCheckRule =
  /** A timer step with no `duration_min`: the app plays it as one minute, which nobody asked for. */
  | 'timer_no_time'
  /** `reps` ≤ 1 with `sets` ≥ 2: the shape every stored carry, hang and hold-in-sets was written in. */
  | 'one_rep_sets'
  /** A check-off (confirmed once) whose name or cue counts walks, sets, rounds, trips or carries. */
  | 'checkoff_counts'
  /** `reps` with no `sets` outside a circuit: the app plays one set, which may not be what was meant. */
  | 'reps_no_sets'
  /** A circuit block with no `rounds`: the app falls back to the largest `sets` on its items. */
  | 'circuit_no_rounds'
  /** Text past the limit the app stores, or ending with the "…" it leaves when it cuts. */
  | 'text_cut';

export type SessionCheckSeverity = 'error' | 'question';

export interface SessionFinding {
  rule: SessionCheckRule;
  blockIndex: number;
  /** null when the finding is about the block itself (a circuit with no rounds, a long label). */
  itemIndex: number | null;
  /** The item's name — or the block's label for a block finding. */
  item: string;
  severity: SessionCheckSeverity;
  /** One plain sentence of evidence, written for the coach, naming the step. */
  fact: string;
}

/** A session, or just its blocks — the checker reads nothing else. */
export type CheckableSession = Pick<OccurrenceSession, 'blocks'>;

/**
 * A length written in a cue: "40-45 seconds of walking", "20 sec each arm", "about 20 s". The
 * number, its unit, and up to three words after it (stopping before "and", "or", "then"), so the
 * fact quotes what she wrote.
 */
const TIME_PHRASE =
  /\b\d+(?:\s*(?:-|–|to)\s*\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b(?:\s+(?!(?:and|or|then|but|so)\b)[a-z'’-]+){0,3}/i;

/**
 * A count of efforts in a check-off's words: "3 carries", "2 sets", "3 short trips", "four
 * rounds". One effort ("one set") is not a count the app would need to play.
 */
const COUNT_PHRASE =
  /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)(?:\s+\w+)?\s+(?:walks?|sets?|rounds?|trips?|carries|laps?)\b/i;

export function timePhraseIn(text: string | undefined): string | null {
  const m = text ? TIME_PHRASE.exec(text) : null;
  return m ? m[0].trim() : null;
}

export function countPhraseIn(text: string | undefined): string | null {
  const m = text ? COUNT_PHRASE.exec(text) : null;
  return m ? m[0].trim() : null;
}

const positive = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** "; its detail says '40-45 seconds of walking'" — or the honest absence. */
function cueTimeClause(item: SessionItem): string {
  const phrase = timePhraseIn(item.detail);
  return phrase ? `; its detail says '${phrase}'` : '; its detail names no time';
}

/**
 * How far under the limit a text that ends with "…" still counts as cut by the app. The
 * normalizer cuts at the last word boundary that fits, so a cut text is always within one word
 * of the limit; sixty characters covers any real word.
 */
const CUT_SLACK = 60;

function textFinding(
  where: { blockIndex: number; itemIndex: number | null; item: string; label: string },
  field: string,
  text: string | undefined,
  max: number,
): SessionFinding | null {
  if (!text) return null;
  const base = {
    rule: 'text_cut' as const,
    blockIndex: where.blockIndex,
    itemIndex: where.itemIndex,
    item: where.item,
  };
  if (text.length > max) {
    return {
      ...base,
      severity: 'error',
      fact: `${where.label}: its ${field} is ${text.length} characters; the app keeps ${max} and cuts the rest at a word.`,
    };
  }
  if (text.endsWith('…') && text.length >= max - CUT_SLACK) {
    return {
      ...base,
      severity: 'question',
      fact: `${where.label}: its ${field} ends with '…' at ${text.length} characters, the mark the app leaves when it cuts text at ${max}.`,
    };
  }
  return null;
}

function checkItem(block: SessionBlock, blockIndex: number, item: SessionItem, itemIndex: number): SessionFinding[] {
  const label = `block ${blockIndex + 1} item ${itemIndex + 1} '${item.name}'`;
  const at = { blockIndex, itemIndex, item: item.name };
  const out: SessionFinding[] = [];
  const sets = positive(item.sets) ? item.sets : undefined;
  const reps = typeof item.reps === 'number' && Number.isFinite(item.reps) ? item.reps : undefined;
  const tool = item.tool ?? 'unset';

  if (item.tool === 'timer' && !positive(item.duration_min)) {
    out.push({
      ...at,
      rule: 'timer_no_time',
      severity: 'error',
      fact: `${label}: tool timer with no duration_min${sets ? `, sets ${sets}` : ''}, so the app plays one minute${cueTimeClause(item)}.`,
    });
  }

  if (reps !== undefined && reps <= 1 && sets !== undefined && sets >= 2) {
    out.push({
      ...at,
      rule: 'one_rep_sets',
      severity: 'question',
      fact: `${label}: tool ${tool}, reps ${reps}, sets ${sets}${cueTimeClause(item)}.`,
    });
  }

  if (item.tool === 'checkoff') {
    const inName = countPhraseIn(item.name);
    const inDetail = inName ? null : countPhraseIn(item.detail);
    if (sets !== undefined && sets >= 2) {
      out.push({
        ...at,
        rule: 'checkoff_counts',
        severity: 'question',
        fact: `${label}: tool checkoff, which the app confirms once, with sets ${sets}${inName || inDetail ? `; its ${inName ? 'name' : 'detail'} says '${inName ?? inDetail}'` : ''}.`,
      });
    } else if (inName || inDetail) {
      out.push({
        ...at,
        rule: 'checkoff_counts',
        severity: 'question',
        fact: `${label}: tool checkoff, which the app confirms once; its ${inName ? 'name' : 'detail'} says '${inName ?? inDetail}'.`,
      });
    }
  }

  if (reps !== undefined && sets === undefined && block.mode !== 'circuit') {
    out.push({
      ...at,
      rule: 'reps_no_sets',
      severity: 'question',
      fact: `${label}: reps ${reps} with no sets, in a ${block.mode ?? 'straight'} block, so the app plays one set.`,
    });
  }

  const where = { ...at, label };
  for (const f of [
    textFinding(where, 'name', item.name, ITEM_NAME_MAX),
    textFinding(where, 'load', item.load, ITEM_LOAD_MAX),
    textFinding(where, 'detail', item.detail, ITEM_DETAIL_MAX),
  ]) {
    if (f) out.push(f);
  }
  return out;
}

function checkBlock(block: SessionBlock, blockIndex: number): SessionFinding[] {
  const out: SessionFinding[] = [];
  const label = `block ${blockIndex + 1} '${block.label}'`;
  if (block.mode === 'circuit' && !positive(block.rounds)) {
    const maxSets = block.items.reduce((m, i) => Math.max(m, positive(i.sets) ? i.sets : 1), 1);
    out.push({
      rule: 'circuit_no_rounds',
      blockIndex,
      itemIndex: null,
      item: block.label,
      severity: 'error',
      fact: `${label}: mode circuit with no rounds, so the app plays ${maxSets} round${maxSets === 1 ? '' : 's'}, the largest sets count on its items.`,
    });
  }
  const cut = textFinding(
    { blockIndex, itemIndex: null, item: block.label, label },
    'label',
    block.label,
    BLOCK_LABEL_MAX,
  );
  if (cut) out.push(cut);
  block.items.forEach((item, itemIndex) => out.push(...checkItem(block, blockIndex, item, itemIndex)));
  return out;
}

/** Every finding in the session, in block then item order. An empty list means it is clean. */
export function checkSession(session: CheckableSession): SessionFinding[] {
  return (session.blocks ?? []).flatMap((block, blockIndex) => checkBlock(block, blockIndex));
}

/**
 * The findings as the `check_findings` prompt variable carries them: one line each, the
 * severity in front as the fact about the app it is. Empty findings render as an empty string,
 * which the template ignores.
 */
export function renderCheckFindings(findings: readonly SessionFinding[]): string {
  return findings.map((f) => `- (${f.severity}) ${f.fact}`).join('\n');
}
