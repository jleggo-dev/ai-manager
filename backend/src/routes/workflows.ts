/**
 * Routes – Workflows
 * -------------------
 * CRUD for workflows and their steps. Workflows group processing
 * jobs into multi-step chat-compatible flows.
 */

import { Router, Request, Response } from 'express';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  createWorkflowStep,
  listWorkflowSteps,
  updateWorkflowStep,
  deleteWorkflowStep,
  replaceWorkflowSteps,
} from '../models/workflows.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { errorMessage } from '../lib/error-message.ts';
import { validateBody } from '../middleware/validate.ts';
import { requireRole } from '../middleware/require-role.ts';
import {
  validateRef,
  validateWorkflowDeps,
  sendValidationErrors,
  type ValidationResult,
} from '../lib/entity-validators.ts';

import { createWorkflowSchema, updateWorkflowSchema, createWorkflowStepSchema } from '../schemas/workflows.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';
import { z } from 'zod';

const updateWorkflowStepSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  step_key: z.string().max(100).optional(),
  processing_job_id: z.string().uuid().optional(),
  sort_order: z.number().int().optional(),
  is_required: z.boolean().optional(),
  depends_on: z.array(z.string().max(100)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

import { slugify } from '../lib/slugify.ts';

const router = Router();

/* ================================================================
   GET /api/workflows
   List all workflows (includes steps summary and AI profile).
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req);
    const rows = await listWorkflows({ cursor: params.cursor ?? undefined, limit: params.limit });
    return res.json(buildPaginatedResponse(rows, params));
  } catch (err) {
    console.error('[GET /workflows]', err);
    return res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/* ================================================================
   POST /api/workflows
   Create a new workflow. Optionally include `steps` array to create
   steps in the same request.
   Body: { name, slug?, description?, ai_profile_id, config?, is_active?, steps? }
   ================================================================ */

router.post(
  '/',
  requireRole('owner', 'admin'),
  validateBody(createWorkflowSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, slug, description, ai_profile_id, config, is_active, steps } = req.body;

      const resolvedSlug = slugify(slug || name);
      if (!resolvedSlug) return res.status(400).json({ error: 'slug is required' });

      // Semantic validation (Layer 2): refs + dependency graph
      const vr: ValidationResult = { errors: [], warnings: [] };
      const profileErr = await validateRef('ai_profiles', ai_profile_id, 'ai_profile_id', 'AI profile');
      if (profileErr) vr.errors.push(profileErr);

      if (Array.isArray(steps) && steps.length > 0) {
        const depResult = validateWorkflowDeps(steps);
        vr.errors.push(...depResult.errors);
        vr.warnings.push(...depResult.warnings);

        const jobChecks = await Promise.all(
          steps.map((s: { processing_job_id: string }, i: number) =>
            validateRef('processing_jobs', s.processing_job_id, `steps.${i}.processing_job_id`, 'Processing job'),
          ),
        );
        for (const err of jobChecks) {
          if (err) vr.errors.push(err);
        }
      }

      if (sendValidationErrors(res, vr)) return;

      const workflow = await createWorkflow({
        name,
        slug: resolvedSlug,
        description: description || null,
        ai_profile_id: ai_profile_id || null,
        config: config || {},
        is_active: is_active !== false,
      });

      if (Array.isArray(steps) && steps.length > 0) {
        const normalized = steps.map((s: { step_key: string; [k: string]: unknown }) => ({
          ...s,
          step_key: slugify(s.step_key) || s.step_key,
        })) as Parameters<typeof replaceWorkflowSteps>[1];
        await replaceWorkflowSteps(workflow.id, normalized);
      }

      const full = await getWorkflow(workflow.id);
      const body: Record<string, unknown> = stripSecrets(full) as Record<string, unknown>;
      if (vr.warnings.length > 0) body.warnings = vr.warnings;
      return res.status(201).json(body);
    } catch (err) {
      console.error('[POST /workflows]', err);
      if (errorMessage(err).includes('uq_workflows_workspace_slug')) {
        return res.status(409).json({ error: 'A workflow with this slug already exists' });
      }
      return res.status(500).json({ error: 'Failed to create workflow' });
    }
  },
);

/* ================================================================
   GET /api/workflows/:id
   Get a single workflow with full steps and AI profile.
   ================================================================ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getWorkflow(req.params.id as string);
    return res.json(stripSecrets(row));
  } catch (_err) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
});

/* ================================================================
   PUT /api/workflows/:id
   Update workflow fields. If `steps` array is provided, replaces
   all steps atomically.
   ================================================================ */

