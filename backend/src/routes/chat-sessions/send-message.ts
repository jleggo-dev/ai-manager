/**
 * POST /:id/messages — the SSE monster, in its own room.
 * Split from routes/chat-sessions.ts (2026-08-04); decomposed into named phases to meet the
 * 150-line function cap without changing behaviour.
 */
import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  sendChatMessage,
  updateV2ProviderMetadata,
  recordAssistantMessage,
  extractAndAccumulateOutputs,
  getToolJobsFromProfile,
} from '../../ai-manager/index.ts';
import {
  getChatSession as dbGetChatSession,
  acquireSessionLock,
  releaseSessionLock,
  mergeWorkflowVariables,
} from '../../models/chat-sessions.ts';
import { DiagnosticSession } from '../../services/ai-diagnostics.ts';
import { getProcessingJob } from '../../models/processing-jobs.ts';
import { applyFormattingRules } from '../../services/formatting-rules.ts';
import { errorMessage } from '../../lib/error-message.ts';
import { rootKeyFromPath } from '../../lib/json-path.ts';
import type { PatchedResponse } from '../../types.ts';
import { validateBody } from '../../middleware/validate.ts';
import { sendMessageSchema } from '../../schemas/chat-sessions.ts';
import { fireInternalTriggers } from '../../services/internal-triggers.ts';
import type { ChatSessionRow, FormattingRule } from '../../types.ts';
import type { PendingToolCall } from '../../services/tool-jobs.ts';
import {
  ingestParsedSseEvent,
  selectUnfulfilledToolCalls,
  type ChatStreamAccum,
} from '../../services/v2-stream-events.ts';
import { createSseLineBuffer, pushSseChunk } from '../../services/sse-line-reader.ts';
import { STREAMING_SAFE_RULES, authorizeSessionAccess, beginSse, runInternalToolJobLoop } from './shared.ts';

/** Resolve the full + streaming-safe formatting rule sets for this message. Non-fatal on any
 *  failure — streaming without rules beats not streaming. */
async function resolveMessageRules(
  sessionId: string,
  stepFormattingRules: FormattingRule[] | null | undefined,
): Promise<{ allRules: FormattingRule[]; streamRules: FormattingRule[] }> {
  let allRules: FormattingRule[] = [];
  let streamRules: FormattingRule[] = [];
  try {
    const rawRules =
      stepFormattingRules ||
      (await (async () => {
        const session = await dbGetChatSession(sessionId);
        if (!session?.processing_job_id) return [];
        const job = await getProcessingJob(session.processing_job_id);
        return job?.config?.formattingRules || [];
      })());
    allRules = (rawRules || []) as FormattingRule[];
    streamRules = allRules.filter((r: FormattingRule) => STREAMING_SAFE_RULES.has(r.type));
  } catch (_err) {
    /* non-fatal — stream without rules */
  }
  return { allRules, streamRules };
}

/** Apply streaming-safe rules to the content deltas inside SSE data lines, leaving every other
 *  line untouched. Pure: lines in, wire-format string out. */
function rewriteSseDataLines(lines: string[], streamRules: FormattingRule[]): string {
  const outputLines: string[] = [];
  for (const raw of lines) {
    if (!raw.startsWith('data: ')) {
      outputLines.push(raw);
      continue;
    }
    const dataStr = raw.slice(6).trim();
    if (dataStr === '[DONE]') {
      outputLines.push(raw);
      continue;
    }
    try {
      const parsed = JSON.parse(dataStr);
      const contentPath =
        parsed.choices?.[0]?.delta?.content != null
          ? 'choices'
          : parsed.candidates?.[0]?.content?.parts?.[0]?.text != null
            ? 'candidates'
            : typeof parsed.content === 'object' && parsed.content?.text != null
              ? 'contentObj'
              : typeof parsed.content === 'string'
                ? 'contentStr'
                : null;
      if (contentPath) {
        let text: string;
        if (contentPath === 'choices') text = parsed.choices[0].delta.content;
        else if (contentPath === 'candidates') text = parsed.candidates[0].content.parts[0].text;
        else if (contentPath === 'contentObj') text = parsed.content.text;
        else text = parsed.content;
        const { formatted } = applyFormattingRules(text, streamRules);
        if (contentPath === 'choices') parsed.choices[0].delta.content = formatted;
        else if (contentPath === 'candidates') parsed.candidates[0].content.parts[0].text = formatted;
        else if (contentPath === 'contentObj') parsed.content.text = formatted;
        else parsed.content = formatted;
        outputLines.push(`data: ${JSON.stringify(parsed)}`);
      } else {
        outputLines.push(raw);
      }
    } catch {
      outputLines.push(raw);
    }
  }
  return outputLines.join('\n');
}

