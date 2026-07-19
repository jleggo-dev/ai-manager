/**
 * Routes – Processing Jobs
 * -------------------------
 * CRUD for processing jobs, plus test endpoints and formatting rules.
 * Each job stores its prompt template and formatting rules in `config` JSONB.
 *
 * The /test endpoint uses the AI Manager's executeJobById() interface
 * so that the test path is identical to the production execution path.
 */

import { Router, Request, Response } from 'express';
import {
  createProcessingJob,
  updateProcessingJob,
  listProcessingJobs,
  getProcessingJob,
  deleteProcessingJob,
} from '../models/processing-jobs.ts';
import { executeJobById, uploadApiDataSourcesChunked } from '../ai-manager/index.ts';
import { listAvailableRules, applyFormattingRules } from '../services/formatting-rules.ts';
import { runJobEval } from '../services/job-eval.ts';
import { getIdempotencyRecord, storeIdempotencyRecord } from '../services/idempotency.ts';
import crypto from 'node:crypto';
import { resolveCallingApplication } from '../models/calling-applications.ts';
import { getAuthContext } from '../db/tenant.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { validateBody } from '../middleware/validate.ts';
import { requireRole } from '../middleware/require-role.ts';
import { validateRef, sendValidationErrors, type ValidationResult } from '../lib/entity-validators.ts';

import {
  createProcessingJobSchema,
  updateProcessingJobSchema,
  executeJobSchema,
  applyFormattingSchema,
  batchUpdateSchema,
  datasourceUploadSchema,
} from '../schemas/processing-jobs.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';

const router = Router();

/* ================================================================
   GET /api/processing-jobs/formatting-rules
   Returns the full catalogue of available formatting rules.
   ================================================================ */

router.get('/formatting-rules', (_req: Request, res: Response) => {
  return res.json(listAvailableRules());
});

/* ================================================================
   POST /api/processing-jobs/apply-formatting
   Apply formatting rules to a text string (stateless utility).
   Body: { text: string, rules: [{ type, options? }] }
   ================================================================ */

router.post(
  '/apply-formatting',
  requireRole('owner', 'admin'),
  validateBody(applyFormattingSchema),
  (req: Request, res: Response) => {
    try {
      const { text, rules } = req.body;
      const result = applyFormattingRules(text, rules || []);
      return res.json(result);
    } catch (_err) {
      return res.status(500).json({ error: 'Failed to apply formatting' });
    }
  },
);

/* ================================================================
   GET /api/processing-jobs
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req);
    const rows = await listProcessingJobs({ cursor: params.cursor ?? undefined, limit: params.limit });
    return res.json(buildPaginatedResponse(rows, params));
  } catch (err) {
    console.error('[GET /processing-jobs]', err);
    return res.status(500).json({ error: 'Failed to list processing jobs' });
  }
});

/* ================================================================
   POST /api/processing-jobs
   ================================================================ */

router.post(
  '/',
  requireRole('owner', 'admin'),
  validateBody(createProcessingJobSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        slug,
        description,
        ai_profile_id,
        is_active,
        config,
        calling_application_id,
        requires_user_credentials,
      } = req.body;

      // Semantic validation: verify referenced entities exist in this workspace
      const vr: ValidationResult = { errors: [], warnings: [] };
      const profileErr = await validateRef('ai_profiles', ai_profile_id, 'ai_profile_id', 'AI profile');
      if (profileErr) vr.errors.push(profileErr);
      if (sendValidationErrors(res, vr)) return;

      const row = await createProcessingJob({
        name,
        slug,
        description: description || null,
        ai_profile_id: ai_profile_id || null,
        is_active: is_active !== false,
        config: config || {},
        calling_application_id: calling_application_id || null,
        requires_user_credentials: requires_user_credentials === true,
      });

      return res.status(201).json(row);
    } catch (err) {
      console.error('[POST /processing-jobs]', err);
      return res.status(500).json({ error: 'Failed to create processing job' });
    }
  },
);

/* ================================================================
   PATCH /api/processing-jobs/batch
   Bulk-update multiple jobs. Accepts an array of { id, ...fields }.
   Each entry is applied independently; partial failures don't block others.
   Body: { updates: [{ id, ai_profile_id?, config?, is_active? }] }
   ================================================================ */

const BATCH_ALLOWED_FIELDS = new Set(['name', 'description', 'slug', 'status', 'config', 'ai_profile_id', 'group_id']);

router.patch(
  '/batch',
  requireRole('owner', 'admin'),
  validateBody(batchUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { updates } = req.body;

      const results = await Promise.allSettled(
        updates.map(({ id, ...fields }: { id: string; [key: string]: unknown }) => {
          const filtered: Record<string, unknown> = {};
          for (const key of Object.keys(fields)) {
            if (BATCH_ALLOWED_FIELDS.has(key)) filtered[key] = fields[key];
          }
          return updateProcessingJob(id, filtered);
        }),
      );

      const summary = results.map((r, i) => ({
        id: updates[i].id,
        status: r.status === 'fulfilled' ? 'ok' : 'error',
        error: r.status === 'rejected' ? 'Update failed' : null,
      }));

      return res.json({ results: summary });
    } catch (err) {
      console.error('[PATCH /processing-jobs/batch]', err);
      return res.status(500).json({ error: 'Failed to batch update processing jobs' });
    }
  },
);

