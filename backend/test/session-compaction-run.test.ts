/**
 * When compaction runs, what it summarizes, and what stays verbatim — each case the test that would
 * have caught a defect measured 2026-10-31 (docs/cadence/HARNESS-V3.md C1):
 *  - every message after the first compaction re-summarized the whole older conversation;
 *  - the kept tail counted injected context rows as turns;
 *  - it ran before the reply instead of after it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionRow, ChatMessageRow } from '../src/types.ts';

const db = vi.hoisted(() => ({
  rows: [] as ChatMessageRow[],
  session: null as ChatSessionRow | null,
}));
const executeJob = vi.hoisted(() => vi.fn());

vi.mock('../src/models/chat-sessions.ts', () => ({
  listChatMessages: vi.fn(async () => db.rows),
  getChatSession: vi.fn(async () => db.session),
  updateChatSession: vi.fn(async (_id: string, updates: Partial<ChatSessionRow>) => {
    db.session = { ...(db.session as ChatSessionRow), ...updates };
    return db.session;
  }),
}));
vi.mock('../src/models/processing-jobs.ts', () => ({
  getProcessingJobBySlug: vi.fn(async (slug: string) => ({ id: 'job', slug })),
}));
vi.mock('../src/ai-manager/index.ts', () => ({ executeJob }));

const {
  maybeCompactSession,
  splitForCompaction,
  buildCompactedHistory,
  getSummarizerConfig,
  compactSessionAfterReply,
} = await import('../src/services/session-compaction.ts');

const APP = '^\\s*<(context|note)\\b';
let clock = Date.parse('2026-10-31T10:00:00Z');
const row = (role: string, content: string): ChatMessageRow =>
  ({
    id: `m${clock}`,
    chat_session_id: 's1',
    role,
    content,
    created_at: new Date((clock += 1000)).toISOString(),
  }) as ChatMessageRow;

/** One exchange the way the coach stores it: injected context, the user's words, her reply. */
const exchange = (i: number, size = 400) => [
  row('user', `<context source="turn-context">${'c'.repeat(size)}</context>`),
  row('user', `user ${i}`),
  row('assistant', `coach ${i} ${'r'.repeat(size)}`),
];

const policy = {
  jobSlug: 'coach-compact',
  triggerTokens: 1000,
  ceilingTokens: 2000,
  keepLastNTurns: 4,
  appRowPattern: APP,
  pinnedRowPattern: '^\\s*<context source="capabilities"',
};

/** The current session row (set in beforeEach, so never null inside a test). */
const session = () => db.session as ChatSessionRow;

beforeEach(() => {
  executeJob.mockReset().mockImplementation(async () => ({ formatted: `summary@${clock}` }));
  db.session = { id: 's1', config: { summarizer: policy }, workspace_id: 'w' } as unknown as ChatSessionRow;
  db.rows = [row('system', 'persona')];
});

describe('splitForCompaction', () => {
  it('counts turns, not injected rows, and keeps a turn its context', () => {
    const pending = [...exchange(1), ...exchange(2), ...exchange(3)];
    const { toSummarize, kept } = splitForCompaction(pending, 4, APP);
    // four real turns back = user 2, coach 2, user 3, coach 3 — plus exchange 2's context row.
    expect(kept.map((m) => m.content.slice(0, 9))).toEqual([
      '<context ',
      'user 2',
      'coach 2 r',
      '<context ',
      'user 3',
      'coach 3 r',
    ]);
    expect(toSummarize).toHaveLength(3);
  });

  it('near-miss: without a pattern every row is a turn', () => {
    const { kept } = splitForCompaction([...exchange(1), ...exchange(2)], 4);
    expect(kept).toHaveLength(4);
  });

  it('summarizes nothing when there are not enough turns to keep', () => {
    expect(splitForCompaction(exchange(1), 4, APP).toSummarize).toEqual([]);
  });

  it('an invalid pattern counts every row instead of throwing', () => {
    expect(() => splitForCompaction(exchange(1), 1, '(')).not.toThrow();
  });
});

