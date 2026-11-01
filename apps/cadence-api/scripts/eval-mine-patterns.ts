/**
 * The failure shapes `mine-eval-candidates.ts` looks for in real coach turns (HARNESS-V3 C5.1),
 * kept here as pure functions so every pattern that decides what gets flagged has a table test of
 * positives and near-misses (`eval-mine-patterns.test.ts`).
 *
 * A flag is a reason to read a turn, never a verdict. The owner or an agent reads each candidate
 * and decides whether it becomes a case; nothing here writes one.
 *
 * Four shapes:
 *   - promised a change, called no action: her reply says "I've updated", "I'll move", "changed
 *     your …" and no action tool ran that turn. The 2026-08-16 failure.
 *   - a tool reported a fault: a tool output carries `toolFaultText`'s wording, so she was told
 *     a read broke. Worth checking what she said about it.
 *   - they corrected her next: the person's next message in the same conversation starts "no, …"
 *     or says "that's not", "I said", "I meant", "wrong".
 *   - slow: the turn took over 120 seconds.
 */
import { toolFaultText } from '../src/services/tool-response.ts';

export type Shape = 'promised-no-action' | 'tool-fault' | 'corrected-next' | 'slow';

/** Plain labels for the review file. */
export const SHAPE_LABEL: Record<Shape, string> = {
  'promised-no-action': 'promised a change, called no action',
  'tool-fault': 'a tool reported a fault',
  'corrected-next': 'they corrected her in their next message',
  slow: 'took over 120 s',
};

export const SLOW_TURN_MS = 120_000;

/* ── (a) promised a change ─────────────────────────────────────────────────────────────────── */

const APOS = "(?:'|’)?";
/** Her, saying she has done or is about to do something. "I can" and "want me to" are offers. */
const SUBJECT = `(?:i${APOS}ve|i have|i${APOS}ll|i will|i${APOS}m(?: going to)?|i am(?: going to)?|let me)`;
const FILLER = '(?:(?:just|now|also|already|quickly|gone ahead and|go ahead and|went ahead and)\\s+)*';
/**
 * The verbs of a change, each in the forms she uses. The lookaheads drop idioms that use the same
 * verb for something that changes nothing: "move on to", "update you", "change the subject",
 * "add one more thing", "log off", "push you" (harder, in training).
 */
const VERB =
  '(?:' +
  [
    'updat(?:e|ed|ing)(?!\\s+you\\b)',
    'chang(?:e|ed|ing)(?!\\s+(?:the subject|gears|tack)\\b)',
    'mov(?:e|ed|ing)(?!\\s+on\\b)',
    'log(?:ged|ging)?(?!\\s+(?:off|out|in)\\b)',
    'swap(?:ped|ping)?',
    'adjust(?:ed|ing)?',
    'add(?:ed|ing)?(?!\\s+(?:one|a|another)\\s+(?:more\\s+)?(?:thing|thought|point|note)\\b)',
    'remov(?:e|ed|ing)',
    'drop(?:ped|ping)?',
    'push(?:ed|ing)?(?!\\s+(?:you|yourself)\\b)',
    'shift(?:ed|ing)?',
    'record(?:ed|ing)?',
    'mark(?:ed|ing)?',
    'delet(?:e|ed|ing)',
    'cancel(?:l?ed|l?ing)?',
    'reschedul(?:e|ed|ing)',
    'set(?:ting)?',
  ].join('|') +
  ')';
const PROMISE = new RegExp(`\\b${SUBJECT}\\s+${FILLER}${VERB}\\b`, 'i');
/** "Changed your long run to Saturday." — the same claim with the "I've" left off. */
const CHANGED_YOUR = new RegExp(
  '(?:^|[.!?:\\n—–-]\\s*|\\bdone[,.!:—–-]*\\s*)' +
    '(?:changed|moved|updated|logged|swapped|adjusted|removed|dropped|shifted|rescheduled)\\s+your\\b',
  'i',
);

export function promisesChange(reply: string): boolean {
  return PROMISE.test(reply) || CHANGED_YOUR.test(reply);
}

/* ── (b) a tool reported a fault ───────────────────────────────────────────────────────────── */