/* ================================================================
   GET /api/processing-jobs/:id
   ================================================================ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getProcessingJob(req.params.id as string);
    return res.json(stripSecrets(row));
  } catch (_err) {
    return res.status(404).json({ error: 'Processing Job not found' });
  }
});

/* ================================================================
   PUT /api/processing-jobs/:id
   ================================================================ */

router.put(
  '/:id',
  requireRole('owner', 'admin'),
  validateBody(updateProcessingJobSchema),
  async (req: Request, res: Response) => {
    try {
      const updated = await updateProcessingJob(req.params.id as string, req.body);
      return res.json(updated);
    } catch (err) {
      console.error('[PUT /processing-jobs/:id]', err);
      return res.status(500).json({ error: 'Failed to update processing job' });
    }
  },
);

/* ================================================================
   DELETE /api/processing-jobs/:id
   ================================================================ */

router.delete('/:id', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    await deleteProcessingJob(req.params.id as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /processing-jobs/:id]', err);
    return res.status(500).json({ error: 'Failed to delete processing job' });
  }
});

/* ================================================================
   POST /api/processing-jobs/:id/test
   Test a processing job using the AI Manager's executeJobById().
   This ensures the test path is identical to the production path —
   same provider resolution, prompt interpolation, LLM call, and
   formatting rules.
   Body: { variables, attachments?: [{ url, mimeType, fileName }] }
   ================================================================ */

router.post(
  '/:id/test',
  requireRole('owner', 'admin'),
  validateBody(executeJobSchema),
  async (req: Request, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const cached = await getIdempotencyRecord(idempotencyKey);
        if (cached) return res.status(cached.status_code).json(cached.response_body);
      }

      const { variables = {}, promptOverride, callingApplication, attachments } = req.body;

      const ctx = getAuthContext();
      let resolvedCallingApp: string;
      if (ctx?.mode === 'jwt') {
        resolvedCallingApp = callingApplication || 'ai-admin-test';
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

      const result = await executeJobById(req.params.id as string, {
        callingApplication: resolvedCallingApp,
        variables,
        promptOverride: promptOverride || null,
        attachments: attachments || [],
      });

      const responseBody = {
        messageSent: result.messageSent,
        raw: result.raw,
        formatted: result.formatted,
        formattingSteps: result.formattingSteps,
        durationMs: result.metadata.durationMs,
        model: result.metadata.model,
        usage: result.metadata.usage,
        finishReason: result.metadata.finishReason,
        diagnostics: result.diagnostics || null,
      };

      if (idempotencyKey) {
        await storeIdempotencyRecord(
          idempotencyKey,
          `/api/processing-jobs/${req.params.id}/test`,
          responseBody,
          200,
          crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex'),
        );
      }

      return res.json(responseBody);
    } catch (err) {
      console.error('[POST /processing-jobs/:id/test]', err);
      return res.status(500).json({ error: 'Processing job test failed' });
    }
  },
);

/* ================================================================
   POST /api/processing-jobs/:id/eval
   Run golden test cases from config.testData / config.evalCases.
   Returns pass/fail per case — wireable into CI.
   ================================================================ */

router.post('/:id/eval', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    const job = await getProcessingJob(req.params.id as string);
    if (!job) return res.status(404).json({ error: 'Processing job not found' });

    const ctx = getAuthContext();
    const callingApplication =
      (req.body?.callingApplication as string) || (ctx?.mode === 'jwt' ? 'ai-admin-eval' : 'ai-admin-eval');

    const evalResult = await runJobEval(job, callingApplication);
    const status = evalResult.failed > 0 ? 422 : 200;
    return res.status(status).json(evalResult);
  } catch (err) {
    console.error('[POST /processing-jobs/:id/eval]', err);
    return res.status(500).json({ error: 'Job eval failed' });
  }
});

/* ================================================================
   POST /api/processing-jobs/:id/datasources
   Upload structured JSON data as a Devs.ai datasource for this job.
   Body: { rows: [...], namePrefix?, maxChunkBytes?, callingApplication? }
   ================================================================ */

router.post(
  '/:id/datasources',
  requireRole('owner', 'admin'),
  validateBody(datasourceUploadSchema),
  async (req: Request, res: Response) => {
    try {
      const { rows, namePrefix, maxChunkBytes, callingApplication } = req.body;

      const ctx = getAuthContext();
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

      const result = await uploadApiDataSourcesChunked({
        jobId: req.params.id as string | undefined,
        callingApplication: resolvedCallingApp,
        rows,
        namePrefix: namePrefix || 'datasource',
        maxChunkBytes: maxChunkBytes || undefined,
      });

      return res.json(result);
    } catch (err) {
      console.error('[POST /processing-jobs/:id/datasources]', err);
      return res.status(500).json({ error: 'Failed to upload datasources' });
    }
  },
);

export default router;