interface ScanContext {
  res: Response;
  streamAccum: ChatStreamAccum;
  ingestOpts: Parameters<typeof ingestParsedSseEvent>[2];
  sseEventLog: string[];
}

/** Walk a chunk's data lines: forward tool-produced file events, ingest everything else into the
 *  accumulators/tool-call state, and keep a short debug log of event shapes. */
function scanSseLines(lines: string[], ctx: ScanContext): void {
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (dataStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataStr) as Record<string, unknown>;

      if (ctx.sseEventLog.length < 20) {
        const topKeys = Object.keys(parsed).slice(0, 8).join(',');
        ctx.sseEventLog.push(`type=${parsed.type ?? '(none)'} keys=[${topKeys}]`);
      }

      if (parsed.type === 'tool.message') {
        try {
          const output = typeof parsed.output === 'string' ? JSON.parse(parsed.output) : parsed.output;
          if (Array.isArray(output?.files) && output.files.length > 0) {
            const fileEvent = { type: 'files', files: output.files };
            ctx.res.write(`data: ${JSON.stringify(fileEvent)}\n\n`);
          }
        } catch {
          /* output may not be JSON — ignore */
        }
        continue;
      }

      ingestParsedSseEvent(parsed, ctx.streamAccum, ctx.ingestOpts);
    } catch {
      /* SSE lines may not be valid JSON (e.g. event names) */
    }
  }
}

/** rawContent = what the client received (streaming-safe rules only); formattedContent = the full
 *  rule chain when it differs (drives workflows + the formatted_response event). */
function deriveContents(args: {
  streamAccum: ChatStreamAccum;
  allRules: FormattingRule[];
  streamRules: FormattingRule[];
  hasStreamRules: boolean;
  hasPostStreamRules: boolean;
  stepOutputMappings: Record<string, string> | null | undefined;
  expectedResponseFormat: string | null | undefined;
}): { rawContent: string; formattedContent: string | null } {
  const { streamAccum, allRules, streamRules, hasStreamRules, hasPostStreamRules } = args;
  const rawContent = hasStreamRules
    ? applyFormattingRules(streamAccum.fullContent, streamRules).formatted
    : streamAccum.fullContent;

  let formattedContent: string | null = null;
  if (hasPostStreamRules) {
    let postStreamRules = [...allRules];
    if (args.stepOutputMappings && args.expectedResponseFormat === 'json') {
      const expectedKeys = [...new Set(Object.keys(args.stepOutputMappings).map(rootKeyFromPath))];
      postStreamRules = postStreamRules.map((r) =>
        r.type === 'trim-to-json' ? { ...r, options: { ...(r.options || {}), expectedKeys } } : r,
      );
    }
    const result = applyFormattingRules(streamAccum.fullContent, postStreamRules);
    if (result.formatted !== rawContent) {
      formattedContent = result.formatted;
    }
  }
  return { rawContent, formattedContent };
}

interface FinalizeContext {
  sessionId: string;
  rawContent: string;
  formattedContent: string | null;
  durationMs: number;
  firstTokenMs: number | null;
  totalTokens: number | null;
  streamAccum: ChatStreamAccum;
  stepOutputMappings: Record<string, string> | null | undefined;
  workflowStepId: string | null | undefined;
  resolvedStepKey: string | null | undefined;
  resolvedMessage: string | null;
  chatSessionRow: ChatSessionRow;
  diag: DiagnosticSession | null;
  providerType: string;
  message: string | null | undefined;
  ruleSetKey: string | null | undefined;
  stepKey: string | null | undefined;
  streamRulesCount: number;
  allRulesCount: number;
  hasAnyRules: boolean;
}

