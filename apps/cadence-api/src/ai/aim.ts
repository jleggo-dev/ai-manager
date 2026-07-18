/**
 * In-process AI Admin adapter — the seam between Cadence and the AI Admin engine
 * (spec §8.1). Every call establishes Cadence's AI Admin auth context, then
 * invokes the engine imported from @ai-admin/core.
 *
 * Why api_key mode: Cadence is a trusted server, not an end user. We scope to
 * Cadence's AI Admin workspace and forward the Cadence user id so per-user
 * sessions/credentials isolate correctly. No `aim_sk_` key is needed on this
 * path — there's no HTTP boundary between Cadence and AI Admin here.
 */
import {
  runWithAuth,
  openChatSession,
  sendChatMessage,
  recordAssistantMessage,
  createChatMessage,
  executeJob,
  executeJobById,
  getProcessingJobBySlug,
  getChatHistory,
  purgeRemoteChatsForUser,
  type RequestAuthContext,
} from '@ai-admin/core';
import { cadenceConfig } from '../config.ts';

function aimContext(cadenceUserId: string): RequestAuthContext {
  return {
    mode: 'api_key',
    // Sentinel UUID: in-process consumption has no real api-key row, but the engine
    // writes apiKeyId into uuid columns (diagnostics), so it must be uuid-shaped.
    workspaceId: cadenceConfig.aim.workspaceId,
    apiKeyId: '00000000-0000-0000-0000-000000000000',
    forwardedUserId: cadenceUserId,
    callingApplicationId: null,
  };
}

/** Run any engine call inside Cadence's AI Admin auth context. */
export function withAim<T>(cadenceUserId: string, fn: () => Promise<T>): Promise<T> {
  return runWithAuth(aimContext(cadenceUserId), fn);
}

const CALLING_APP = cadenceConfig.aim.callingApplication;

/**
 * LLMs default to not knowing the current date. Every job gets `today`/`day_of_week` for
 * free — a template that doesn't reference them just ignores the extra variables (confirmed:
 * `interpolateTemplate` only reads keys its own `{{...}}` placeholders name), so this is a
 * no-op for jobs that don't need dates and removes an easy-to-forget step for ones that do.
 */
function clockVars(): { today: string; day_of_week: string } {
  const d = new Date();
  // Both derived from the SAME (UTC) calendar day — toISOString is UTC, so day_of_week must
  // be pinned to UTC too, or the two can disagree for hours around the UTC day boundary.
  return {
    today: d.toISOString().slice(0, 10),
    day_of_week: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  };
}

/** Run any templated processing job (Broker- or Coach-tier) in the user's AI Admin context. */
export function runJob(cadenceUserId: string, jobId: string, variables: Record<string, unknown>) {
  return withAim(cadenceUserId, () =>
    executeJobById(jobId, { callingApplication: CALLING_APP, variables: { ...clockVars(), ...variables } }),
  );
}

/** Run a templated job by SLUG (resolves slug→job→id internally; self-instrumented diagnostics).
 *  opts.images: https URLs (short-lived signed Storage URLs) attached as vision content parts —
 *  the engine appends them AFTER template interpolation and logs URL refs, never image bytes. */
export function runJobBySlug(
  cadenceUserId: string,
  slug: string,
  variables: Record<string, unknown>,
  opts: { images?: string[] } = {},
) {
  return withAim(cadenceUserId, () =>
    executeJob(slug, {
      callingApplication: CALLING_APP,
      variables: { ...clockVars(), ...variables },
      ...(opts.images?.length ? { images: opts.images } : {}),
    }),
  );
}

/**
 * Coach: open a streaming chat session for a user, BOUND TO THE COACH PROCESSING JOB.
 * Binding the job (not just the profile) is what (a) makes AI Admin own the persona —
 * the job's `config.systemPrompt`, editable in build rules — and (b) turns on
 * conversation diagnostics/analytics (they key off `processing_job_id`). The
 * per-user dossier is passed as `systemPrompt`; the engine appends it to the job's
 * persona. Returns AI Admin sessionId.
 */
