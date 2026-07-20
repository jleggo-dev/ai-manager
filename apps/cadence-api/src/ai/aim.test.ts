/**
 * API-05 ΓÇö smoke / characterization tests for the AI Admin in-process seam (`ai/aim.ts`).
 *
 * Mocks `@ai-admin/core` so Cadence CI never loads the real engine (no AI-Manager secrets,
 * no live LLM). Pins the load-bearing contracts: RequestAuthContext shape, clockVars UTC
 * pairing, and CoachDiag finalization via `recordCoachReply`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { WORKSPACE_ID, CALLING_APP, COACH_JOB_SLUG, USER, SENTINEL_API_KEY_ID, core } = vi.hoisted(() => {
  const WORKSPACE_ID = '11111111-1111-4111-a111-111111111111';
  const CALLING_APP = 'platform:cadence';
  const COACH_JOB_SLUG = 'cadence-coach-chat';
  const USER = '00000000-0000-4000-a000-00000000a105';
  const SENTINEL_API_KEY_ID = '00000000-0000-0000-0000-000000000000';
  type JobOpts = {
    callingApplication: string;
    variables: Record<string, unknown>;
    images?: string[];
  };
  type ChatMsg = { chat_session_id: string; role: string; content: string };
  return {
    WORKSPACE_ID,
    CALLING_APP,
    COACH_JOB_SLUG,
    USER,
    SENTINEL_API_KEY_ID,
    core: {
      runWithAuth: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()),
      executeJobById: vi.fn(async (_id: string, _opts: JobOpts) => ({ formatted: '{}' })),
      executeJob: vi.fn(async (_slug: string, _opts: JobOpts) => ({ formatted: '{}' })),
      openChatSession: vi.fn(async () => ({ sessionId: 'sess-1' })),
      sendChatMessage: vi.fn(async () => ({
        response: { body: null },
        sessionId: 'sess-1',
        diagnosticSession: null,
        resolvedMessage: null,
      })),
      recordAssistantMessage: vi.fn(async () => undefined),
      createChatMessage: vi.fn(async (_msg: ChatMsg) => ({ id: 'msg-1' })),
      getProcessingJobBySlug: vi.fn(async (_slug: string): Promise<{ config: { systemPrompt?: string } } | null> => ({
        config: { systemPrompt: 'You are Cadence.' },
      })),
      getChatHistory: vi.fn(async () => [{ role: 'user', content: 'hi' }]),
      purgeRemoteChatsForUser: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@ai-admin/core', () => ({
  runWithAuth: core.runWithAuth,
  executeJobById: core.executeJobById,
  executeJob: core.executeJob,
  openChatSession: core.openChatSession,
  sendChatMessage: core.sendChatMessage,
  recordAssistantMessage: core.recordAssistantMessage,
  createChatMessage: core.createChatMessage,
  getProcessingJobBySlug: core.getProcessingJobBySlug,
  getChatHistory: core.getChatHistory,
  purgeRemoteChatsForUser: core.purgeRemoteChatsForUser,
}));

// Avoid config.ts ΓåÆ buildDbUrl() throwing when Cadence DB env is absent (CI unit path).
vi.mock('../config.ts', () => ({
  cadenceConfig: {
    aim: {
      workspaceId: WORKSPACE_ID,
      callingApplication: CALLING_APP,
      coachJobSlug: COACH_JOB_SLUG,
    },
  },
}));

import {
  withAim,
  runJob,
  runJobBySlug,
  openCoachSession,
  sendCoachMessage,
  recordCoachReply,
  injectCoachContext,
  getCoachHistory,
  getCoachPersona,
  purgeUserAiData,
  AimError,
} from './aim.ts';

const EXPECTED_AUTH = {
  mode: 'api_key' as const,
  workspaceId: WORKSPACE_ID,
  apiKeyId: SENTINEL_API_KEY_ID,
  forwardedUserId: USER,
  callingApplicationId: null,
};

function authArg(callIndex = 0) {
  return core.runWithAuth.mock.calls[callIndex]?.[0];
}

function lastAuthArg() {
  const calls = core.runWithAuth.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe('ai/aim.ts ΓÇö AI Admin seam (API-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.runWithAuth.mockImplementation(async (_ctx: unknown, fn: () => Promise<unknown>) => fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withAim / RequestAuthContext', () => {
    it('runs the callback inside api_key auth with workspace, sentinel apiKeyId, and forwarded user', async () => {
      const result = await withAim(USER, async () => 'ok');
      expect(result).toBe('ok');
      expect(core.runWithAuth).toHaveBeenCalledOnce();
      expect(authArg()).toEqual(EXPECTED_AUTH);
    });

    it('wraps engine/auth errors as AimError with a classified kind', async () => {
      core.runWithAuth.mockRejectedValueOnce(new Error('auth context failed'));
      const err = await withAim(USER, async () => 'never').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AimError);
      expect(err).toMatchObject({ kind: 'config', message: 'auth context failed' });
    });
  });

  describe('runJob / runJobBySlug + clockVars', () => {
    it('invokes executeJobById with callingApplication and merged variables under auth', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-18T15:00:00.000Z'));

      await runJob(USER, 'job-uuid-1', { foo: 'bar' });

      expect(authArg()).toEqual(EXPECTED_AUTH);
      expect(core.executeJobById).toHaveBeenCalledWith('job-uuid-1', {
        callingApplication: CALLING_APP,
        variables: {
          today: '2026-07-18',
          day_of_week: 'Saturday',
          foo: 'bar',
        },
      });
    });

    it('derives today and day_of_week from the same UTC calendar day near the UTC boundary', async () => {
      // 00:30 UTC Sunday ΓÇö US Eastern is still Saturday evening; both fields must stay on Sunday.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-19T00:30:00.000Z'));

      await runJobBySlug(USER, 'capture-extract', { note: 'x' });

      expect(core.executeJob).toHaveBeenCalledWith('capture-extract', {
        callingApplication: CALLING_APP,
        variables: {
          today: '2026-07-19',
          day_of_week: 'Sunday',
          note: 'x',
        },
      });
    });

    it('lets caller variables override clock keys when they collide', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));

      await runJob(USER, 'job-1', { today: '2099-01-01', day_of_week: 'Neverday' });

      expect(core.executeJobById).toHaveBeenCalledWith('job-1', {
        callingApplication: CALLING_APP,
        variables: {
          today: '2099-01-01',
          day_of_week: 'Neverday',
        },
      });
    });

    it('forwards images to executeJob only when non-empty', async () => {
      await runJobBySlug(USER, 'nutrition', {});
      expect(core.executeJob.mock.calls[0]?.[1]).not.toHaveProperty('images');

      await runJobBySlug(USER, 'nutrition', {}, { images: ['https://example.com/meal.jpg'] });
      expect(core.executeJob).toHaveBeenLastCalledWith(
        'nutrition',
        expect.objectContaining({ images: ['https://example.com/meal.jpg'] }),
      );
    });

    it('wraps job-execution failures as AimError', async () => {
      core.executeJobById.mockRejectedValueOnce(new Error('job boom'));
      const err = await runJob(USER, 'job-1', {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AimError);
      expect(err).toMatchObject({ kind: 'unknown', message: 'job boom' });
    });
  });

  describe('coach session surface', () => {
    it('openCoachSession binds the coach processing-job slug (not just a profile)', async () => {
      await openCoachSession(USER, { systemPrompt: 'dossier here', workflowSlug: 'wf-1' });
      expect(authArg()).toEqual(EXPECTED_AUTH);
      expect(core.openChatSession).toHaveBeenCalledWith(COACH_JOB_SLUG, {
        userId: USER,
        callingApplication: CALLING_APP,
        systemPrompt: 'dossier here',
        workflowSlug: 'wf-1',
      });
    });

    it('openCoachSession defaults optional fields to null', async () => {
      await openCoachSession(USER);
      expect(core.openChatSession).toHaveBeenCalledWith(COACH_JOB_SLUG, {
        userId: USER,
        callingApplication: CALLING_APP,
        systemPrompt: null,
        workflowSlug: null,
      });
    });

    it('sendCoachMessage relays through auth to sendChatMessage', async () => {
      await sendCoachMessage(USER, 'sess-9', 'hello coach');
      expect(authArg()).toEqual(EXPECTED_AUTH);
      expect(core.sendChatMessage).toHaveBeenCalledWith('sess-9', 'hello coach', {});
    });

    it('getCoachHistory / getCoachPersona / purgeUserAiData call the matching engine APIs', async () => {
      await expect(getCoachHistory(USER, 'sess-2')).resolves.toEqual([{ role: 'user', content: 'hi' }]);
      expect(core.getChatHistory).toHaveBeenCalledWith('sess-2');

      await expect(getCoachPersona(USER)).resolves.toBe('You are Cadence.');
      expect(core.getProcessingJobBySlug).toHaveBeenCalledWith(COACH_JOB_SLUG);

      core.getProcessingJobBySlug.mockResolvedValueOnce(null);
      await expect(getCoachPersona(USER)).resolves.toBeNull();

      await purgeUserAiData(USER);
      expect(core.purgeRemoteChatsForUser).toHaveBeenCalledWith(USER);
      expect(lastAuthArg()).toEqual(EXPECTED_AUTH);
    });
  });

  describe('recordCoachReply / CoachDiag contract', () => {
    it('persists the assistant turn and skips diag when diagnosticSession is null', async () => {
      await recordCoachReply(USER, {
        sessionId: 'sess-3',
        content: 'Nice work today.',
        diag: null,
        metrics: { promptTokens: 10, completionTokens: 20, durationMs: 100, firstTokenMs: 40 },
        model: 'gpt-test',
      });

      expect(authArg()).toEqual(EXPECTED_AUTH);
      expect(core.recordAssistantMessage).toHaveBeenCalledWith('sess-3', 'Nice work today.', {
        promptTokens: 10,
        completionTokens: 20,
        durationMs: 100,
        firstTokenMs: 40,
      });
    });

    it('finalizes CoachDiag: endLlmTimer payload shape + complete(success)', async () => {
      const diag = {
        endLlmTimer: vi.fn(),
        complete: vi.fn(async () => ({ id: 'diag-1' })),
      };

      await recordCoachReply(USER, {
        sessionId: 'sess-4',
        content: 'Here is a plan.',
        diag,
        metrics: { promptTokens: 11, completionTokens: 22 },
        model: 'gpt-4.1-mini',
        promptContent: 'user said hi',
      });

      expect(core.recordAssistantMessage).toHaveBeenCalledOnce();
      expect(diag.endLlmTimer).toHaveBeenCalledWith(
        { provider: 'devs-ai', model: 'gpt-4.1-mini', promptContent: 'user said hi' },
        {
          rawContent: 'Here is a plan.',
          rawLength: 'Here is a plan.'.length,
          usage: { prompt_tokens: 11, completion_tokens: 22 },
        },
      );
      expect(diag.complete).toHaveBeenCalledWith('success');
    });

    it('uses unknown model / null promptContent / null usage when metrics are absent', async () => {
      const diag = {
        endLlmTimer: vi.fn(),
        complete: vi.fn(async () => null),
      };

      await recordCoachReply(USER, {
        sessionId: 'sess-5',
        content: 'ok',
        diag,
        metrics: {},
      });

      expect(diag.endLlmTimer).toHaveBeenCalledWith(
        { provider: 'devs-ai', model: 'unknown', promptContent: null },
        { rawContent: 'ok', rawLength: 2, usage: null },
      );
      expect(diag.complete).toHaveBeenCalledWith('success');
    });

    it('surfaces diag.complete failures as AimError', async () => {
      const diag = {
        endLlmTimer: vi.fn(),
        complete: vi.fn(async () => {
          throw new Error('diag persist failed');
        }),
      };

      await expect(
        recordCoachReply(USER, {
          sessionId: 'sess-6',
          content: 'reply',
          diag,
          metrics: { promptTokens: 1, completionTokens: 1 },
        }),
      ).rejects.toMatchObject({ name: 'AimError', message: 'diag persist failed' });
    });
  });

  describe('injectCoachContext', () => {
    it('records a non-triggering user turn wrapped in a provenance context block', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));

      await injectCoachContext(USER, 'sess-7', 'GOAL: run a 5k', { source: 'pack-v2', version: 3 });

      expect(authArg()).toEqual(EXPECTED_AUTH);
      expect(core.createChatMessage).toHaveBeenCalledOnce();
      const arg = core.createChatMessage.mock.calls[0]?.[0];
      expect(arg).toBeDefined();
      expect(arg?.chat_session_id).toBe('sess-7');
      expect(arg?.role).toBe('user');
      expect(arg?.content).toContain('<context source="pack-v2" version="3" built_at="2026-07-18T12:00:00.000Z">');
      expect(arg?.content).toContain('GOAL: run a 5k');
      expect(arg?.content).toContain('</context>');
      // Must not call the model ΓÇö only history write.
      expect(core.sendChatMessage).not.toHaveBeenCalled();
    });
  });
});