/** Everything that happens AFTER the stream closed and [DONE] was written: persist the assistant
 *  message, feed workflow variables/triggers, and complete diagnostics. Runs off the request path
 *  (setImmediate at the call site); every step is non-blocking and individually best-effort. */
async function finalizeAfterStream(ctx: FinalizeContext): Promise<void> {
  const { sessionId, rawContent, formattedContent, streamAccum } = ctx;
  try {
    await recordAssistantMessage(sessionId, rawContent, {
      durationMs: ctx.durationMs,
      firstTokenMs: ctx.firstTokenMs,
      promptTokens: streamAccum.promptTokens,
      completionTokens: streamAccum.completionTokens,
    });

    const contentForWorkflow = formattedContent || rawContent;

    if (ctx.stepOutputMappings) {
      try {
        await extractAndAccumulateOutputs(sessionId, contentForWorkflow, ctx.stepOutputMappings);
      } catch (extractErr) {
        console.warn('[chat-sessions] Non-blocking output extraction failed:', errorMessage(extractErr));
      }
    }

    if (ctx.workflowStepId && ctx.resolvedStepKey) {
      try {
        await mergeWorkflowVariables(sessionId, {
          [`${ctx.resolvedStepKey}.prompt`]: ctx.resolvedMessage,
          [`${ctx.resolvedStepKey}.response`]: contentForWorkflow,
        });
        await fireInternalTriggers('workflow.step.completed', {
          sessionId,
          stepKey: ctx.resolvedStepKey,
          callingApplication: ctx.chatSessionRow.calling_application,
          userId: ctx.chatSessionRow.user_id,
        });
      } catch (autoErr) {
        console.warn('[chat-sessions] Non-blocking auto-capture failed:', errorMessage(autoErr));
      }
    }

    await fireInternalTriggers('session.message.created', {
      sessionId,
      callingApplication: ctx.chatSessionRow.calling_application,
      userId: ctx.chatSessionRow.user_id,
    });
  } catch (err) {
    console.warn('[chat-sessions] Failed to record assistant message:', errorMessage(err));
  }

  if (ctx.diag) {
    try {
      ctx.diag.endLlmTimer(
        {
          provider: ctx.providerType,
          model: streamAccum.streamModel || 'unknown',
          promptContent: ctx.resolvedMessage || ctx.message || null,
        },
        {
          rawContent,
          rawLength: streamAccum.fullContent.length,
          formattedContent: formattedContent || undefined,
          usage:
            streamAccum.promptTokens || streamAccum.completionTokens
              ? {
                  prompt_tokens: streamAccum.promptTokens,
                  completion_tokens: streamAccum.completionTokens,
                  total_tokens: ctx.totalTokens,
                }
              : null,
        },
      );
      if (ctx.hasAnyRules) {
        ctx.diag.addMetadata('streamingRulesApplied', ctx.streamRulesCount);
        ctx.diag.addMetadata('postStreamRulesApplied', ctx.allRulesCount - ctx.streamRulesCount);
        ctx.diag.addMetadata('formattedResponseSent', !!formattedContent);
      }
      ctx.diag.addMetadata('durationMs', ctx.durationMs);
      ctx.diag.addMetadata('firstTokenMs', ctx.firstTokenMs);
      ctx.diag.addMetadata('promptTokens', streamAccum.promptTokens);
      ctx.diag.addMetadata('completionTokens', streamAccum.completionTokens);
      ctx.diag.addMetadata('totalTokens', ctx.totalTokens);
      ctx.diag.addMetadata('streamModel', streamAccum.streamModel);
      ctx.diag.addMetadata('contentLength', rawContent.length);
      ctx.diag.addMetadata('ruleSetKey', ctx.ruleSetKey || null);
      ctx.diag.addMetadata('stepKey', ctx.stepKey || null);
      await ctx.diag.complete('success');
    } catch (diagErr) {
      console.warn('[chat-sessions] Non-blocking diagnostics write failed:', errorMessage(diagErr));
    }
  }
}

interface PumpArgs {
  body: ReadableStream<Uint8Array>;
  res: Response;
  hasStreamRules: boolean;
  streamRules: FormattingRule[];
  streamAccum: ChatStreamAccum;
  ingestOpts: ScanContext['ingestOpts'];
  t0: number;
}

