/**
 * HARNESS-V3 P1b, findings A and B, on production-sized rows (test/helpers/compaction-sim.ts).
 *
 * A. `interpolateTemplate` keeps only the first 10,000 characters of a job variable, but the mark
 *    moved past the whole round. With real sizes a round is ~27 exchanges (~15k chars of dialogue),
 *    so ~10 exchanges a round were neither summarized nor ever sent again.
 * B. Nothing stopped a compaction on every message: with 12.5k-char injected rows a 20-turn tail
 *    is itself at the trigger, so each new exchange folded one more (50 runs in 60 exchanges).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionRow, ChatMessageRow } from '../src/types.ts';
import { MAX_VARIABLE_LENGTH } from '../src/ai-manager/job-execution-utils.ts';
import {
  LIVE_POLICY,
  TURN_POLICY,
  SIZES,
  block,
  markerOf,
  rowFactory,
  said,
  type Sizes,
} from './helpers/compaction-sim.ts';

const db = vi.hoisted(() => ({ rows: [] as ChatMessageRow[], session: null as ChatSessionRow | null }));
const executeJob = vi.hoisted(() => vi.fn());

vi.mock('../src/models/chat-sessions.ts', () => ({
  listChatMessages: vi.fn(async () => db.rows),
  getChatSession: vi.fn(async () => db.session),
  updateChatSessionIfMarkUnchanged: vi.fn(
    async (_id: string, updates: Partial<ChatSessionRow>, expectedMark: string | null) => {
      if ((db.session?.summary_through_at ?? null) !== expectedMark) return null;
      db.session = { ...(db.session as ChatSessionRow), ...updates };
      return db.session;
    },
  ),
}));
vi.mock('../src/models/processing-jobs.ts', () => ({
  getProcessingJobBySlug: vi.fn(async (slug: string) => ({ id: 'job', slug })),
}));
vi.mock('../src/ai-manager/index.ts', () => ({ executeJob }));

const {
  maybeCompactSession,
  compactSessionAfterReply,
  buildCompactedHistory,
  estimateSessionTokens,
  getSummarizerConfig,
  cutTranscript,
  TRANSCRIPT_BUDGET_CHARS,
  AFTER_REPLY_MAX_ROUNDS,
} = await import('../src/services/session-compaction.ts');

const session = () => db.session as ChatSessionRow;
const sentUnits = () =>
  estimateSessionTokens(session(), buildCompactedHistory(session(), db.rows, getSummarizerConfig(session())));

interface Run {
  transcript: string;
  compaction: { budgetCut: boolean; removedUnits: number; transcriptChars: number; summarizedRows: number };
}
const runs = (): Run[] =>
  executeJob.mock.calls.map((c) => ({
    transcript: (c[1].variables as { transcript: string }).transcript,
    compaction: (c[1].diagnostics as { metadata: { compaction: Run['compaction'] } }).metadata.compaction,
  }));

/** Persona + the two once-per-session blocks, like a real coach session at open. */
function openSession(policy: object) {
  const row = rowFactory();
  db.session = { id: 's1', config: { summarizer: policy }, workspace_id: 'w' } as unknown as ChatSessionRow;
  db.rows = [row('system', 'P'.repeat(20_000)), row('user', block('registry-pack', 6_000))];
  db.rows.push(row('user', block('capabilities', 6_500)));
  return row;
}

/**
 * Play a conversation the way the coach route does: context + message, the pre-send ceiling check,
 * her reply, then the after-reply run. `afterReply: false` lets a backlog build up.
 */
async function play(o: { policy: object; exchanges: number; sizes: Sizes; afterReply?: boolean }) {
  const row = openSession(o.policy);
  const atSend: number[] = [];
  for (let i = 0; i < o.exchanges; i++) {
    db.rows.push(row('user', block('turn-context', o.sizes.context)), row('user', said(`U${i}`, o.sizes.user)));
    if (o.afterReply !== false) await maybeCompactSession(session(), 'test', 'ceiling');
    atSend.push(sentUnits());
    db.rows.push(row('assistant', said(`A${i}`, o.sizes.reply)));
    if (o.afterReply !== false) await compactSessionAfterReply('s1', 'test');
  }
  return { atSend, row };
}