/**
 * The fixed part of `toolFaultText`, taken from the function itself rather than copied, so a
 * rewording there is followed here. The text opens with a variable subject ("That", "Your food
 * log"), so the match is on what follows it, up to the end of the first sentence.
 */
const MARK = '\u0000';
export const FAULT_WORDING = toolFaultText(MARK).split(MARK)[1]!.split('.')[0]!.trim();

export function isFaultOutput(output: string | null | undefined): boolean {
  return !!output && !!FAULT_WORDING && output.includes(FAULT_WORDING);
}

/* ── (c) they corrected her ────────────────────────────────────────────────────────────────── */

const LEADING_NO = /^\s*(?:no|nope|nah)\b([\s,.!—–-]*)([^\s,.!?]*)/i;
/** "no thanks", "no worries": a leading no that answers an offer, not a correction. */
const NOT_A_CORRECTION_AFTER_NO = new Set([
  'problem',
  'problems',
  'worries',
  'worry',
  'thanks',
  'thank',
  'rush',
  'need',
  'pressure',
  'biggie',
  'stress',
  'idea',
]);
/** Without punctuation, "no" is only a correction when what follows is a claim ("no it was…"). */
const CORRECTING_AFTER_BARE_NO = new Set([
  'i',
  'it',
  "it's",
  'its',
  'that',
  "that's",
  'thats',
  'you',
  'not',
  'the',
  'we',
  'my',
  'actually',
]);

function leadingNo(text: string): boolean {
  const m = LEADING_NO.exec(text);
  if (!m) return false;
  const next = (m[2] ?? '').toLowerCase().replace(/’/g, "'");
  if (!next) return false; // a bare "no" answers a question she asked
  if (NOT_A_CORRECTION_AFTER_NO.has(next)) return false;
  return /[,.!—–-]/.test(m[1] ?? '') || CORRECTING_AFTER_BARE_NO.has(next);
}

const NOT_A_CORRECTION_AFTER_THATS_NOT =
  '(?:bad|too bad|so bad|a problem|an issue|a big deal|terrible|awful|ideal|easy|a bad idea|something)';
const CORRECTION_PHRASES: RegExp[] = [
  new RegExp(`\\bthat(?:${APOS}s| is) not\\b(?!\\s+${NOT_A_CORRECTION_AFTER_THATS_NOT}\\b)`, 'i'),
  // "I said to my wife" and "I said I'd" report something; "I said Tuesday" corrects her.
  new RegExp(
    `\\bi (?:said|told you)\\b(?!\\s+(?:to\\b|that i\\b|i${APOS}d\\b|i would\\b|i${APOS}ll\\b|i was going\\b))`,
    'i',
  ),
  /\bi meant\b(?!\s+to\b)/i,
  new RegExp(`\\bi (?:didn${APOS}t|did not|never) (?:say|said|mean|ask)\\b`, 'i'),
  /\bnot what i (?:said|meant|asked)\b/i,
  new RegExp(
    `\\b(?:that${APOS}s|that is|it${APOS}s|you${APOS}re|you are|you got (?:it|that)|you have (?:it|that))\\s+` +
      '(?:all\\s+|completely\\s+|totally\\s+)?wrong\\b',
    'i',
  ),
  /\bwrong (?:day|date|session|run|meal|one|number|time|goal|week|workout|food|amount)\b/i,
];

export function correctsHer(nextMessage: string | null | undefined): boolean {
  if (!nextMessage) return false;
  return leadingNo(nextMessage) || CORRECTION_PHRASES.some((p) => p.test(nextMessage));
}

/* ── turns and candidates ──────────────────────────────────────────────────────────────────── */

/** One tool call she made in a turn, by the tool's own name, with what it handed back. */
export interface ToolUse {
  name: string;
  output: string | null;
}

/** One coach turn as read back from the logs. */
export interface MinedTurn {
  sessionId: string;
  /** When the turn's log row was written: the end of the turn. */
  at: string;
  userId: string;
  user: string;
  reply: string;
  ms: number | null;
  tools: ToolUse[];
}

export interface Candidate {
  turn: MinedTurn;
  shapes: Shape[];
  /** The person's next message in the same conversation, when there is one. */
  next: string | null;
  /** Tools whose output carried the fault wording. */
  faulted: string[];
}