export function openCoachSession(cadenceUserId: string, opts: { workflowSlug?: string; systemPrompt?: string } = {}) {
  return withAim(cadenceUserId, () =>
    openChatSession(cadenceConfig.aim.coachJobSlug, {
      userId: cadenceUserId,
      callingApplication: CALLING_APP,
      systemPrompt: opts.systemPrompt ?? null,
      workflowSlug: opts.workflowSlug ?? null,
    }),
  );
}

/**
 * Coach: send a message. Returns the engine result whose `.response` is a
 * standard fetch Response — its `.body` is a ReadableStream of SSE bytes we
 * relay straight to the client. (This is the in-process win: no double relay.)
 */
export function sendCoachMessage(cadenceUserId: string, sessionId: string, message: string) {
  return withAim(cadenceUserId, () => sendChatMessage(sessionId, message, {}));
}

/** Structural subset of the engine's DiagnosticSession that the coach route finalizes. */
interface CoachDiag {
  endLlmTimer(request: Record<string, unknown>, response: Record<string, unknown>): void;
  complete(status: 'success' | 'error' | 'timeout', err?: string | null): Promise<unknown>;
}

/**
 * Persist the assistant turn + finalize diagnostics AFTER the SSE stream completes —
 * the in-process equivalent of the bookkeeping the AI Admin chat route does post-stream.
 * Without this, coach replies and token/cost diagnostics never get logged in AI Admin
 * (the user turn is recorded by sendChatMessage; the assistant turn is not).
 */
export function recordCoachReply(
  cadenceUserId: string,
  args: {
    sessionId: string;
    content: string;
    diag: CoachDiag | null;
    metrics: {
      promptTokens?: number | null;
      completionTokens?: number | null;
      durationMs?: number | null;
      firstTokenMs?: number | null;
    };
    model?: string | null;
    promptContent?: string | null;
  },
) {
  return withAim(cadenceUserId, async () => {
    await recordAssistantMessage(args.sessionId, args.content, args.metrics);
    if (args.diag) {
      args.diag.endLlmTimer(
        { provider: 'devs-ai', model: args.model ?? 'unknown', promptContent: args.promptContent ?? null },
        {
          rawContent: args.content,
          rawLength: args.content.length,
          usage:
            args.metrics.promptTokens || args.metrics.completionTokens
              ? { prompt_tokens: args.metrics.promptTokens, completion_tokens: args.metrics.completionTokens }
              : null,
        },
      );
      await args.diag.complete('success');
    }
  });
}

/**
 * Inject the per-user CONTEXT (dossier) as a non-triggering chat turn — an
 * end-of-stable-prefix block, NOT part of the system prompt. P0 of the context/memory
 * architecture (docs/cadence/MEMORY-ARCHITECTURE.md): the persona stays the cacheable
 * system prefix (owned by the coach job); the dynamic context rides as a `role:'user'`
 * message wrapped with a provenance stub so an admin can see how/when it was built.
 * Unlike sendChatMessage, this does NOT call the model — it only records history.
 */
export function injectCoachContext(
  cadenceUserId: string,
  sessionId: string,
  context: string,
  provenance: { source: string; version: number } = { source: 'deterministic-dossier', version: 0 },
) {
  const block = [
    `<context source="${provenance.source}" version="${provenance.version}" built_at="${new Date().toISOString()}">`,
    context,
    '</context>',
  ].join('\n');
  return withAim(cadenceUserId, () => createChatMessage({ chat_session_id: sessionId, role: 'user', content: block }));
}

/** Read a session's stored chat history (for the full-conversation capture window). */
export function getCoachHistory(cadenceUserId: string, sessionId: string) {
  return withAim(cadenceUserId, () => getChatHistory(sessionId));
}

/** Dev X-ray: read the Coach persona (the coach job's system prompt) for the trace panel. */
export function getCoachPersona(cadenceUserId: string): Promise<string | null> {
  return withAim(cadenceUserId, async () => {
    const job = await getProcessingJobBySlug(cadenceConfig.aim.coachJobSlug);
    return (job?.config as { systemPrompt?: string } | undefined)?.systemPrompt ?? null;
  });
}

/** GDPR/CCPA: purge the user's provider-side chats. Pair with Cadence's own DB purge. */
export function purgeUserAiData(cadenceUserId: string) {
  return withAim(cadenceUserId, () => purgeRemoteChatsForUser(cadenceUserId));
}