/**
 * Every dialogue row is in exactly one transcript AS THE SUMMARIZER READS IT (the variable cap
 * applied), or still after the mark — never neither.
 */
function expectNothingFallsBetween() {
  const mark = Date.parse(session().summary_through_at ?? '1970-01-01T00:00:00Z');
  const transcripts = runs().map((r) => r.transcript.slice(0, MAX_VARIABLE_LENGTH));
  for (const m of db.rows.filter((r) => /^[UA]\d+ /.test(r.content))) {
    const seen = transcripts.filter((t) => t.includes(`${m.role}: ${markerOf(m)} `)).length;
    const afterMark = Date.parse(m.created_at) > mark;
    expect({ row: markerOf(m), seen, afterMark }).toEqual({ row: markerOf(m), seen: afterMark ? 0 : 1, afterMark });
  }
}

beforeEach(() => {
  executeJob.mockReset().mockImplementation(async () => ({ formatted: 'S'.repeat(1_500) }));
});

describe('A: a round never hands the summarizer more than it can read', () => {
  it.each([
    ['the turn-counted policy the audit measured', TURN_POLICY],
    ['the live policy', LIVE_POLICY],
  ])('%s: every row is summarized once or still after the mark', async (_name, policy) => {
    await play({ policy, exchanges: 90, sizes: SIZES.avg });

    expect(runs().length).toBeGreaterThan(1);
    expect(runs().some((r) => r.compaction.budgetCut)).toBe(true);
    for (const r of runs()) expect(r.transcript.length).toBeLessThanOrEqual(TRANSCRIPT_BUDGET_CHARS);
    expectNothingFallsBetween();
  });

  it('the fold is the measured 9,900 and never more than the engine reads', () => {
    expect(TRANSCRIPT_BUDGET_CHARS).toBe(9_900);
    expect(TRANSCRIPT_BUDGET_CHARS).toBeLessThanOrEqual(MAX_VARIABLE_LENGTH - 100);
  });

  it(`after a reply, a backlog catches up ${AFTER_REPLY_MAX_ROUNDS} rounds at a time`, async () => {
    await play({ policy: LIVE_POLICY, exchanges: 110, sizes: SIZES.avg, afterReply: false });

    await compactSessionAfterReply('s1', 'test');
    expect(runs()).toHaveLength(AFTER_REPLY_MAX_ROUNDS);
    expect(runs().every((r) => r.compaction.budgetCut)).toBe(true);
    expectNothingFallsBetween();

    await compactSessionAfterReply('s1', 'test'); // the next reply carries on where it stopped
    expect(runs().length).toBeGreaterThan(AFTER_REPLY_MAX_ROUNDS);
    expectNothingFallsBetween();
  });

  it('the pre-send ceiling path does one round, however big the backlog', async () => {
    await play({ policy: LIVE_POLICY, exchanges: 110, sizes: SIZES.avg, afterReply: false });
    expect((await maybeCompactSession(session(), 'test', 'ceiling')).compacted).toBe(true);
    expect(runs()).toHaveLength(1);
  });

  it('one message longer than the whole budget is shortened, says so, and does not block the rounds after it', async () => {
    const row = openSession(LIVE_POLICY);
    for (let i = 0; i < 60; i++) {
      db.rows.push(row('user', block('turn-context', SIZES.avg.context)));
      db.rows.push(row('user', said(`U${i}`, i === 3 ? 25_000 : SIZES.avg.user)));
      db.rows.push(row('assistant', said(`A${i}`, SIZES.avg.reply)));
      await compactSessionAfterReply('s1', 'test');
    }
    const pasted = runs().find((r) => r.transcript.includes('user: U3 '));
    expect(pasted?.transcript.length).toBeLessThanOrEqual(TRANSCRIPT_BUDGET_CHARS);
    expect(pasted?.transcript).toContain('[cut to fit the summarizer]');
    expect(runs().some((r) => r.transcript.includes('user: U20 '))).toBe(true); // later rounds still ran
  });
});

