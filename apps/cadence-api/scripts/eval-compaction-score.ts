/**
 * The pure half of the compaction eval: turn a fixture into the rows a real coach session stores,
 * replay compaction over them with the engine's own `planCompaction`, and score what each summary
 * kept. No model and no network in here — `eval-compaction.ts` supplies the summarizer, the tests
 * supply a fake one.
 */
import { planCompaction, type ChatMessageRow, type ChatSessionRow } from '@ai-admin/core';
import type { CompactionFixture, FactKind, PlantedFact } from './eval-compaction-fixtures.ts';
import { composeConversation } from './eval-compaction-filler.ts';

/**
 * The engine cuts every job variable at this many characters and appends "... [truncated]"
 * (`MAX_VARIABLE_LENGTH` in backend/src/ai-manager/job-execution-utils.ts, not exported today).
 * Whatever a round's `transcript` holds past this point never reaches the summarizer. Switch to the
 * core export when one exists.
 */
export const JOB_VARIABLE_CAP = 10_000;

/** The policy shape `planCompaction` reads, with every default filled in. */
export interface EvalPolicy {
  jobSlug: string;
  triggerTokens: number;
  ceilingTokens: number;
  keepLastNTurns: number;
  appRowPattern?: string;
  pinnedRowPattern?: string;
}

const START = Date.parse('2026-10-01T08:00:00Z');

const INJECTED_LINE = '- a line of injected detail, standing in for the real block.\n';
/**
 * A `<context>` row of exactly `chars` characters (or the bare wrapper, if `chars` is smaller).
 * The real blocks: persona ~20k chars; dossier ~6k; capabilities + picks ~6.5k; per turn, whatever
 * `composeConversation` drew.
 */
export function injectedRow(source: string, label: string, chars: number): string {
  const open = `<context source="${source}" version="1" built_at="2026-10-01T08:00:00.000Z">\n${label}\n`;
  const close = '\n</context>';
  const room = Math.max(0, chars - open.length - close.length);
  return `${open}${INJECTED_LINE.repeat(Math.ceil(room / INJECTED_LINE.length)).slice(0, room)}${close}`;
}

export interface BuiltFixture {
  rows: ChatMessageRow[];
  /** created_at of each exchange's coach reply, by exchange index. */
  exchangeEnds: string[];
}

/**
 * One fixture as stored rows: the persona, the three blocks sent once per session, then for every
 * exchange a per-turn context row, the user's message and her reply — the shape the coach route
 * writes.
 */
export function buildFixtureRows(fixture: CompactionFixture, persona: string): BuiltFixture {
  let t = START;
  const rows: ChatMessageRow[] = [];
  const push = (role: string, content: string) =>
    rows.push({
      id: `r${rows.length}`,
      chat_session_id: fixture.id,
      role,
      content,
      created_at: new Date((t += 1000)).toISOString(),
    } as ChatMessageRow);

  push('system', persona);
  push('user', injectedRow('registry-pack', '== WHO THEY ARE ==', 6000));
  push('user', injectedRow('capabilities', '== WHAT YOU CAN DO ==', 4500));
  push('user', injectedRow('pick-protocol', '== QUICK PICKS ==', 2000));

  const exchangeEnds: string[] = [];
  for (const [i, turn] of composeConversation(fixture).entries()) {
    push(
      'user',
      injectedRow('turn-context', `[ctx:get_active_plan:${i.toString(16).padStart(8, '0')}]`, turn.contextChars),
    );
    push('user', turn.exchange.user);
    push('assistant', turn.exchange.coach);
    exchangeEnds.push(rows[rows.length - 1]!.created_at);
  }
  return { rows, exchangeEnds };
}

export interface CompactionRound {
  /** Exchange index after which this round fired. */
  afterExchange: number;
  estimatedTokens: number;
  summarizedRows: number;
  droppedAppRows: number;
  transcript: string;
  existingSummary: string;
  summary: string;
  through: string;
}

export type Summarize = (vars: { transcript: string; existingSummary: string }) => Promise<string>;

/**
 * Play the conversation forward one exchange at a time and compact whenever production would —
 * after her reply, at the trigger — exactly as `compactSessionAfterReply` does.
 */
export async function replayCompaction(
  built: BuiltFixture,
  policy: EvalPolicy,
  summarize: Summarize,
): Promise<{ rounds: CompactionRound[]; session: ChatSessionRow }> {
  const session = {
    id: 'eval',
    workspace_id: 'eval',
    session_summary: null,
    summary_through_at: null,
  } as unknown as ChatSessionRow;
  const rounds: CompactionRound[] = [];
  for (let i = 0; i < built.exchangeEnds.length; i++) {
    const end = Date.parse(built.exchangeEnds[i]!);
    const soFar = built.rows.filter((r) => Date.parse(r.created_at) <= end);
    const plan = planCompaction(session, soFar, policy, 'trigger');
    if (plan.transcript === undefined) continue;
    const existingSummary = session.session_summary ?? '';
    const summary = await summarize({ transcript: plan.transcript, existingSummary });
    rounds.push({ afterExchange: i, ...plan, existingSummary, summary });
    session.session_summary = summary;
    session.summary_through_at = plan.through;
  }
  return { rounds, session };
}

