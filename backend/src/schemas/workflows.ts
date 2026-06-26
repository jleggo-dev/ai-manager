import { z } from 'zod';

/* ── Shared sub-schemas ─────────────────────────────────── */

const workflowInputVariableSchema = z.object({
  name: z.string().min(1, 'Variable name is required').max(100),
  label: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
});

const stepConfigSchema = z
  .object({
    promptTemplate: z.string().max(50_000).optional(),
    inputMappings: z.record(z.string(), z.string()).optional(),
    outputMappings: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const workflowConfigSchema = z
  .object({
    inputVariables: z.array(workflowInputVariableSchema).max(50).optional(),
    systemPrompt: z.string().max(50_000).optional(),
  })
  .passthrough();

/* ── Inline step (embedded in workflow create/update) ───── */

const inlineStepSchema = z.object({
  processing_job_id: z.string().uuid(),
  step_key: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  sort_order: z.number().int().optional(),
  is_required: z.boolean().optional().default(true),
  depends_on: z.array(z.string().max(100)).optional(),
  config: stepConfigSchema.optional(),
});

/* ── Workflow CRUD ──────────────────────────────────────── */

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(50_000).optional().nullable(),
  ai_profile_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  config: workflowConfigSchema.optional(),
  steps: z.array(inlineStepSchema).optional(),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();

/* ── Standalone step (POST /workflows/:id/steps) ────────── */

export const createWorkflowStepSchema = z.object({
  processing_job_id: z.string().uuid('Must be a valid processing job ID'),
  step_key: z.string().min(1, 'Step key is required').max(100),
  name: z.string().min(1, 'Name is required').max(200),
  sort_order: z.number().int().optional(),
  is_required: z.boolean().optional().default(true),
  depends_on: z.array(z.string().max(100)).optional(),
  config: stepConfigSchema.optional(),
});
