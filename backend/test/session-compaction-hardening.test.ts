/**
 * HARNESS-V3 P1b, findings C, E and F:
 *  C. Rows written once in a while (today's date, the last attachment, a health digest) were
 *     dropped once they aged behind the tail and never sent again.
 *  E. Two overlapping runs could move the mark backwards.
 *  F. The summarizer's diagnostic row did not say which session it served or what it read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionRow, ChatMessageRow } from '../src/types.ts';
import { KEEP_NEWEST, LIVE_POLICY, block, rowFactory, said } from './helpers/compaction-sim.ts';

const db = vi.hoisted(() => ({ rows: [] as ChatMessageRow[], session: null as ChatSessionRow | null }));
const executeJob = vi.hoisted(() => vi.fn());
const getProcessingJobBySlug = vi.hoisted(() => vi.fn());
const listChatMessages = vi.hoisted(() => vi.fn());

vi.mock('../src/models/chat-sessions.ts', () => ({
  listChatMessages,
  getChatSession: vi.fn(async () => db.session),
  updateChatSessionIfMarkUnchanged: vi.fn(
    async (_id: string, updates: Partial<ChatSessionRow>, expectedMark: string | null) => {
      if ((db.session?.summary_through_at ?? null) !== expectedMark) return null;
      db.session = { ...(db.session as ChatSessionRow), ...updates };
      return db.session;
    },
  ),
}));
vi.mock('../src/models/processing-jobs.ts', () => ({ getProcessingJobBySlug }));
vi.mock('../src/ai-manager/index.ts', () => ({ executeJob }));

const { maybeCompactSession, buildCompactedHistory, getSummarizerConfig } =
  await import('../src/services/session-compaction.ts');
const { newestPerSource, rowSource } = await import('../src/services/session-compaction-history.ts');

const session = () => db.session as ChatSessionRow;
const sent = () => buildCompactedHistory(session(), db.rows, getSummarizerConfig(session()));
const transcripts = () => executeJob.mock.calls.map((c) => (c[1].variables as { transcript: string }).transcript);

/** A small policy so a handful of rows compacts; the patterns are the live ones. */
const POLICY = { ...LIVE_POLICY, triggerTokens: 1_500, ceilingTokens: 3_000, keepTailUnits: 600, minRemovedUnits: 50 };

let row = rowFactory();
const exchange = (i: number) => [
  row('user', block('turn-context', 400)),
  row('user', said(`U${i}`, 80)),
  row('assistant', said(`A${i}`, 400)),
];

beforeEach(() => {
  row = rowFactory();
  executeJob.mockReset().mockImplementation(async () => ({ formatted: 'summary so far' }));
  getProcessingJobBySlug.mockReset().mockImplementation(async (slug: string) => ({ id: 'job', slug }));
  listChatMessages.mockReset().mockImplementation(async () => db.rows);
  db.session = { id: 's1', config: { summarizer: POLICY }, workspace_id: 'w' } as unknown as ChatSessionRow;
  db.rows = [row('system', 'persona'), row('user', block('capabilities', 100))];
});

