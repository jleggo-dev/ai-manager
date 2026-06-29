/**
 * Routes – Chat Sessions
 * -----------------------
 * REST + SSE endpoints for managing stateful AI chat conversations.
 * The POST /:id/messages endpoint returns an SSE stream.
 */

import { Router, Request, Response } from 'express';
import {
  openChatSession,
  resumeChatSession,
  sendChatMessage,
  submitChatToolOutputs,
  recordAssistantMessage,
  extractAndAccumulateOutputs,
  fulfillPendingToolJobCalls,
  getToolJobsFromProfile,
  getChatHistory,
  closeChatSession,
  resetChatSession,
  removeChatSession,
  getChatSessionFiles,
} from '../ai-manager/index.ts';
import {
  listChatSessions,
  getChatSession as dbGetChatSession,
  getChatSessionByExternalChatId as dbGetChatSessionByExternalChatId,
  getChatSessionStats,
  acquireSessionLock,
  releaseSessionLock,
  mergeWorkflowVariables,
} from '../models/chat-sessions.ts';
import { resolveCallingApplication } from '../models/calling-applications.ts';
import { randomUUID } from 'node:crypto';
import { buildChatDiagnosticSummary, DiagnosticSession } from '../services/ai-diagnostics.ts';
import { getProcessingJob } from '../models/processing-jobs.ts';
import { applyFormattingRules } from '../services/formatting-rules.ts';
import { getAuthContext } from '../db/tenant.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { errorMessage } from '../lib/error-message.ts';
import { rootKeyFromPath } from '../lib/json-path.ts';
import { safeClientError } from '../lib/safe-error.ts';
import type { PatchedResponse } from '../types.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  createChatSessionSchema,
  resumeChatSessionSchema,
  sendMessageSchema,
  toolOutputsSchema,
} from '../schemas/chat-sessions.ts';
import { fireInternalTriggers } from '../services/internal-triggers.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';
import type { ChatSessionRow, FormattingRule } from '../types.ts';
import type { PendingToolCall } from '../services/tool-jobs.ts';

