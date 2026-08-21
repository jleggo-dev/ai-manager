import { beforeEach, describe, expect, it, vi } from 'vitest';

const listConversationsBefore = vi.fn();
const getCoachHistory = vi.fn();

vi.mock('../repos/conversations.ts', () => ({
  listConversationsBefore: (...a: unknown[]) => listConversationsBefore(...a),
}));
vi.mock('../ai/aim.ts', () => ({
  getCoachHistory: (...a: unknown[]) => getCoachHistory(...a),
}));

const { ARCHIVE_TURN_CAP, readArchivedConversations } = await import('./coach-transcript.ts');

const row = (id: string, created: string) => ({
  conversation_id: `conv-${id}`,
  user_id: 'u1',
  ai_session_id: id,
  external_chat_id: null,
  created_at: created,
  updated_at: created,
});

const said = (...contents: string[]) => ({
  messages: contents.map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content })),
});

/**
 * Reading back through the archive. Everything here is about the two ways a row can fail to be a
 * conversation worth showing — it holds nothing the user ever said, or it cannot be read at all —
 * and about the cursor always moving anyway, because a cursor that stalls turns "read earlier"
 * into a button that does nothing forever.
 */
describe('readArchivedConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listConversationsBefore.mockResolvedValue([]);
    getCoachHistory.mockResolvedValue(said());
  });

  it('returns the conversation behind the cursor, with its transcript', async () => {
    listConversationsBefore.mockResolvedValueOnce([row('s2', '2026-08-12T09:00:00Z')]);
    getCoachHistory.mockResolvedValueOnce(said('my knee is sore', 'how long has it been?'));

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations).toHaveLength(1);
    expect(r.conversations[0]).toMatchObject({ sessionId: 's2', startedAt: '2026-08-12T09:00:00Z', truncated: false });
    expect(r.conversations[0]!.turns).toEqual([
      { role: 'user', content: 'my knee is sore' },
      { role: 'coach', content: 'how long has it been?' },
    ]);
    expect(r.hasMore).toBe(false);
  });

  it('strips the turns the app authored — an injected pack is not something they said', async () => {
    listConversationsBefore.mockResolvedValueOnce([row('s2', '2026-08-12T09:00:00Z')]);
    getCoachHistory.mockResolvedValueOnce({
      messages: [
        { role: 'system', content: 'You are Cadence' },
        { role: 'user', content: '<context source="registry-pack">…</context>' },
        { role: 'user', content: '<note>They just shared Apple Health.</note>' },
        { role: 'user', content: 'actually said this' },
      ],
    });
    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations[0]!.turns).toEqual([{ role: 'user', content: 'actually said this' }]);
  });

  /**
   * Opening the Coach tab creates a session; one that is never spoken into leaves a row whose only
   * turns are injected context. Rendering that as "earlier conversation" would put an empty dated
   * divider in someone's history.
   */
  it('skips a conversation nobody ever spoke into, and finds the real one behind it', async () => {
    listConversationsBefore.mockResolvedValueOnce([
      row('empty', '2026-08-15T09:00:00Z'),
      row('real', '2026-08-12T09:00:00Z'),
    ]);
    getCoachHistory
      .mockResolvedValueOnce({ messages: [{ role: 'user', content: '<context>pack</context>' }] })
      .mockResolvedValueOnce(said('a real thing'));

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations.map((c) => c.sessionId)).toEqual(['real']);
  });

  it('skips a thread it cannot read rather than failing the whole history', async () => {
    listConversationsBefore.mockResolvedValueOnce([
      row('broken', '2026-08-15T09:00:00Z'),
      row('fine', '2026-08-12T09:00:00Z'),
    ]);
    getCoachHistory.mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce(said('still here'));

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations.map((c) => c.sessionId)).toEqual(['fine']);
  });

  /**
   * The stall the cursor exists to prevent: every row filtered out, nothing returned. The next
   * request must start BEHIND everything examined, or it re-scans the same rows forever.
   */
  it('moves the cursor past every row it looked at, not just the ones it returned', async () => {
    listConversationsBefore.mockResolvedValueOnce([
      row('e1', '2026-08-15T09:00:00Z'),
      row('e2', '2026-08-14T09:00:00Z'),
    ]);
    getCoachHistory.mockResolvedValue({ messages: [] });

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations).toEqual([]);
    expect(r.nextBefore).toBe('2026-08-14T09:00:00Z');
  });

  it('reports more archive behind it when it stopped early to fill the request', async () => {
    listConversationsBefore.mockResolvedValueOnce([
      row('s2', '2026-08-12T09:00:00Z'),
      row('s3', '2026-08-01T09:00:00Z'),
    ]);
    getCoachHistory.mockResolvedValue(said('something'));

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    expect(r.conversations.map((c) => c.sessionId)).toEqual(['s2']);
    expect(r.hasMore).toBe(true);
    expect(r.nextBefore).toBe('2026-08-12T09:00:00Z');
  });

  it('keeps the TAIL of a thread past the display cap, and says it did', async () => {
    listConversationsBefore.mockResolvedValueOnce([row('long', '2026-08-12T09:00:00Z')]);
    const many = Array.from({ length: ARCHIVE_TURN_CAP + 40 }, (_, i) => `turn ${i}`);
    getCoachHistory.mockResolvedValueOnce(said(...many));

    const r = await readArchivedConversations('u1', '2026-08-19T10:00:00Z', 1);
    const conv = r.conversations[0]!;
    expect(conv.truncated).toBe(true);
    expect(conv.turns).toHaveLength(ARCHIVE_TURN_CAP);
    expect(conv.turns.at(-1)!.content).toBe(`turn ${ARCHIVE_TURN_CAP + 39}`);
  });
});