/** Drain the upstream SSE body into the client: rewrite deltas when streaming rules apply, scan
 *  every line into the accumulators/tool state, and report time-to-first-token. The caller owns
 *  the timers; this owns only the read loop. */
async function pumpUpstream(args: PumpArgs): Promise<{ firstTokenMs: number | null }> {
  const { body, res, hasStreamRules, streamRules, streamAccum, ingestOpts, t0 } = args;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const lineBuffer = createSseLineBuffer();
  let firstTokenMs: number | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    if (firstTokenMs === null) firstTokenMs = Date.now() - t0;

    const lines = pushSseChunk(lineBuffer, chunk);

    if (!hasStreamRules) {
      res.write(chunk);
    } else {
      res.write(rewriteSseDataLines(lines, streamRules));
    }

    const sseEventLog: string[] = [];
    scanSseLines(lines, { res, streamAccum, ingestOpts, sseEventLog });
    if (sseEventLog.length > 0 && !streamAccum.fullContent) {
      console.warn('[SSE debug] Stream ended with empty fullContent. Events seen:', sseEventLog.join(' | '));
    }
  }
  return { firstTokenMs };
}

interface StreamState {
  internalToolNames: Set<string>;
  pendingInternalToolCalls: PendingToolCall[];
  fulfilledCallIds: Set<string>;
  pendingSystemMessageId: string | undefined;
  pendingV2ResponseId: string | undefined;
  ingestOpts: ScanContext['ingestOpts'];
}

/** The per-stream mutable state and the ingest callbacks that write into it — one object so the
 *  handler, the pump, and the tool loop all see the same picture. */
function initStreamState(chatSessionRow: ChatSessionRow, sessionId: string): StreamState {
  const st: StreamState = {
    internalToolNames: new Set(getToolJobsFromProfile(chatSessionRow.ai_profile).map((t) => t.exposeAs)),
    pendingInternalToolCalls: [],
    fulfilledCallIds: new Set<string>(),
    pendingSystemMessageId: undefined,
    pendingV2ResponseId: undefined,
    ingestOpts: undefined as unknown as ScanContext['ingestOpts'],
  };
  st.ingestOpts = {
    isV2Session: chatSessionRow.provider_type === 'devs-ai-v2',
    internalToolNames: st.internalToolNames,
    pendingInternalToolCalls: st.pendingInternalToolCalls,
    fulfilledCallIds: st.fulfilledCallIds,
    onV2Metadata: (patch: { previous_response_id?: string; conversation_id?: string; last_sequence?: number }) => {
      updateV2ProviderMetadata(sessionId, patch).catch((err) =>
        console.warn('[chat-sessions] Failed to persist v2 provider_metadata:', errorMessage(err)),
      );
      if (patch.previous_response_id) st.pendingV2ResponseId = patch.previous_response_id;
    },
    onSystemMessageId: (id: string) => {
      st.pendingSystemMessageId = id;
    },
  };
  return st;
}

/** One in-flight message per session: acquire the lock or answer 409. Returns the lock id. */
async function acquireMessageLock(sessionId: string, res: Response): Promise<string | null> {
  const candidateLockId = randomUUID();
  const acquired = await acquireSessionLock(sessionId, candidateLockId);
  if (!acquired) {
    res.status(409).json({
      error:
        'Session is currently processing another message. Wait for the current stream to complete (data: [DONE]) before sending again.',
    });
    return null;
  }
  return candidateLockId;
}

