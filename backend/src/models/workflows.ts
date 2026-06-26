/**
 * Model – Workflows & Workflow Steps
 * ------------------------------------
 * CRUD for the `workflows` and `workflow_steps` tables.
 * Workflows group processing jobs into multi-step chat-compatible
 * flows with ordering and dependency constraints.
 */

import type { WorkflowRow, WorkflowStepRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const WORKFLOW_TABLE = 'workflows';
const STEP_TABLE = 'workflow_steps';

/* ── Workflows ──────────────────────────────────────────────── */

export async function createWorkflow(data: Partial<WorkflowRow>): Promise<WorkflowRow> {
  const { data: row, error } = await tenantFrom(WORKFLOW_TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`Workflow insert error: ${error.message}`);
  return row;
}

export async function getWorkflow(id: string): Promise<WorkflowRow> {
  const { data: row, error } = await tenantFrom(WORKFLOW_TABLE)
    .select(
      `
      *,
      ai_profile:ai_profiles(id, name, external_ai_id, mode,
        provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url, api_key)
      ),
      steps:workflow_steps(
        id, step_key, name, sort_order, is_required, depends_on, config,
        processing_job_id,
        processing_job:processing_jobs(id, name, slug, config)
      )
    `,
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`Workflow get error: ${error.message}`);
  if (row?.steps) {
    (row.steps as WorkflowStepRow[]).sort(
      (a: WorkflowStepRow, b: WorkflowStepRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
  }
  return row;
}

export async function getWorkflowBySlug(slug: string): Promise<WorkflowRow | null> {
  const { data: row, error } = await tenantFrom(WORKFLOW_TABLE)
    .select(
      `
      *,
      ai_profile:ai_profiles(id, name, external_ai_id, mode,
        provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url, api_key)
      ),
      steps:workflow_steps(
        id, step_key, name, sort_order, is_required, depends_on, config,
        processing_job_id,
        processing_job:processing_jobs(id, name, slug, config)
      )
    `,
    )
    .eq('slug', slug)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Workflow slug lookup error: ${error.message}`);
  }
  if (row?.steps) {
    (row.steps as WorkflowStepRow[]).sort(
      (a: WorkflowStepRow, b: WorkflowStepRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
  }
  return row;
}

export async function listWorkflows(options: { cursor?: string; limit?: number } = {}): Promise<WorkflowRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom(WORKFLOW_TABLE)
    .select(
      `
      *,
      ai_profile:ai_profiles(id, name, external_ai_id),
      steps:workflow_steps(id, step_key, name, sort_order, is_required, processing_job_id)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (options.cursor) {
    query = query.lt('created_at', options.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Workflow list error: ${error.message}`);
  for (const row of (data || []) as WorkflowRow[]) {
    if (row.steps) {
      row.steps.sort((a: WorkflowStepRow, b: WorkflowStepRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
  }
  return data || [];
}

export async function updateWorkflow(id: string, updates: Partial<WorkflowRow>): Promise<WorkflowRow> {
  const { data: row, error } = await tenantFrom(WORKFLOW_TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Workflow update error: ${error.message}`);
  return row;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const { error } = await tenantFrom(WORKFLOW_TABLE).delete().eq('id', id);
  if (error) throw new Error(`Workflow delete error: ${error.message}`);
}

/* ── Workflow Steps ─────────────────────────────────────────── */

export async function createWorkflowStep(data: Partial<WorkflowStepRow>): Promise<WorkflowStepRow> {
  const { data: row, error } = await tenantFrom(STEP_TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`Workflow step insert error: ${error.message}`);
  return row;
}

export async function getWorkflowStep(id: string): Promise<WorkflowStepRow> {
  const { data: row, error } = await tenantFrom(STEP_TABLE)
    .select(
      `
      *,
      processing_job:processing_jobs(id, name, slug, config)
    `,
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`Workflow step get error: ${error.message}`);
  return row;
}

export async function getWorkflowStepByKey(workflowId: string, stepKey: string): Promise<WorkflowStepRow | null> {
  const { data: row, error } = await tenantFrom(STEP_TABLE)
    .select(
      `
      *,
      processing_job:processing_jobs(id, name, slug, config,
        ai_profile:ai_profiles(id, name, external_ai_id,
          provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url, api_key)
        )
      )
    `,
    )
    .eq('workflow_id', workflowId)
    .eq('step_key', stepKey)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Workflow step lookup error: ${error.message}`);
  }
  return row;
}

export async function listWorkflowSteps(workflowId: string): Promise<WorkflowStepRow[]> {
  const { data, error } = await tenantFrom(STEP_TABLE)
    .select(
      `
      *,
      processing_job:processing_jobs(id, name, slug, config)
    `,
    )
    .eq('workflow_id', workflowId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Workflow steps list error: ${error.message}`);
  return data || [];
}

export async function updateWorkflowStep(id: string, updates: Partial<WorkflowStepRow>): Promise<WorkflowStepRow> {
  const { data: row, error } = await tenantFrom(STEP_TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Workflow step update error: ${error.message}`);
  return row;
}

export async function deleteWorkflowStep(id: string): Promise<void> {
  const { error } = await tenantFrom(STEP_TABLE).delete().eq('id', id);
  if (error) throw new Error(`Workflow step delete error: ${error.message}`);
}

interface WorkflowStepInput {
  processing_job_id: string;
  step_key: string;
  name: string;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: Record<string, unknown>;
}

/**
 * Batch-replace all steps for a workflow. Deletes existing steps
 * and inserts the provided array in a single pass.
 */
export async function replaceWorkflowSteps(workflowId: string, steps: WorkflowStepInput[]): Promise<WorkflowStepRow[]> {
  const { error: delErr } = await tenantFrom(STEP_TABLE).delete().eq('workflow_id', workflowId);
  if (delErr) throw new Error(`Workflow steps clear error: ${delErr.message}`);

  if (!steps?.length) return [];

  const rows = steps.map((s, i) =>
    tenantInsertPayload({
      workflow_id: workflowId,
      processing_job_id: s.processing_job_id,
      step_key: s.step_key,
      name: s.name,
      sort_order: s.sort_order ?? i,
      is_required: s.is_required ?? false,
      depends_on: s.depends_on ?? [],
      config: s.config ?? {},
      updated_at: new Date().toISOString(),
    }),
  );

  const { data, error } = await tenantFrom(STEP_TABLE).insert(rows).select();
  if (error) throw new Error(`Workflow steps insert error: ${error.message}`);
  return data || [];
}