describe('C: the newest row of each kept source outlives the tail', () => {
  it.each([
    ['<context source="date" version="3" built_at="x">', 'date'],
    ['\n  <context source="attachments" version="2" built_at="x">', 'attachments'],
    ['<context source="health-digest" version="1" built_at="x">', 'health-digest'],
    ['<context source="turn-floor" version="1">', null],
    ['<context source="turn-context" version="1">', null],
    ['<context source="attachments-failed" version="2">', null],
    ['<context source="dates" version="1">', null],
    ['<note>They shared Apple Health.</note>', null],
    ['I typed <context source="date"> into a message', null],
  ])('rowSource(%j) is %j', (content, source) => {
    expect(rowSource(KEEP_NEWEST)({ content } as ChatMessageRow)).toBe(source);
  });

  it('a pattern with no capture group keys on the whole match; an invalid one matches nothing', () => {
    expect(rowSource('^<context source="date"')({ content: '<context source="date">' } as ChatMessageRow)).toBe(
      '<context source="date"',
    );
    expect(() => newestPerSource([row('user', 'x')], [], '(')).not.toThrow();
    expect(newestPerSource([row('user', block('date', 10))], [], '(')).toEqual([]);
  });

  it('after compaction: newest date, last attachment and digest are sent, after the summary and before the tail', async () => {
    const day1 = row('user', block('date', 120));
    db.rows.push(day1, ...exchange(0), row('user', block('attachments', 80)), ...exchange(1));
    const day2 = row('user', block('date', 120));
    const photo = row('user', `<context source="attachments" version="2" built_at="x">\nphoto_ref p-2\n</context>`);
    const digest = row('user', block('health-digest', 90));
    const floor = row('user', block('turn-floor', 90));
    db.rows.push(day2, ...exchange(2), photo, digest, floor, ...exchange(3));
    for (let i = 4; i < 9; i++) db.rows.push(...exchange(i));

    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);
    const history = sent();
    const at = (m: ChatMessageRow) => history.indexOf(m);
    const summaryAt = history.findIndex((m) => m.content.startsWith('[Conversation summary]'));
    const tailStart = history.findIndex(
      (m, i) => i > summaryAt && /^\s*<context source="turn-context"|^[UA]\d/.test(m.content),
    );

    for (const kept of [day2, photo, digest]) {
      expect(at(kept)).toBeGreaterThan(summaryAt);
      expect(at(kept)).toBeLessThan(tailStart);
    }
    expect(at(day1)).toBe(-1); // superseded by day2
    expect(at(floor)).toBe(-1); // near-miss: per-turn context is sent again anyway
    expect(history.filter((m) => m.content.includes('source="attachments"'))).toEqual([photo]);
    for (const t of transcripts()) expect(t).not.toContain('<context');
  });

  it('near-miss: a source the tail already carries is not sent twice', async () => {
    db.rows.push(row('user', block('date', 120)));
    for (let i = 0; i < 8; i++) db.rows.push(...exchange(i));
    const today = row('user', block('date', 120));
    db.rows.push(today, ...exchange(8));

    await maybeCompactSession(session(), 'test');
    expect(sent().filter((m) => m.content.includes('source="date"'))).toEqual([today]);
  });

  it('survivors keep surviving later compactions', async () => {
    const date = row('user', block('date', 120));
    db.rows.push(date);
    for (let i = 0; i < 9; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    for (let i = 9; i < 18; i++) db.rows.push(...exchange(i));
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(true);
    expect(sent()).toContain(date);
  });
});

describe('E: the mark never moves backwards', () => {
  it('a run planned from a stale mark does not write', async () => {
    for (let i = 0; i < 9; i++) db.rows.push(...exchange(i));
    const stale = { ...session() };
    await maybeCompactSession(session(), 'test');
    const { summary_through_at: mark, session_summary: summary } = session();
    for (let i = 9; i < 18; i++) db.rows.push(...exchange(i));
    executeJob.mockImplementation(async () => ({ formatted: 'from the stale run' }));

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect((await maybeCompactSession(stale, 'test', 'ceiling')).compacted).toBe(false);
    expect(session()).toMatchObject({ summary_through_at: mark, session_summary: summary });
    expect(info.mock.calls.some((c) => String(c[0]).includes('the mark moved during the run'))).toBe(true);
    info.mockRestore();
  });

  it('two runs at once from the same mark: one writes, the other skips', async () => {
    for (let i = 0; i < 9; i++) db.rows.push(...exchange(i));
    const snapshot = { ...session() };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const results = await Promise.all([maybeCompactSession(snapshot, 'test'), maybeCompactSession(snapshot, 'test')]);
    info.mockRestore();
    expect(results.filter((r) => r.compacted)).toHaveLength(1);
    expect(executeJob).toHaveBeenCalledTimes(2);
  });
});

describe('F: the summarizer run says what it served and what it read', () => {
  it('passes the session id and the round facts to the diagnostic row', async () => {
    for (let i = 0; i < 9; i++) db.rows.push(...exchange(i));
    await maybeCompactSession(session(), 'test');
    const opts = executeJob.mock.calls[0]?.[1] as {
      diagnostics: { chatSessionId: string; metadata: { compaction: Record<string, unknown> } };
      variables: { transcript: string };
    };
    expect(opts.diagnostics.chatSessionId).toBe('s1');
    expect(opts.diagnostics.metadata.compaction).toMatchObject({
      summarizedRows: expect.any(Number),
      transcriptChars: opts.variables.transcript.length,
      budgetCut: false,
    });
  });

  it.each([
    ['the summarizer job is missing', () => getProcessingJobBySlug.mockResolvedValue(null)],
    ['the history cannot be read', () => listChatMessages.mockRejectedValue(new Error('db down'))],
  ])('a failure before the run (%s) logs the session id', async (_name, breakIt) => {
    for (let i = 0; i < 9; i++) db.rows.push(...exchange(i));
    breakIt();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await maybeCompactSession(session(), 'test')).compacted).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).toContain('"sessionId":"s1"');
    warn.mockRestore();
  });
});