/** App-authored turns ride the same path as hers; they are not the person talking. */
const APP_AUTHORED = /^\s*<(?:note|context)\b/i;

/**
 * Flag every turn that matches a shape. Turns are grouped by conversation and read in time order,
 * so "their next message" is the next turn of the same conversation and never another one's.
 */
export function findCandidates(turns: MinedTurn[], isAction: (name: string) => boolean): Candidate[] {
  const bySession = new Map<string, MinedTurn[]>();
  for (const t of turns) {
    if (APP_AUTHORED.test(t.user)) continue;
    const list = bySession.get(t.sessionId) ?? [];
    list.push(t);
    bySession.set(t.sessionId, list);
  }
  const out: Candidate[] = [];
  for (const list of bySession.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    list.forEach((turn, i) => {
      const next = list[i + 1]?.user ?? null;
      const faulted = turn.tools.filter((t) => isFaultOutput(t.output)).map((t) => t.name);
      const shapes: Shape[] = [];
      if (promisesChange(turn.reply) && !turn.tools.some((t) => isAction(t.name))) shapes.push('promised-no-action');
      if (faulted.length) shapes.push('tool-fault');
      if (correctsHer(next)) shapes.push('corrected-next');
      if (turn.ms !== null && turn.ms > SLOW_TURN_MS) shapes.push('slow');
      if (shapes.length) out.push({ turn, shapes, next, faulted });
    });
  }
  return out.sort((a, b) => a.turn.at.localeCompare(b.turn.at));
}

/* ── reading the tool log ──────────────────────────────────────────────────────────────────── */

interface LoggedCall {
  name?: unknown;
  arguments?: unknown;
}
interface LoggedResult {
  name?: unknown;
  output?: unknown;
}

/** `use_tool` runs another tool; the name worth reporting is the one it ran. */
function innerName(call: LoggedCall): string {
  const name = String(call.name ?? 'unknown');
  if (name !== 'use_tool') return name;
  try {
    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
    const inner = (args as { name?: unknown } | null)?.name;
    return typeof inner === 'string' && inner.trim() ? inner.trim() : name;
  } catch {
    return name;
  }
}

/**
 * One `coach_tool` row of `cadence.ai_log` → the tools it records. The row keeps the calls and the
 * results as two lists in different orders (actions run before reads), so each result is paired
 * with the next unused call of the same name, which keeps same-named calls in the order they ran.
 */
export function pairToolLog(input: unknown, output: unknown): ToolUse[] {
  const calls = ((input as { calls?: LoggedCall[] } | null)?.calls ?? []).slice();
  const results = (output as { results?: LoggedResult[] } | null)?.results ?? [];
  const used = new Set<number>();
  const uses: ToolUse[] = results.map((r) => {
    const name = String(r.name ?? 'unknown');
    const i = calls.findIndex((c, k) => !used.has(k) && String(c.name ?? '') === name);
    if (i >= 0) used.add(i);
    return { name: i >= 0 ? innerName(calls[i]!) : name, output: typeof r.output === 'string' ? r.output : null };
  });
  // A call with no result (an unknown name is logged that way) still happened.
  calls.forEach((c, k) => {
    if (!used.has(k)) uses.push({ name: innerName(c), output: null });
  });
  return uses;
}

/** A `coach_tool` row: whose turn it belongs to is known only by user and time. */
export interface ToolLogRow {
  userId: string;
  at: string;
  input: unknown;
  output: unknown;
}

/** Slack either side of a turn's window, for the two databases' clocks and the log writes. */
const JOIN_SLACK_MS = 5_000;

/**
 * Give each turn the tool rows written during it: same person, written between the turn's start
 * (its end minus its duration) and its end. Tool rows carry no conversation id, so this join is by
 * time; one person rarely has two turns in flight at once.
 */
export function attachTools(turns: MinedTurn[], rows: ToolLogRow[]): MinedTurn[] {
  return turns.map((t) => {
    const end = Date.parse(t.at);
    const start = end - (t.ms ?? 0);
    const mine = rows.filter((r) => {
      const at = Date.parse(r.at);
      return r.userId === t.userId && at >= start - JOIN_SLACK_MS && at <= end + JOIN_SLACK_MS;
    });
    return { ...t, tools: mine.flatMap((r) => pairToolLog(r.input, r.output)) };
  });
}
