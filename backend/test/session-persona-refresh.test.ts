/**
 * A live session must be able to pick up a re-prompted job — and must never lose the caller's own
 * half of its prompt doing it.
 *
 * The bug this closes, measured on Cadence 2026-08-19 minutes after a persona push: the coach job
 * carried 20,647 chars with a new rule, the owner's live session carried 19,832 without it, and 6
 * of 205 active sessions had it — every one opened after the push. Sessions rotate only after
 * seven idle days, so a daily user's never does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionRow, ProcessingJobRow, ChatMessageRow } from '../src/types.ts';

const listChatMessages = vi.fn();
const updateChatMessage = vi.fn();
const updateChatSession = vi.fn();
vi.mock('../src/models/chat-sessions.ts', () => ({
  listChatMessages: (...a: unknown[]) => listChatMessages(...a),
  updateChatMessage: (...a: unknown[]) => updateChatMessage(...a),
  updateChatSession: (...a: unknown[]) => updateChatSession(...a),
}));

const { refreshSessionSystemPrompt, hashPrompt, composeSystemPrompt } =
  await import('../src/services/session-persona-refresh.ts');

const OLD = 'You are Cadence, a coach.';
const NEW = 'You are Cadence, a coach. When they ask for a change, the card goes up.';

const job = (systemPrompt: string | undefined): ProcessingJobRow =>
  ({ id: 'j1', slug: 'cadence-coach-chat', config: systemPrompt ? { systemPrompt } : {} }) as ProcessingJobRow;

const session = (over: Partial<ChatSessionRow> = {}): ChatSessionRow =>
  ({
    id: 's1',
    workflow_id: null,
    system_prompt: OLD,
    config: { prompt: { jobHash: hashPrompt(OLD), caller: null } },
    ...over,
  }) as ChatSessionRow;

const systemRow = { id: 'row-sys', role: 'system', content: OLD } as ChatMessageRow;

beforeEach(() => {
  vi.clearAllMocks();
  listChatMessages.mockResolvedValue([systemRow, { id: 'm1', role: 'user', content: 'hi' } as ChatMessageRow]);
  updateChatMessage.mockResolvedValue(systemRow);
  updateChatSession.mockResolvedValue({});
});

describe('refreshSessionSystemPrompt', () => {
  it('rewrites the MESSAGE ROW, because that is what reaches the provider', async () => {
    expect(await refreshSessionSystemPrompt(session(), job(NEW))).toBe(true);
    expect(updateChatMessage).toHaveBeenCalledWith('row-sys', { content: NEW });
    // The column is a convenience copy, and is kept honest alongside it.
    expect(updateChatSession.mock.calls[0]?.[1]).toMatchObject({ system_prompt: NEW });
  });

  it('records the new hash so the next turn is a no-op', async () => {
    await refreshSessionSystemPrompt(session(), job(NEW));
    const cfg = (updateChatSession.mock.calls[0]?.[1] as { config: { prompt: { jobHash: string } } }).config;
    expect(cfg.prompt.jobHash).toBe(hashPrompt(NEW));

    const settled = session({
      config: { prompt: { jobHash: hashPrompt(NEW), caller: null } },
    } as Partial<ChatSessionRow>);
    expect(await refreshSessionSystemPrompt(settled, job(NEW))).toBe(false);
    expect(updateChatMessage).toHaveBeenCalledTimes(1);
  });

  /** The whole reason provenance is recorded: the caller's half cannot be re-derived. */
  it('keeps the caller half verbatim and replaces only the job half', async () => {
    const caller = 'Per-session context the caller supplied.';
    const s = session({
      system_prompt: composeSystemPrompt(OLD, caller),
      config: { prompt: { jobHash: hashPrompt(OLD), caller } },
    } as Partial<ChatSessionRow>);

    await refreshSessionSystemPrompt(s, job(NEW));
    expect(updateChatMessage).toHaveBeenCalledWith('row-sys', { content: `${NEW}\n\n${caller}` });
  });

  it('leaves pre-provenance sessions alone rather than guessing at the halves', async () => {
    const legacy = session({ config: null } as Partial<ChatSessionRow>);
    expect(await refreshSessionSystemPrompt(legacy, job(NEW))).toBe(false);
    expect(updateChatMessage).not.toHaveBeenCalled();
  });

  it('does not touch a workflow session, whose prompt takes precedence at open', async () => {
    const wf = session({ workflow_id: 'w1' } as Partial<ChatSessionRow>);
    expect(await refreshSessionSystemPrompt(wf, job(NEW))).toBe(false);
    expect(updateChatMessage).not.toHaveBeenCalled();
  });

  it('does nothing without a job, or a job prompt', async () => {
    expect(await refreshSessionSystemPrompt(session(), null)).toBe(false);
    expect(await refreshSessionSystemPrompt(session(), job(undefined))).toBe(false);
    expect(updateChatMessage).not.toHaveBeenCalled();
  });

  /**
   * With no system row there is nothing to rewrite, and updating the column alone would report a
   * prompt the model is not being sent.
   */
  it('changes nothing when the session has no system row', async () => {
    listChatMessages.mockResolvedValue([{ id: 'm1', role: 'user', content: 'hi' } as ChatMessageRow]);
    expect(await refreshSessionSystemPrompt(session(), job(NEW))).toBe(false);
    expect(updateChatSession).not.toHaveBeenCalled();
  });

  /** Best-effort by contract: a refresh failure must never cost the user their turn. */
  it('swallows a write failure and reports it did nothing', async () => {
    updateChatMessage.mockRejectedValue(new Error('db down'));
    expect(await refreshSessionSystemPrompt(session(), job(NEW))).toBe(false);
  });
});