const MAX_SSE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const STREAMING_SAFE_RULES = new Set(['remove-footnote-tags', 'remove-reasoning']);

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
async function authorizeSessionAccess(
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

const router = Router();

/* ================================================================
   POST /api/chat-sessions
   Create a new chat session.
   Body: { jobSlug?, aiProfileId?, workflowSlug?, workflowId?,
           userId, callingApplication, systemPrompt? }
   ================================================================ */

router.post('/', validateBody(createChatSessionSchema), async (req: Request, res: Response) => {
  try {
    const { jobSlug, jobId, aiProfileId, workflowSlug, workflowId, userId, callingApplication, systemPrompt } =
      req.body;

    const hasWorkflow = workflowSlug || workflowId;
    const identifier = jobSlug || aiProfileId;
    if (!hasWorkflow && !identifier && !jobId) {
      return res.status(400).json({ error: 'jobSlug, jobId, aiProfileId, or workflowSlug is required' });
    }

    const ctx = getAuthContext();

    const resolvedUserId = ctx?.mode === 'jwt' ? ctx.userId : userId;
    if (!resolvedUserId) return res.status(400).json({ error: 'userId is required' });

    let resolvedCallingApp: string;
    if (ctx?.mode === 'jwt') {
      resolvedCallingApp = callingApplication || 'ai-admin';
    } else {
      try {
        resolvedCallingApp = resolveCallingApplication(ctx, callingApplication);
      } catch {
        return res.status(400).json({
          error:
            'callingApplication is required. Provide it in the request body, or ask your admin to link this API key to a calling application.',
        });
      }
    }

    let resolvedIdentifier = identifier;
    if (!hasWorkflow && !resolvedIdentifier && jobId) {
      const job = await getProcessingJob(jobId);
      if (!job) return res.status(404).json({ error: `Processing job "${jobId}" not found` });
      resolvedIdentifier = job.slug;
    }

    const session = await openChatSession(resolvedIdentifier, {
      callingApplication: resolvedCallingApp,
      userId: resolvedUserId,
      systemPrompt: systemPrompt || null,
      workflowSlug: workflowSlug || null,
      workflowId: workflowId || null,
    });

    return res.status(201).json(stripSecrets(session));
  } catch (err) {
    console.error('[POST /chat-sessions]', err);
    const msg = errorMessage(err);
    if (msg.includes('requires personal credentials')) {
      return res.status(403).json({ error: safeClientError(err, 'This profile requires personal credentials.') });
    }
    if (msg.includes('not found') || msg.includes('not active')) {
      return res.status(404).json({ error: safeClientError(err, 'The requested resource was not found.') });
    }
    if (msg.includes('Could not resolve AI profile')) {
      return res.status(422).json({ error: 'Could not resolve AI profile for this request.' });
    }
    return res.status(500).json({ error: 'Failed to create chat session' });
  }
});

/* ================================================================
   POST /api/chat-sessions/resume
   Resume a previously opened streaming chat session and continue it.
   Body: { sessionId? | externalChatId?, fallbackToLocal? }
   Returns JSON (session metadata + restored local history). The caller
   then continues with POST /:id/messages (SSE).
   ================================================================ */

router.post('/resume', validateBody(resumeChatSessionSchema), async (req: Request, res: Response) => {
  try {
    const { sessionId, externalChatId, fallbackToLocal } = req.body;

    /* Resolve to a concrete session first so we can authorize ownership.
       Lookup is tenant-scoped, so a cross-tenant id resolves to 404. */
    let target = sessionId ? await dbGetChatSession(sessionId) : null;
    if (!target && externalChatId) target = await dbGetChatSessionByExternalChatId(externalChatId);
    if (!target) return res.status(404).json({ error: 'Session not found' });

    const authorized = await authorizeSessionAccess(target.id, res, { requireOwnership: true });
    if (!authorized) return;

    const result = await resumeChatSession({
      sessionId: target.id,
      fallbackToLocal: fallbackToLocal === true,
    });
    return res.json(stripSecrets(result));
  } catch (err) {
    console.error('[POST /chat-sessions/resume]', err);
    const msg = errorMessage(err);
    /* Check 'no longer available' before 'not found' — the remote-gone error
       embeds the provider's own "...not found" text, which would otherwise be
       misclassified as a 404. */
    if (msg.includes('no longer available')) {
      return res.status(409).json({
        error: safeClientError(err, 'The remote chat is no longer available on the provider.'),
      });
    }
    if (msg.includes('personal credentials')) {
      return res.status(403).json({ error: safeClientError(err, 'This session requires personal credentials.') });
    }
    if (msg.includes('not found')) {
      return res.status(404).json({ error: safeClientError(err, 'Session not found') });
    }
    return res.status(500).json({ error: 'Failed to resume chat session' });
  }
});

/* ================================================================
   POST /api/chat-sessions/:id/messages
   Send a message — returns SSE stream.
   Body (mutually exclusive trigger):
     { message }                         — free-form text
     { stepKey, variables? }             — workflow step invocation
     { ruleSetKey, variables? }          — rule set invocation (job's config.ruleSets)
   Plus optional: { attachments?: [...] }
   ================================================================ */

router.post('/:id/messages', validateBody(sendMessageSchema), async (req: Request, res: Response) => {
  let diag: DiagnosticSession | null = null;
  let lockMessageId: string | null = null;
  try {
    const { message, attachments, stepKey, ruleSetKey, variables } = req.body;

    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;

    const candidateLockId = randomUUID();
    const acquired = await acquireSessionLock(req.params.id as string, candidateLockId);
    if (!acquired) {
      return res.status(409).json({
        error:
          'Session is currently processing another message. Wait for the current stream to complete (data: [DONE]) before sending again.',
      });
    }
    lockMessageId = candidateLockId;

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

    /* Look up formatting rules — keep the full set for post-stream and
       filter to streaming-safe for real-time chunk processing */
    let allRules: FormattingRule[] = [];
    let streamRules: FormattingRule[] = [];
    try {
      const rawRules =
        stepFormattingRules ||
        (await (async () => {
          const session = await dbGetChatSession(req.params.id as string);
          if (!session?.processing_job_id) return [];
          const job = await getProcessingJob(session.processing_job_id);
          return job?.config?.formattingRules || [];
        })());
      allRules = (rawRules || []) as FormattingRule[];
      streamRules = allRules.filter((r: FormattingRule) => STREAMING_SAFE_RULES.has(r.type));
    } catch (_err) {
      /* non-fatal — stream without rules */
    }
    const hasStreamRules = streamRules.length > 0;
    const hasPostStreamRules = allRules.length > streamRules.length;

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
    let firstTokenMs: number | null = null;
    let fullContent = '';
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let streamModel: string | null = null;
    const chatSessionRow = await dbGetChatSession(req.params.id as string);
    if (!chatSessionRow) {
      clearTimeout(sseTimeout);
      return res.status(404).json({ error: 'Chat session not found' });
    }
    const internalToolNames = new Set(getToolJobsFromProfile(chatSessionRow.ai_profile).map((t) => t.exposeAs));
    const pendingInternalToolCalls: PendingToolCall[] = [];
    let pendingSystemMessageId: string | undefined;

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

    let lineBuffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0;

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        if (!hasStreamRules) {
          res.write(chunk);
        } else {
          /* Rewrite SSE data lines, applying streaming-safe rules to content deltas */
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
          res.write(outputLines.join('\n'));
        }

        const sseEventLog: string[] = [];
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);

            if (sseEventLog.length < 20) {
              const topKeys = Object.keys(parsed).slice(0, 8).join(',');
              sseEventLog.push(`type=${parsed.type ?? '(none)'} keys=[${topKeys}]`);
            }

            if (parsed.type === 'message.complete') {
              promptTokens = parsed.inputTokens ?? parsed.estimatedInputTokens ?? null;
              completionTokens = parsed.outputTokens ?? parsed.estimatedOutputTokens ?? null;
              if (parsed.modelId) streamModel = parsed.modelId;
              const completeText = parsed.text ?? parsed.content ?? parsed.delta ?? '';
              if (completeText && !fullContent) fullContent = completeText;
              continue;
            }

            /* Forward tool.call events so calling apps can handle
               OAuth prompts, user input requests, and MCP interactions.
               Internal tool-jobs are queued for server-side fulfillment. */
            if (parsed.type === 'tool.call' || parsed.type === 'tool_calls') {
              const toolName = parsed.name as string | undefined;
              const toolCallId = parsed.toolCallId as string | undefined;
              if (toolName && toolCallId && internalToolNames.has(toolName)) {
                pendingInternalToolCalls.push({
                  toolCallId,
                  name: toolName,
                  arguments: parsed.arguments,
                  systemMessageId: parsed.systemMessageId as string | undefined,
                });
                if (parsed.systemMessageId) pendingSystemMessageId = parsed.systemMessageId as string;
              }
              continue;
            }

            /* Extract AI-generated files from tool.message events */
            if (parsed.type === 'tool.message') {
              try {
                const output = typeof parsed.output === 'string' ? JSON.parse(parsed.output) : parsed.output;
                if (Array.isArray(output?.files) && output.files.length > 0) {
                  const fileEvent = { type: 'files', files: output.files };
                  res.write(`data: ${JSON.stringify(fileEvent)}\n\n`);
                }
              } catch {
                /* output may not be JSON — ignore */
              }
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
            /* SSE lines may not be valid JSON (e.g. event names) */
          }
        }
        if (sseEventLog.length > 0 && !fullContent) {
          console.warn('[SSE debug] Stream ended with empty fullContent. Events seen:', sseEventLog.join(' | '));
        }
      }
    } finally {
      clearTimeout(sseTimeout);
      const abortTimer = (sseResponse as PatchedResponse)._abortTimer;
      if (abortTimer) clearTimeout(abortTimer);
    }

    /* rawContent = what the client received (streaming-safe rules only).
       formattedContent = full rule chain applied (for workflows + formatted_response event). */
    const rawContent = hasStreamRules ? applyFormattingRules(fullContent, streamRules).formatted : fullContent;

    let formattedContent: string | null = null;
    if (hasPostStreamRules) {
      let postStreamRules = [...allRules];
      if (stepOutputMappings && expectedResponseFormat === 'json') {
        const expectedKeys = [...new Set(Object.keys(stepOutputMappings).map(rootKeyFromPath))];
        postStreamRules = postStreamRules.map((r) =>
          r.type === 'trim-to-json' ? { ...r, options: { ...(r.options || {}), expectedKeys } } : r,
        );
      }
      const result = applyFormattingRules(fullContent, postStreamRules);
      if (result.formatted !== rawContent) {
        formattedContent = result.formatted;
      }
    }

    const totalTokens = promptTokens || completionTokens ? (promptTokens || 0) + (completionTokens || 0) : null;
    if (promptTokens || completionTokens) {
      res.write(
        `data: ${JSON.stringify({ type: 'usage', prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens, model: streamModel })}\n\n`,
      );
    }

    if (formattedContent) {
      res.write(`data: ${JSON.stringify({ type: 'formatted_response', content: formattedContent })}\n\n`);
    }

    /* Fulfill internal tool-job calls before closing the stream */
    if (pendingInternalToolCalls.length > 0) {
      try {
        const outputs = await fulfillPendingToolJobCalls(
          pendingInternalToolCalls,
          chatSessionRow.ai_profile,
          chatSessionRow.calling_application || 'unknown',
        );
        if (outputs.length > 0) {
          const toolStream = await submitChatToolOutputs(
            sessionId,
            pendingSystemMessageId || '',
            outputs,
          );
          const toolBody = toolStream.response.body as ReadableStream<Uint8Array> | null;
          if (toolBody) {
            const toolReader = toolBody.getReader();
            while (true) {
              const { value, done } = await toolReader.read();
              if (done) break;
              res.write(decoder.decode(value, { stream: true }));
            }
          }
        }
      } catch (toolErr) {
        console.error('[chat-sessions] Internal tool-job fulfillment failed:', errorMessage(toolErr));
        res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage(toolErr) })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    const durationMs = Date.now() - t0;
    setImmediate(async () => {
      try {
        await recordAssistantMessage(sessionId, rawContent, {
          durationMs,
          firstTokenMs,
          promptTokens,
          completionTokens,
        });

        const contentForWorkflow = formattedContent || rawContent;

        if (stepOutputMappings) {
          try {
            await extractAndAccumulateOutputs(sessionId, contentForWorkflow, stepOutputMappings);
          } catch (extractErr) {
            console.warn('[chat-sessions] Non-blocking output extraction failed:', errorMessage(extractErr));
          }
        }

        if (workflowStepId && resolvedStepKey) {
          try {
            await mergeWorkflowVariables(sessionId, {
              [`${resolvedStepKey}.prompt`]: resolvedMessage,
              [`${resolvedStepKey}.response`]: contentForWorkflow,
            });
            await fireInternalTriggers('workflow.step.completed', {
              sessionId,
              stepKey: resolvedStepKey,
              callingApplication: chatSessionRow.calling_application,
              userId: chatSessionRow.user_id,
            });
          } catch (autoErr) {
            console.warn('[chat-sessions] Non-blocking auto-capture failed:', errorMessage(autoErr));
          }
        }

        await fireInternalTriggers('session.message.created', {
          sessionId,
          callingApplication: chatSessionRow.calling_application,
          userId: chatSessionRow.user_id,
        });
      } catch (err) {
        console.warn('[chat-sessions] Failed to record assistant message:', errorMessage(err));
      }

      if (diag) {
        try {
          diag.endLlmTimer(
            {
              provider: authorized?.provider_type || 'unknown',
              model: streamModel || 'unknown',
              promptContent: resolvedMessage || message || null,
            },
            {
              rawContent,
              rawLength: fullContent.length,
              formattedContent: formattedContent || undefined,
              usage:
                promptTokens || completionTokens
                  ? { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }
                  : null,
            },
          );
          if (hasStreamRules || hasPostStreamRules) {
            diag.addMetadata('streamingRulesApplied', streamRules.length);
            diag.addMetadata('postStreamRulesApplied', allRules.length - streamRules.length);
            diag.addMetadata('formattedResponseSent', !!formattedContent);
          }
          diag.addMetadata('durationMs', durationMs);
          diag.addMetadata('firstTokenMs', firstTokenMs);
          diag.addMetadata('promptTokens', promptTokens);
          diag.addMetadata('completionTokens', completionTokens);
          diag.addMetadata('totalTokens', totalTokens);
          diag.addMetadata('streamModel', streamModel);
          diag.addMetadata('contentLength', rawContent.length);
          diag.addMetadata('ruleSetKey', ruleSetKey || null);
          diag.addMetadata('stepKey', stepKey || null);
          await diag.complete('success');
        } catch (diagErr) {
          console.warn('[chat-sessions] Non-blocking diagnostics write failed:', errorMessage(diagErr));
        }
      }
    });
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

    let lineBuffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
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
   GET /api/chat-sessions
   List sessions with optional filters.
   Query: ?userId=&aiProfileId=&workflowId=&status=&callingApplication=
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    const effectiveUserId =
      ctx?.mode === 'api_key' && ctx.forwardedUserId ? ctx.forwardedUserId : (req.query.userId as string) || null;

    const params = parsePagination(req);
    const sessions = await listChatSessions({
      userId: effectiveUserId ?? undefined,
      aiProfileId: (req.query.aiProfileId as string) || undefined,
      workflowId: (req.query.workflowId as string) || undefined,
      status: (req.query.status as string) || undefined,
      callingApplication: (req.query.callingApplication as string) || undefined,
      externalChatId: (req.query.externalChatId as string) || undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });
    const result = buildPaginatedResponse(sessions, params);
    result.data = stripSecrets(result.data) as typeof result.data;
    return res.json(result);
  } catch (err) {
    console.error('[GET /chat-sessions]', err);
    return res.status(500).json({ error: 'Failed to list chat sessions' });
  }
});