describe('maybeCompactSession', () => {
  it('compacts once, then not again on the next message (the 2026-08-31 loop)', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);
    expect(session().summary_through_at).toBeTruthy();

    db.rows.push(...exchange(6, 10));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(false);
    expect(executeJob).toHaveBeenCalledTimes(1);
  });

  it('a second compaction summarizes only the rows after the mark, plus the old summary', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    const firstSummary = session().session_summary;

    for (let i = 6; i < 12; i++) db.rows.push(...exchange(i));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);

    const vars = executeJob.mock.calls[1]?.[1].variables as { transcript: string; existingSummary: string };
    expect(vars.existingSummary).toBe(firstSummary);
    expect(vars.transcript).not.toContain('user 0');
    expect(vars.transcript).toContain('user 5');
  });

  it('the sent history after compaction is instructions + summary + everything after the mark', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    db.rows.push(...exchange(6, 10));

    const sent = buildCompactedHistory(session(), db.rows, getSummarizerConfig(session()));
    expect(sent[0]?.content).toBe('persona');
    expect(sent[1]?.content).toContain('[Conversation summary]');
    expect(sent.map((m) => m.content)).toContain('user 6');
    expect(sent.map((m) => m.content)).not.toContain('user 3');
  });

  it("'ceiling' waits for the ceiling; 'trigger' does not", async () => {
    for (let i = 0; i < 5; i++) db.rows.push(...exchange(i)); // ~1,070 units: past trigger, under ceiling
    expect((await maybeCompactSession(session(), 'test', 'ceiling')).compacted).toBe(false);
    expect((await maybeCompactSession(session(), 'test', 'trigger')).compacted).toBe(true);
  });

  it('a failed summarizer leaves the session exactly as it was', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    executeJob.mockRejectedValueOnce(new Error('provider down'));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(false);
    expect(session().session_summary).toBeUndefined();
    expect(session().summary_through_at).toBeUndefined();
  });
});

describe('getSummarizerConfig', () => {
  it('ceiling defaults to the trigger, and is never below it', () => {
    const at = (s: object) =>
      getSummarizerConfig({ config: { summarizer: { jobSlug: 'x', ...s } } } as unknown as ChatSessionRow);
    expect(at({ triggerTokens: 500 })?.ceilingTokens).toBe(500);
    expect(at({ triggerTokens: 500, ceilingTokens: 100 })?.ceilingTokens).toBe(500);
    expect(at({ triggerTokens: 500, ceilingTokens: 900 })?.ceilingTokens).toBe(900);
  });
});

describe('compactSessionAfterReply', () => {
  it('compacts at the trigger and never throws', async () => {
    for (let i = 0; i < 5; i++) db.rows.push(...exchange(i));
    await compactSessionAfterReply('s1', 'test');
    expect(executeJob).toHaveBeenCalledTimes(1);

    db.session = null;
    await expect(compactSessionAfterReply('gone', 'test')).resolves.toBeUndefined();
  });
});

/**
 * HARNESS-V3 C2: app rows behind the kept tail are dropped, not summarized; pinned blocks — sent
 * once per session — are kept verbatim through every compaction (MP33).
 */
describe('dropping app rows, keeping pinned ones', () => {
  const manifest = () =>
    row('user', '<context source="capabilities" version="3">DO THESE, DO NOT DESCRIBE THEM</context>');

  it('the summarizer never reads injected context or notes', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i), row('user', '<note>They shared Apple Health.</note>'));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);
    const vars = executeJob.mock.calls[0]?.[1].variables as { transcript: string };
    expect(vars.transcript).toContain('user 0');
    expect(vars.transcript).not.toContain('<context');
    expect(vars.transcript).not.toContain('<note>');
  });

  it('after compaction, no unpinned app row from before the mark is sent', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    const sent = buildCompactedHistory(session(), db.rows, getSummarizerConfig(session()));
    const contextRows = sent.filter((m) => m.content.startsWith('<context'));
    // the kept tail is four turns = exchanges 4 and 5, each with its own context row
    expect(contextRows).toHaveLength(2);
  });

  it('a pinned block survives two compactions, ahead of the summary', async () => {
    db.rows.push(manifest());
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    for (let i = 6; i < 12; i++) db.rows.push(...exchange(i));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);

    const sent = buildCompactedHistory(session(), db.rows, getSummarizerConfig(session()));
    const at = (needle: string) => sent.findIndex((m) => m.content.includes(needle));
    expect(at('DO THESE')).toBeGreaterThan(at('persona'));
    expect(at('DO THESE')).toBeLessThan(at('[Conversation summary]'));
    for (const call of executeJob.mock.calls) {
      expect((call[1].variables as { transcript: string }).transcript).not.toContain('DO THESE');
    }
  });

  it('near-miss: a turn-context block is not pinned', async () => {
    for (let i = 0; i < 6; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    const sent = buildCompactedHistory(session(), db.rows, getSummarizerConfig(session()));
    expect(sent.findIndex((m) => m.content.startsWith('<context'))).toBeGreaterThan(
      sent.findIndex((m) => m.content.includes('[Conversation summary]')),
    );
  });

  it('what gets summarized always ends on a real turn, so the summarizer always has dialogue', () => {
    const burst = Array.from({ length: 6 }, () => row('user', '<context source="turn-context">x</context>'));
    const pending = [...exchange(1), ...burst, ...exchange(2), ...exchange(3)];
    const { toSummarize } = splitForCompaction(pending, 4, APP);
    expect(toSummarize.at(-1)?.content).toMatch(/^coach 1/);
  });
});
