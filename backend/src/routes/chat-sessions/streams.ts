/**
 * Tool-outputs / cancel / reconnect — the auxiliary streaming routes.
 * Split from routes/chat-sessions.ts (2026-08-04); handlers verbatim.
 */
import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  submitChatToolOutputs,
  cancelV2ChatResponse,
  reconnectV2ChatStream,
  updateV2ProviderMetadata,
  recordAssistantMessage,
} from '../../ai-manager/index.ts';
import { acquireSessionLock, releaseSessionLock } from '../../models/chat-sessions.ts';
import { errorMessage } from '../../lib/error-message.ts';
import { safeClientError } from '../../lib/safe-error.ts';
import type { PatchedResponse } from '../../types.ts';
import { validateBody } from '../../middleware/validate.ts';
import { toolOutputsSchema, reconnectStreamSchema } from '../../schemas/chat-sessions.ts';
import { createSseLineBuffer, pushSseChunk } from '../../services/sse-line-reader.ts';
import { MAX_SSE_DURATION_MS, authorizeSessionAccess } from './shared.ts';

const router = Router();
/* ================================================================
   POST /api/chat-sessions/:id/tool-outputs
   Submit tool outputs (e.g. after OAuth completion or user input).
   Returns an SSE stream as the AI continues the conversation.
   Body: { systemMessageId, outputs: [{ toolCallId, output }] }
   ================================================================ */

router.post('/:id/tool-outputs', validateBody(toolOutputsSchema), async (req: Request, res: Response) => {
  let lockMessageId: string | null = null;
  try {
    const { systemMessageId, outputs } = req.body;

    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;

    const candidateLockId = randomUUID();
    const acquired = await acquireSessionLock(req.params.id as string, candidateLockId);
    if (!acquired) {
      return res.status(409).json({
        error:
          'Session is currently processing another message. Wait for the current stream to complete before submitting tool outputs.',
      });
    }
    lockMessageId = candidateLockId;

    const { response: sseResponse, sessionId } = await submitChatToolOutputs(
      req.params.id as string,
      systemMessageId,
      outputs,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Chat-Session-Id', sessionId);

    const upstreamAbort = (sseResponse as PatchedResponse)._abortController;

    const sseTimeout = setTimeout(() => {
      upstreamAbort?.abort();
      res.write('event: timeout\ndata: {"error":"Connection timeout"}\n\n');
      res.end();
    }, MAX_SSE_DURATION_MS);

    const t0 = Date.now();
    let fullContent = '';

    const body = sseResponse.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      clearTimeout(sseTimeout);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    req.on('close', () => {
      upstreamAbort?.abort();
    });

    const reader = body.getReader();
    const decoder = new TextDecoder();

    const lineBuffer = createSseLineBuffer();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        const lines = pushSseChunk(lineBuffer, chunk);
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'message.complete') {
              const completeText = parsed.text ?? parsed.content ?? parsed.delta ?? '';
              if (completeText && !fullContent) fullContent = completeText;
              continue;
            }
            const delta =
              parsed.choices?.[0]?.delta?.content ||
              parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
              (typeof parsed.content === 'object' ? parsed.content?.text : parsed.content) ||
              parsed.text ||
              parsed.delta ||
              '';
            if (delta && typeof delta === 'string') fullContent += delta;
          } catch {
            /* non-JSON SSE line */
          }
        }
      }
    } finally {
      clearTimeout(sseTimeout);
      const abortTimer = (sseResponse as PatchedResponse)._abortTimer;
      if (abortTimer) clearTimeout(abortTimer);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    const durationMs = Date.now() - t0;
    if (fullContent) {
      setImmediate(async () => {
        try {
          await recordAssistantMessage(sessionId, fullContent, { durationMs });
        } catch (err) {
          console.warn('[chat-sessions/tool-outputs] Failed to record assistant message:', errorMessage(err));
        }
      });
    }
  } catch (err) {
    console.error('[POST /chat-sessions/:id/tool-outputs]', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to submit tool outputs' });
    }
    res.end();
  } finally {
    if (lockMessageId) {
      releaseSessionLock(req.params.id as string, lockMessageId).catch((err) => {
        console.warn('[chat-sessions/tool-outputs] Failed to release session lock:', errorMessage(err));
      });
    }
  }
});