/* ================================================================
   GET /api/chat-sessions/:id
   Get session metadata + stats.
   ================================================================ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res);
    if (!authorized) return;
    const history = await getChatHistory(req.params.id as string);
    const stats = await getChatSessionStats(req.params.id as string);
    return res.json(stripSecrets({ ...history, stats }));
  } catch (err) {
    console.error('[GET /chat-sessions/:id]', err);
    return res.status(500).json({ error: 'Failed to retrieve chat session' });
  }
});

/* ================================================================
   GET /api/chat-sessions/:id/messages
   Get message history (local or from Devs.ai).
   Query: ?fromProvider=true
   ================================================================ */

router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res);
    if (!authorized) return;
    const fromProvider = req.query.fromProvider === 'true';
    const data = await getChatHistory(req.params.id as string, { fromProvider });
    return res.json(stripSecrets(data.messages || data));
  } catch (err) {
    console.error('[GET /chat-sessions/:id/messages]', err);
    return res.status(500).json({ error: 'Failed to retrieve chat messages' });
  }
});

/* ================================================================
   PUT /api/chat-sessions/:id/reset
   Reset conversation (clear messages, optionally reset remote session).
   ================================================================ */

router.put('/:id/reset', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;
    const updated = await resetChatSession(req.params.id as string);
    return res.json(updated);
  } catch (err) {
    console.error('[PUT /chat-sessions/:id/reset]', err);
    return res.status(500).json({ error: 'Failed to reset chat session' });
  }
});