router.put(
  '/:id',
  requireRole('owner', 'admin'),
  validateBody(updateWorkflowSchema),
  async (req: Request, res: Response) => {
    try {
      const { steps, ...fields } = req.body;

      if (fields.slug) fields.slug = slugify(fields.slug);

      // Semantic validation
      const vr: ValidationResult = { errors: [], warnings: [] };
      if (fields.ai_profile_id) {
        const profileErr = await validateRef('ai_profiles', fields.ai_profile_id, 'ai_profile_id', 'AI profile');
        if (profileErr) vr.errors.push(profileErr);
      }
      if (Array.isArray(steps) && steps.length > 0) {
        const depResult = validateWorkflowDeps(steps);
        vr.errors.push(...depResult.errors);
        vr.warnings.push(...depResult.warnings);
      }
      if (sendValidationErrors(res, vr)) return;

      const updated = await updateWorkflow(req.params.id as string, fields);

      if (steps !== undefined) {
        const normalized = (steps ?? []).map((s: { step_key: string; [k: string]: unknown }) => ({
          ...s,
          step_key: slugify(s.step_key) || s.step_key,
        })) as Parameters<typeof replaceWorkflowSteps>[1];
        await replaceWorkflowSteps(req.params.id as string, normalized);
      }

      const full = await getWorkflow(updated.id);
      const body: Record<string, unknown> = stripSecrets(full) as Record<string, unknown>;
      if (vr.warnings.length > 0) body.warnings = vr.warnings;
      return res.json(body);
    } catch (err) {
      console.error('[PUT /workflows/:id]', err);
      if (errorMessage(err).includes('uq_workflows_workspace_slug')) {
        return res.status(409).json({ error: 'A workflow with this slug already exists' });
      }
      return res.status(500).json({ error: 'Failed to update workflow' });
    }
  },
);

/* ================================================================
   DELETE /api/workflows/:id
   ================================================================ */

router.delete('/:id', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    await deleteWorkflow(req.params.id as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /workflows/:id]', err);
    return res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/* ================================================================
   GET /api/workflows/:id/steps
   List steps for a workflow.
   ================================================================ */

router.get('/:id/steps', async (req: Request, res: Response) => {
  try {
    const data = await listWorkflowSteps(req.params.id as string);
    return res.json(data);
  } catch (err) {
    console.error('[GET /workflows/:id/steps]', err);
    return res.status(500).json({ error: 'Failed to list workflow steps' });
  }
});

/* ================================================================
   POST /api/workflows/:id/steps
   Add a single step to a workflow.
   Body: { processing_job_id, step_key, name, sort_order?, is_required?, depends_on?, config? }
   ================================================================ */

router.post(
  '/:id/steps',
  requireRole('owner', 'admin'),
  validateBody(createWorkflowStepSchema),
  async (req: Request, res: Response) => {
    try {
      const { processing_job_id, step_key, name, sort_order, is_required, depends_on, config } = req.body;

      const row = await createWorkflowStep({
        workflow_id: req.params.id as string | undefined,
        processing_job_id,
        step_key: slugify(step_key) || step_key,
        name,
        sort_order: Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
        is_required: is_required === true,
        depends_on: Array.isArray(depends_on) ? depends_on : [],
        config: config || {},
      });

      return res.status(201).json(row);
    } catch (err) {
      console.error('[POST /workflows/:id/steps]', err);
      if (errorMessage(err).includes('uq_workflow_steps_key')) {
        return res.status(409).json({ error: 'A step with this key already exists in this workflow' });
      }
      return res.status(500).json({ error: 'Failed to create workflow step' });
    }
  },
);

/* ================================================================
   PUT /api/workflows/:wid/steps/:sid
   Update a single workflow step.
   ================================================================ */

router.put(
  '/:wid/steps/:sid',
  requireRole('owner', 'admin'),
  validateBody(updateWorkflowStepSchema),
  async (req: Request, res: Response) => {
    try {
      const updates: Record<string, unknown> = {};
      if (req.body.name != null) updates.name = req.body.name;
      if (req.body.step_key != null) updates.step_key = slugify(req.body.step_key) || req.body.step_key;
      if (req.body.processing_job_id != null) updates.processing_job_id = req.body.processing_job_id;
      if (req.body.sort_order != null) updates.sort_order = Number(req.body.sort_order);
      if (req.body.is_required != null) updates.is_required = req.body.is_required === true;
      if (req.body.depends_on != null) updates.depends_on = req.body.depends_on;
      if (req.body.config != null) updates.config = req.body.config;

      const row = await updateWorkflowStep(req.params.sid as string, updates);
      return res.json(row);
    } catch (err) {
      console.error('[PUT /workflows/:wid/steps/:sid]', err);
      return res.status(500).json({ error: 'Failed to update workflow step' });
    }
  },
);

/* ================================================================
   DELETE /api/workflows/:wid/steps/:sid
   Remove a single step from a workflow.
   ================================================================ */

router.delete('/:wid/steps/:sid', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    await deleteWorkflowStep(req.params.sid as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /workflows/:wid/steps/:sid]', err);
    return res.status(500).json({ error: 'Failed to delete workflow step' });
  }
});

export default router;
