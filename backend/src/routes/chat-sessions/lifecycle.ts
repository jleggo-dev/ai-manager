/**
 * Chat-sessions lifecycle routes — open + resume.
 * Split from routes/chat-sessions.ts (2026-08-04); handlers verbatim.
 */
import { Router, Request, Response } from 'express';
import { openChatSession, resumeChatSession } from '../../ai-manager/index.ts';
import {
  getChatSession as dbGetChatSession,
  getChatSessionByExternalChatId as dbGetChatSessionByExternalChatId,
} from '../../models/chat-sessions.ts';
import { resolveCallingApplication } from '../../models/calling-applications.ts';
import { getProcessingJob } from '../../models/processing-jobs.ts';
import { getAuthContext } from '../../db/tenant.ts';
import { stripSecrets } from '../../lib/sanitize.ts';
import { authorizeSessionAccess } from './shared.ts';
import { errorMessage } from '../../lib/error-message.ts';
import { safeClientError } from '../../lib/safe-error.ts';
import { validateBody } from '../../middleware/validate.ts';
import { createChatSessionSchema, resumeChatSessionSchema } from '../../schemas/chat-sessions.ts';

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
    if (msg.includes('no API key configured')) {
      return res.status(422).json({ error: safeClientError(err, 'Provider has no API key configured.') });
    }
    return res.status(500).json({ error: safeClientError(err, 'Failed to create chat session') });
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

export { router as lifecycleRouter };