/* ================================================================
   DELETE /api/chat-sessions/:id
   Close and delete a session.
   ================================================================ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res);
    if (!authorized) return;
    await removeChatSession(req.params.id as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /chat-sessions/:id]', err);
    return res.status(500).json({ error: 'Failed to delete chat session' });
  }
});

/* ================================================================
   PUT /api/chat-sessions/:id/close
   Close a session (keep data, mark as closed).
   ================================================================ */

router.put('/:id/close', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res, { requireOwnership: true });
    if (!authorized) return;
    const updated = await closeChatSession(req.params.id as string);
    return res.json(updated);
  } catch (err) {
    console.error('[PUT /chat-sessions/:id/close]', err);
    return res.status(500).json({ error: 'Failed to close chat session' });
  }
});

/* ================================================================
   GET /api/chat-sessions/:id/diagnostics
   Get diagnostic summary for a chat session.
   ================================================================ */

router.get('/:id/diagnostics', async (req: Request, res: Response) => {
  try {
    const session = await authorizeSessionAccess(req.params.id as string, res);
    if (!session) return;
    const stats = await getChatSessionStats(req.params.id as string);
    return res.json(buildChatDiagnosticSummary(session, stats));
  } catch (err) {
    console.error('[GET /chat-sessions/:id/diagnostics]', err);
    return res.status(500).json({ error: 'Failed to retrieve diagnostics' });
  }
});

