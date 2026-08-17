/**
 * Chat-sessions shared seams — the pieces every route module leans on.
 * Split from the 1190-line routes/chat-sessions.ts (2026-08-04); behaviour identical.
 */
import { Response } from 'express';
import {
  submitChatToolOutputs,
  submitV2ToolOutputs,
  updateV2ProviderMetadata,
  fulfillPendingToolJobCalls,
} from '../../ai-manager/index.ts';
import { getChatSession as dbGetChatSession } from '../../models/chat-sessions.ts';
import { getAuthContext } from '../../db/tenant.ts';
import { errorMessage } from '../../lib/error-message.ts';
import type { ChatSessionRow, PatchedResponse } from '../../types.ts';
import type { PendingToolCall } from '../../services/tool-jobs.ts';
import {
  ingestParsedSseEvent,
  selectUnfulfilledToolCalls,
  type ChatStreamAccum,
} from '../../services/v2-stream-events.ts';
import { createSseLineBuffer, pushSseChunk } from '../../services/sse-line-reader.ts';

export const MAX_SSE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export const STREAMING_SAFE_RULES = new Set(['remove-footnote-tags', 'remove-reasoning']);

export const MAX_TOOL_ROUNDS = 5;

export async function runInternalToolJobLoop(options: {
  res: Response;
  decoder: TextDecoder;
  sessionId: string;
  isV2Session: boolean;
  chatSessionRow: ChatSessionRow;
  accum: ChatStreamAccum;
  pendingInternalToolCalls: PendingToolCall[];
  internalToolNames: Set<string>;
  pendingSystemMessageId: string | undefined;
  pendingV2ResponseId: string | undefined;
}): Promise<{ pendingSystemMessageId: string | undefined; pendingV2ResponseId: string | undefined }> {
  let { pendingSystemMessageId, pendingV2ResponseId } = options;
  const fulfilledCallIds = new Set<string>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const registeredCalls = selectUnfulfilledToolCalls(
      options.pendingInternalToolCalls,
      options.internalToolNames,
      fulfilledCallIds,
    );
    if (registeredCalls.length === 0) break;

    try {
      const outputs = await fulfillPendingToolJobCalls(
        registeredCalls,
        options.chatSessionRow.ai_profile,
        options.chatSessionRow.calling_application || 'unknown',
      );
      if (outputs.length === 0) break;

      for (const call of registeredCalls) fulfilledCallIds.add(call.toolCallId);

      const v2ResponseId =
        pendingV2ResponseId ||
        ((options.chatSessionRow.provider_metadata || {}) as { previous_response_id?: string }).previous_response_id ||
        '';
      const toolStream =
        options.isV2Session && v2ResponseId
          ? // `registeredCalls` names each output so the continuation can carry the call beside
            // its result — without that pairing the provider drops the results (#232).
            await submitV2ToolOutputs(options.sessionId, v2ResponseId, outputs, { calls: registeredCalls })
          : await submitChatToolOutputs(options.sessionId, pendingSystemMessageId || '', outputs);

      const toolBody = toolStream.response.body as ReadableStream<Uint8Array> | null;
      if (!toolBody) break;

      options.pendingInternalToolCalls.length = 0;
      const toolReader = toolBody.getReader();
      const lineBuffer = createSseLineBuffer();

      const ingestOpts = {
        isV2Session: options.isV2Session,
        internalToolNames: options.internalToolNames,
        pendingInternalToolCalls: options.pendingInternalToolCalls,
        fulfilledCallIds,
        onV2Metadata: (patch: { previous_response_id?: string; conversation_id?: string; last_sequence?: number }) => {
          updateV2ProviderMetadata(options.sessionId, patch).catch((err) =>
            console.warn('[chat-sessions] Failed to persist v2 provider_metadata:', errorMessage(err)),
          );
          if (patch.previous_response_id) pendingV2ResponseId = patch.previous_response_id;
        },
        onSystemMessageId: (id: string) => {
          pendingSystemMessageId = id;
        },
      };

      while (true) {
        const { value, done } = await toolReader.read();
        if (done) break;
        const chunk = options.decoder.decode(value, { stream: true });
        options.res.write(chunk);

        const lines = pushSseChunk(lineBuffer, chunk);
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            ingestParsedSseEvent(parsed, options.accum, ingestOpts);
          } catch {
            /* non-JSON SSE line */
          }
        }
      }

      if (
        selectUnfulfilledToolCalls(options.pendingInternalToolCalls, options.internalToolNames, fulfilledCallIds)
          .length === 0
      ) {
        break;
      }
    } catch (toolErr) {
      console.error('[chat-sessions] Internal tool-job fulfillment failed:', errorMessage(toolErr));
      options.res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage(toolErr) })}\n\n`);
      break;
    }
  }

  return { pendingSystemMessageId, pendingV2ResponseId };
}

/**
 * Verify the caller has access to a chat session.
 *
 * Read access (default): any workspace member can view any session for
 * troubleshooting. API-key callers with X-Forwarded-User-Id are still
 * scoped to their own sessions.
 *
 * Write access (requireOwnership: true): JWT users must own the session
 * (user_id === ctx.userId). API-key callers retain workspace-wide write
 * access (trusted server credentials).
 */
export async function authorizeSessionAccess(
  sessionId: string,
  res: Response,
  options: { requireOwnership?: boolean } = {},
): Promise<ChatSessionRow | null> {
  const session = await dbGetChatSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  const ctx = getAuthContext();
  if (!ctx) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  if (options.requireOwnership && ctx.mode === 'jwt') {
    if (session.user_id !== ctx.userId) {
      res.status(403).json({ error: 'You do not have access to modify this session' });
      return null;
    }
  }

  if (ctx.mode === 'api_key' && ctx.forwardedUserId) {
    if (session.user_id && session.user_id !== ctx.forwardedUserId) {
      res.status(403).json({ error: 'You do not have access to this session' });
      return null;
    }
  }

  return session;
}

/** Switch the response into SSE mode and arm the hard stream timeout. */
export function beginSse(res: Response, sessionId: string, sseResponse: PatchedResponse) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Chat-Session-Id', sessionId);

  const upstreamAbort = sseResponse._abortController;
  const sseTimeout = setTimeout(() => {
    upstreamAbort?.abort();
    res.write('event: timeout\ndata: {"error":"Connection timeout"}\n\n');
    res.end();
  }, MAX_SSE_DURATION_MS);
  return { sseTimeout, upstreamAbort };
}