export interface FactResult {
  id: string;
  kind: FactKind;
  probe: string;
  kept: boolean;
  /** The `expect` groups with no term present. */
  missing: string[][];
  /** Corrections: sentences that state the replaced value without the new one (see `scoreFact`). */
  stale: string[];
  /** Which round first summarized it. */
  round: number;
}

/** Facts whose planting fell behind the final mark — the ones only the summary can still carry. */
export function compactedFacts(
  fixture: CompactionFixture,
  built: BuiltFixture,
  rounds: CompactionRound[],
): Array<PlantedFact & { round: number }> {
  const out: Array<PlantedFact & { round: number }> = [];
  for (const f of fixture.facts) {
    const plantedAt = Date.parse(built.exchangeEnds[f.at]!);
    const round = rounds.findIndex((r) => Date.parse(r.through) >= plantedAt);
    if (round >= 0) out.push({ ...f, round: round + 1 });
  }
  return out;
}

/**
 * Where a summary's sentences end: after . ! or ? (and any closing quote or bracket) followed by a
 * space and a capital letter or an opening quote or bracket, and at every line break. Never before
 * a digit or a lower-case letter, so "Oct. 12", "Gymnopédie No. 1" and "6 a.m. and" stay whole.
 */
export const SENTENCE_BREAK = /(?<=[.!?]["'”’)]?)\s+(?=[\p{Lu}"'“‘(])|\n+/u;
export const sentences = (text: string): string[] =>
  text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter(Boolean);

const hasAny = (text: string, terms: readonly string[]) => terms.some((t) => text.includes(t.toLowerCase()));

/**
 * Is the fact kept? Every `expect` group needs one of its terms somewhere in the summary
 * (case-insensitive) — and a correction must not still state the value it replaced.
 *
 * THE CORRECTION RULE (P3b, 2026-10-31). A correction fails when a sentence of the summary names
 * the replaced value (`mustNotContain`) WITHOUT the new one (a term from every `expect` group). The
 * replaced value is allowed only in a sentence that also holds the new value: "the race moved from
 * October 12 to November 2" records the change, which is honest and worth keeping. A sentence that
 * names only the old value reads as current — "Race day is October 12th." — and she would believe
 * it. Strict on purpose: "They learn Satie now. They dropped the Chopin." fails, because its second
 * sentence names the old piece alone. "Allowed wherever the new value also appears in the summary"
 * would never fail anything — a kept correction always holds the new value — so the scope is the
 * sentence. The report quotes the offending sentence, so a reader can overrule the call.
 */
export function scoreFact(summary: string, fact: PlantedFact & { round: number }): FactResult {
  const text = summary.toLowerCase();
  const missing = fact.expect.filter((group) => !hasAny(text, group));
  const old = fact.mustNotContain ?? [];
  const stale = old.length
    ? sentences(summary).filter((s) => {
        const lower = s.toLowerCase();
        return hasAny(lower, old) && !fact.expect.every((group) => hasAny(lower, group));
      })
    : [];
  return {
    id: fact.id,
    kind: fact.kind,
    probe: fact.probe,
    kept: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    round: fact.round,
  };
}

/** Where a fact's planted exchange sits in the transcript of the round that first summarized it. */
export interface PlantSpan {
  /** Offset of "user: <their message>". */
  start: number;
  /** Offset just past her reply. */
  end: number;
  transcriptChars: number;
}

export function plantSpan(fact: PlantedFact & { round: number }, rounds: CompactionRound[]): PlantSpan | null {
  const transcript = rounds[fact.round - 1]?.transcript;
  if (!transcript) return null;
  const start = transcript.indexOf(`user: ${fact.plant.user}`);
  if (start < 0) return null;
  const reply = `assistant: ${fact.plant.coach}`;
  const at = transcript.indexOf(reply, start);
  const end = at < 0 ? start + fact.plant.user.length + 6 : at + reply.length;
  return { start, end, transcriptChars: transcript.length };
}

/** Text that should never reach a summary now that injected rows are dropped (HARNESS-V3 C2). */
export function leaks(summary: string): string[] {
  return ['<context', '[ctx:', 'source="', 'injected detail'].filter((s) => summary.includes(s));
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