/* ================================================================
   POST /api/chat-sessions/:id/cancel
   Cancel an in-flight Devs.ai v2 response (devs-ai-v2 sessions only).
   ================================================================ */

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;
    if (authorized.provider_type !== 'devs-ai-v2') {
      return res.status(400).json({ error: 'cancel is only supported for devs-ai-v2 chat sessions' });
    }
    const result = await cancelV2ChatResponse(req.params.id as string);
    return res.json(result);
  } catch (err) {
    console.error('[POST /chat-sessions/:id/cancel]', err);
    return res.status(400).json({ error: safeClientError(err, 'Failed to cancel v2 response') });
  }
});

/* ================================================================
   POST /api/chat-sessions/:id/reconnect-stream
   Reconnect to a Devs.ai v2 response stream after disconnect (devs-ai-v2 only).
   Body: { lastSequence?: number } — defaults to session provider_metadata.last_sequence.
   Returns SSE stream in the same shape as POST /messages.
   ================================================================ */

router.post('/:id/reconnect-stream', validateBody(reconnectStreamSchema), async (req: Request, res: Response) => {
  let lockMessageId: string | null = null;
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;
    if (authorized.provider_type !== 'devs-ai-v2') {
      return res.status(400).json({ error: 'stream reconnect is only supported for devs-ai-v2 chat sessions' });
    }

    const candidateLockId = randomUUID();
    const acquired = await acquireSessionLock(req.params.id as string, candidateLockId);
    if (!acquired) {
      return res.status(409).json({
        error:
          'Session is currently processing another message. Wait for the current stream to complete before reconnecting.',
      });
    }
    lockMessageId = candidateLockId;

    const { lastSequence } = req.body as { lastSequence?: number };
    const { response: sseResponse, sessionId } = await reconnectV2ChatStream(req.params.id as string, {
      lastSequence,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Chat-Session-Id', sessionId);

    const upstreamAbort = (sseResponse as PatchedResponse)._abortController;
    const sseTimeout = setTimeout(() => {
      upstreamAbort?.abort();
      res.write('event: timeout\ndata: {"error":"Connection timeout"}\n\n');
      res.end();
    }, MAX_SSE_DURATION_MS);

    const body = sseResponse.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      clearTimeout(sseTimeout);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    req.on('close', () => {
      upstreamAbort?.abort();
    });

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const lineBuffer = createSseLineBuffer();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        const lines = pushSseChunk(lineBuffer, chunk);
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'message.complete' && parsed.responseId) {
              updateV2ProviderMetadata(sessionId, {
                previous_response_id: parsed.responseId as string,
                conversation_id: (parsed.conversationId as string) || undefined,
                last_sequence: parsed.lastSequence != null ? Number(parsed.lastSequence) : undefined,
              }).catch((metaErr) =>
                console.warn(
                  '[chat-sessions/reconnect-stream] Failed to persist provider_metadata:',
                  errorMessage(metaErr),
                ),
              );
            }
          } catch {
            /* non-JSON SSE line */
          }
        }
      }
    } finally {
      clearTimeout(sseTimeout);
      const abortTimer = (sseResponse as PatchedResponse)._abortTimer;
      if (abortTimer) clearTimeout(abortTimer);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[POST /chat-sessions/:id/reconnect-stream]', err);
    if (!res.headersSent) {
      return res.status(400).json({ error: safeClientError(err, 'Failed to reconnect v2 stream') });
    }
    res.end();
  } finally {
    if (lockMessageId) {
      releaseSessionLock(req.params.id as string, lockMessageId).catch((err) => {
        console.warn('[chat-sessions/reconnect-stream] Failed to release session lock:', errorMessage(err));
      });
    }
  }
});

/* ================================================================
   GET /api/chat-sessions
   List sessions with optional filters.
   Query: ?userId=&aiProfileId=&workflowId=&status=&callingApplication=
   ================================================================ */

export { router as streamsRouter };