describe('cutTranscript', () => {
  const row = rowFactory();
  const isApp = (m: ChatMessageRow) => m.content.startsWith('<context');
  const rows = [
    row('user', block('turn-context', 50)),
    row('user', 'U0 hello'),
    row('assistant', 'A0 hi there'),
    row('user', 'U1 how far today'),
    row('assistant', 'A1 three miles'),
  ];

  it('takes every dialogue row when they fit, and drops the injected ones', () => {
    const cut = cutTranscript(rows, isApp, 1_000);
    expect(cut?.transcript).toBe(
      'user: U0 hello\n\nassistant: A0 hi there\n\nuser: U1 how far today\n\nassistant: A1 three miles',
    );
    expect(cut).toMatchObject({ summarizedRows: 4, lastIndex: 4, budgetCut: false });
  });

  it('when the budget cuts, it ends on her last reply that fit, not on a question', () => {
    const cut = cutTranscript(rows, isApp, 60); // room for U0, A0 and U1, not A1
    expect(cut).toMatchObject({ summarizedRows: 2, lastIndex: 2, budgetCut: true });
    expect(cut?.transcript.length).toBeLessThanOrEqual(60);
  });

  it('near-miss: no dialogue at all is no round', () => {
    expect(cutTranscript(rows.slice(0, 1), isApp, 1_000)).toBeNull();
  });
});

describe('B: a fold has to be worth what it loses', () => {
  /** Audit scenario: 60 exchanges with 12.5k-char injected rows (the p90). */
  it.each([
    ['turn tail, no guard: the defect', TURN_POLICY, 40, 60],
    ['turn tail + 4,000-unit guard (sessions not yet backfilled)', { ...TURN_POLICY, minRemovedUnits: 4_000 }, 1, 30],
    ['live policy: 12,000-unit tail + guard', LIVE_POLICY, 1, 10],
  ])('%s', async (_name, policy, atLeast, atMost) => {
    await play({ policy, exchanges: 60, sizes: SIZES.p90 });
    expect(runs().length).toBeGreaterThanOrEqual(atLeast);
    expect(runs().length).toBeLessThanOrEqual(atMost);
  });

  it('live policy: every fold takes out at least the minimum, and no send goes past the ceiling', async () => {
    const { atSend } = await play({ policy: LIVE_POLICY, exchanges: 60, sizes: SIZES.p90 });
    for (const r of runs()) {
      expect(r.compaction.budgetCut || r.compaction.removedUnits >= LIVE_POLICY.minRemovedUnits).toBe(true);
    }
    expect(Math.max(...atSend)).toBeLessThan(LIVE_POLICY.ceilingTokens);
  });

  it('huge injected rows (40k chars a turn) stay bounded: the two-exchange floor, then a fold', async () => {
    const { atSend } = await play({
      policy: LIVE_POLICY,
      exchanges: 30,
      sizes: { user: 181, reply: 893, context: 40_000 },
    });
    expect(runs().length).toBeGreaterThan(5);
    expect(Math.max(...atSend)).toBeLessThan(LIVE_POLICY.ceilingTokens + 11_000); // at most one exchange over
  });

  it('a guard set absurdly high delays a fold but cannot stop it: capped at half the trigger', async () => {
    // Huge injected rows and little dialogue: the transcript budget would take ~9 exchanges to
    // fill (~90k units of history), so only the cap keeps this bounded.
    const policy = { ...LIVE_POLICY, minRemovedUnits: 1e9 };
    const { atSend } = await play({ policy, exchanges: 40, sizes: { user: 181, reply: 893, context: 40_000 } });
    expect(runs().length).toBeGreaterThan(3);
    expect(runs().every((r) => r.compaction.removedUnits >= policy.triggerTokens / 2)).toBe(true);
    expect(Math.max(...atSend)).toBeLessThan(policy.triggerTokens * 1.5 + 2 * 10_300 + 10_300);
  });

  it('the guard skip is logged with its reason', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await play({ policy: { ...TURN_POLICY, minRemovedUnits: 4_000 }, exchanges: 14, sizes: SIZES.p90 });
    expect(info.mock.calls.some((c) => String(c[1]).includes('under the 4000 minimum'))).toBe(true);
    info.mockRestore();
  });
});