/* ================================================================
   GET /api/chat-sessions/:id/files
   List all files (user-uploaded and AI-generated) for a session.
   Proxies to Devs.ai's chat files API.
   ================================================================ */

router.get('/:id/files', async (req: Request, res: Response) => {
  try {
    const authorized = await authorizeSessionAccess(req.params.id as string, res);
    if (!authorized) return;
    const files = await getChatSessionFiles(req.params.id as string);
    return res.json({ files });
  } catch (err) {
    console.error('[GET /chat-sessions/:id/files]', err);
    return res.status(500).json({ error: 'Failed to retrieve chat files' });
  }
});

/* ================================================================
   GET /api/chat-sessions/analytics/by-profile/:aiProfileId
   Aggregate analytics for all sessions of an AI profile.
   ================================================================ */

router.get('/analytics/by-profile/:aiProfileId', async (req: Request, res: Response) => {
  try {
    const sessions = await listChatSessions({ aiProfileId: req.params.aiProfileId as string });
    const analytics = {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s: ChatSessionRow) => s.status === 'active').length,
      closedSessions: sessions.filter((s: ChatSessionRow) => s.status === 'closed').length,
      totalMessages: sessions.reduce((sum: number, s: ChatSessionRow) => sum + (s.message_count || 0), 0),
      totalPromptTokens: sessions.reduce((sum: number, s: ChatSessionRow) => sum + (s.total_prompt_tokens || 0), 0),
      totalCompletionTokens: sessions.reduce(
        (sum: number, s: ChatSessionRow) => sum + (s.total_completion_tokens || 0),
        0,
      ),
      avgMessagesPerSession:
        sessions.length > 0
          ? Math.round(
              sessions.reduce((sum: number, s: ChatSessionRow) => sum + (s.message_count || 0), 0) / sessions.length,
            )
          : 0,
      sessions: sessions.map((s: ChatSessionRow) => ({
        id: s.id,
        status: s.status,
        messageCount: s.message_count,
        totalPromptTokens: s.total_prompt_tokens,
        totalCompletionTokens: s.total_completion_tokens,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
    };
    return res.json(analytics);
  } catch (err) {
    console.error('[GET /chat-sessions/analytics/by-profile]', err);
    return res.status(500).json({ error: 'Failed to retrieve session analytics' });
  }
});

export default router;
