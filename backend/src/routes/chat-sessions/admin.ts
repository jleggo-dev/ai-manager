/**
 * Read/admin routes — list, get, history, reset, delete, close, diagnostics, files, analytics.
 * Split from routes/chat-sessions.ts (2026-08-04); handlers verbatim.
 */
import { Router, Request, Response } from 'express';
import {
  getChatHistory,
  closeChatSession,
  resetChatSession,
  removeChatSession,
  getChatSessionFiles,
} from '../../ai-manager/index.ts';
import { listChatSessions, getChatSessionStats } from '../../models/chat-sessions.ts';
import { buildChatDiagnosticSummary } from '../../services/ai-diagnostics.ts';
import { getAuthContext } from '../../db/tenant.ts';
import { stripSecrets } from '../../lib/sanitize.ts';
import { parsePagination, buildPaginatedResponse } from '../../lib/pagination.ts';
import type { ChatSessionRow } from '../../types.ts';
import { authorizeSessionAccess } from './shared.ts';

const router = Router();
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

export { router as adminRouter };