const router = Router();
router.post('/:id/messages', validateBody(sendMessageSchema), async (req: Request, res: Response) => {
  let diag: DiagnosticSession | null = null;
  let lockMessageId: string | null = null;
  try {
    const { message, attachments, stepKey, ruleSetKey, variables } = req.body;

    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;

    lockMessageId = await acquireMessageLock(req.params.id as string, res);
    if (!lockMessageId) return;

    const {
      response: sseResponse,
      sessionId,
      workflowStepId,
      stepKey: resolvedStepKey,
      resolvedMessage,
      stepFormattingRules,
      stepOutputMappings,
      diagnosticSession,
      expectedResponseFormat,
    } = await sendChatMessage(req.params.id as string, message || null, {
      attachments: attachments || [],
      stepKey,
      ruleSetKey,
      variables,
    });
    diag = diagnosticSession;

    const { allRules, streamRules } = await resolveMessageRules(req.params.id as string, stepFormattingRules);
    const hasStreamRules = streamRules.length > 0;
    const hasPostStreamRules = allRules.length > streamRules.length;

    const { sseTimeout, upstreamAbort } = beginSse(res, sessionId, sseResponse as PatchedResponse);

    const t0 = Date.now();
    const streamAccum: ChatStreamAccum = {
      fullContent: '',
      promptTokens: null,
      completionTokens: null,
      streamModel: null,
    };
    const chatSessionRow = await dbGetChatSession(req.params.id as string);
    if (!chatSessionRow) {
      clearTimeout(sseTimeout);
      return res.status(404).json({ error: 'Chat session not found' });
    }
    const st = initStreamState(chatSessionRow, sessionId);
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

    let firstTokenMs: number | null = null;
    try {
      ({ firstTokenMs } = await pumpUpstream({
        body,
        res,
        hasStreamRules,
        streamRules,
        streamAccum,
        ingestOpts: st.ingestOpts,
        t0,
      }));
    } finally {
      clearTimeout(sseTimeout);
      const abortTimer = (sseResponse as PatchedResponse)._abortTimer;
      if (abortTimer) clearTimeout(abortTimer);
    }

    if (selectUnfulfilledToolCalls(st.pendingInternalToolCalls, st.internalToolNames, new Set()).length > 0) {
      await runInternalToolJobLoop({
        res,
        decoder: new TextDecoder(),
        sessionId,
        isV2Session: chatSessionRow.provider_type === 'devs-ai-v2',
        chatSessionRow,
        accum: streamAccum,
        pendingInternalToolCalls: st.pendingInternalToolCalls,
        internalToolNames: st.internalToolNames,
        pendingSystemMessageId: st.pendingSystemMessageId,
        pendingV2ResponseId: st.pendingV2ResponseId,
      });
    }

    const { rawContent, formattedContent } = deriveContents({
      streamAccum,
      allRules,
      streamRules,
      hasStreamRules,
      hasPostStreamRules,
      stepOutputMappings,
      expectedResponseFormat,
    });

    const totalTokens =
      streamAccum.promptTokens || streamAccum.completionTokens
        ? (streamAccum.promptTokens || 0) + (streamAccum.completionTokens || 0)
        : null;
    if (streamAccum.promptTokens || streamAccum.completionTokens) {
      res.write(
        `data: ${JSON.stringify({ type: 'usage', prompt_tokens: streamAccum.promptTokens, completion_tokens: streamAccum.completionTokens, total_tokens: totalTokens, model: streamAccum.streamModel })}\n\n`,
      );
    }

    if (formattedContent) {
      res.write(`data: ${JSON.stringify({ type: 'formatted_response', content: formattedContent })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    const durationMs = Date.now() - t0;
    const finalizeCtx: FinalizeContext = {
      sessionId,
      rawContent,
      formattedContent,
      durationMs,
      firstTokenMs,
      totalTokens,
      streamAccum,
      stepOutputMappings,
      workflowStepId,
      resolvedStepKey,
      resolvedMessage,
      chatSessionRow,
      diag,
      providerType: authorized?.provider_type || 'unknown',
      message,
      ruleSetKey,
      stepKey,
      streamRulesCount: streamRules.length,
      allRulesCount: allRules.length,
      hasAnyRules: hasStreamRules || hasPostStreamRules,
    };
    setImmediate(() => void finalizeAfterStream(finalizeCtx));
  } catch (err) {
    if (diag) {
      diag.complete('error', errorMessage(err)).catch(() => {});
    }
    console.error('[POST /chat-sessions/:id/messages]', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to send chat message' });
    }
    res.end();
  } finally {
    if (lockMessageId) {
      releaseSessionLock(req.params.id as string, lockMessageId).catch((err) => {
        console.warn('[chat-sessions] Failed to release session lock:', errorMessage(err));
      });
    }
  }
});

export { router as sendMessageRouter };
