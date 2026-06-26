/**
 * Routes – Diagnostic Logs
 * --------------------------
 * API endpoints for viewing and managing AI diagnostic logs.
 * Part of the AI Manager module.
 */

import { Router, Request, Response } from 'express';
import {
  listDiagnosticLogs,
  getDiagnosticLog,
  deleteDiagnosticLog,
  clearDiagnosticLogs,
  getDiagTokenUsageStats,
} from '../models/diagnostic-logs.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';

const router = Router();

/**
 * GET /api/diagnostic-logs
 * List diagnostic logs with optional filters.
 * Query params: processingJobId, chatSessionId, callingApplication, status, userId, authMode, limit
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req);
    const filters = {
      processingJobId: (req.query.processingJobId as string) || null,
      chatSessionId: (req.query.chatSessionId as string) || null,
      callingApplication: (req.query.callingApplication as string) || null,
      status: (req.query.status as string) || null,
      userId: (req.query.userId as string) || null,
      authMode: (req.query.authMode as string) || null,
      limit: params.limit,
      cursor: params.cursor ?? undefined,
    };
    const rows = await listDiagnosticLogs(filters);
    return res.json(buildPaginatedResponse(rows, params));
  } catch (err) {
    console.error('[GET /diagnostic-logs]', err);
    return res.status(500).json({ error: 'Failed to list diagnostic logs' });
  }
});

/**
 * GET /api/diagnostic-logs/token-stats
 * Aggregate token usage from diagnostic_logs.llm_response.usage.
 */
router.get('/token-stats', async (req: Request, res: Response) => {
  try {
    const filters = {
      processingJobId: (req.query.processingJobId as string) || null,
      callingApplication: (req.query.callingApplication as string) || null,
      limit: Math.min(Math.max(parseInt(req.query.limit as string, 10) || 1000, 1), 5000),
    };
    const stats = await getDiagTokenUsageStats(filters);
    return res.json(stats);
  } catch (err) {
    console.error('[GET /diagnostic-logs/token-stats]', err);
    return res.status(500).json({ error: 'Failed to retrieve token stats' });
  }
});

/**
 * GET /api/diagnostic-logs/:id
 * Get a single diagnostic log entry.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const log = await getDiagnosticLog(req.params.id as string);
    return res.json(log);
  } catch (err) {
    console.error('[GET /diagnostic-logs/:id]', err);
    return res.status(500).json({ error: 'Failed to retrieve diagnostic log' });
  }
});

/**
 * DELETE /api/diagnostic-logs/:id
 * Delete a single diagnostic log entry.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteDiagnosticLog(req.params.id as string);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /diagnostic-logs/:id]', err);
    return res.status(500).json({ error: 'Failed to delete diagnostic log' });
  }
});

/**
 * DELETE /api/diagnostic-logs/job/:jobId
 * Clear all diagnostic logs for a specific processing job.
 */
router.delete('/job/:jobId', async (req: Request, res: Response) => {
  try {
    await clearDiagnosticLogs(req.params.jobId as string);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /diagnostic-logs/job/:jobId]', err);
    return res.status(500).json({ error: 'Failed to clear diagnostic logs' });
  }
});

export default router;
