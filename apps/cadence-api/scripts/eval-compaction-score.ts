/**
 * The pure half of the compaction eval: turn a fixture into the rows a real coach session stores,
 * replay compaction over them with the engine's own `planCompaction`, and score what each summary
 * kept. No model and no network in here — `eval-compaction.ts` supplies the summarizer, the tests
 * supply a fake one.
 */
import { planCompaction, type ChatMessageRow, type ChatSessionRow } from '@ai-admin/core';
import type { CompactionFixture, Exchange, FactKind, PlantedFact } from './eval-compaction-fixtures.ts';

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

/** Sized like the real blocks (persona ~20k chars; capabilities + picks ~6.5k; per-turn ~3k). */
const pad = (label: string, chars: number) =>
  `${label}\n${'- a line of injected detail, standing in for the real block.\n'.repeat(Math.ceil(chars / 60))}`;
const wrap = (source: string, body: string) =>
  `<context source="${source}" version="1" built_at="2026-10-01T08:00:00.000Z">\n${body}\n</context>`;

export interface BuiltFixture {
  rows: ChatMessageRow[];
  /** created_at of each exchange's coach reply, by exchange index. */
  exchangeEnds: string[];
}

/**
 * One fixture as stored rows: the persona, the three blocks sent once per session, then for every
 * exchange a per-turn context row, the user's message and her reply — the shape the coach route
 * writes. A planted fact (or the earlier statement a correction overrides) takes its exchange's
 * slot; filler fills the rest.
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
  push('user', wrap('registry-pack', pad('== WHO THEY ARE ==', 6000)));
  push('user', wrap('capabilities', pad('== WHAT YOU CAN DO ==', 4500)));
  push('user', wrap('pick-protocol', pad('== QUICK PICKS ==', 2000)));

  const planted = new Map<number, Exchange>();
  for (const f of fixture.facts) {
    planted.set(f.at, f.plant);
    if (f.before) planted.set(f.before.at, f.before);
  }
  const exchangeEnds: string[] = [];
  let fillerIndex = 0;
  for (let i = 0; i < fixture.exchanges; i++) {
    const ex = planted.get(i) ?? fixture.filler[fillerIndex++ % fixture.filler.length]!;
    push('user', wrap('turn-context', pad(`[ctx:get_active_plan:${i.toString(16).padStart(8, '0')}]`, 3000)));
    push('user', ex.user.replace('{n}', String(i + 1)));
    push('assistant', ex.coach.replace('{n}', String(i + 1)));
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

/** Does every `expect` group have one of its terms in the summary? */
export function scoreFact(summary: string, fact: PlantedFact & { round: number }): FactResult {
  const text = summary.toLowerCase();
  const missing = fact.expect.filter((group) => !group.some((term) => text.includes(term.toLowerCase())));
  return { id: fact.id, kind: fact.kind, probe: fact.probe, kept: missing.length === 0, missing, round: fact.round };
}

/** Text that should never reach a summary now that injected rows are dropped (HARNESS-V3 C2). */
export function leaks(summary: string): string[] {
  return ['<context', '[ctx:', 'source="', 'injected detail'].filter((s) => summary.includes(s));
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
