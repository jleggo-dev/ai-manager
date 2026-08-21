/**
 * A workflow step that asks the USER (migration 014).
 *
 * Pure schema tests — no app, no network, no API key — because the rule they pin is the one a
 * future edit is most likely to relax by accident: a job step must have a job, and an input step
 * must not. The database enforces the same thing with a check constraint; both exist because a 400
 * explains itself to whoever is building a workflow and a Postgres 23514 does not.
 *
 * The DEFAULT is the load-bearing part. Every step written before this change omits `step_type`
 * entirely, and must keep behaving exactly as it did.
 */
import { describe, it, expect } from 'vitest';
import { createWorkflowStepSchema } from '../src/schemas/workflows.ts';

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const base = { step_key: 'confirm', name: 'Confirm the reading' };

describe('createWorkflowStepSchema — step_type', () => {
  it('defaults to a job step, so every pre-existing step is unchanged', () => {
    const r = createWorkflowStepSchema.safeParse({ ...base, processing_job_id: JOB_ID });
    expect(r.success).toBe(true);
    expect(r.success && r.data.step_type).toBe('job');
  });

  it('accepts an input step with no processing job', () => {
    const r = createWorkflowStepSchema.safeParse({
      ...base,
      step_type: 'input',
      config: { collects: 'confirmed_meal', prompt: "Here's what I read — did I get it right?" },
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.processing_job_id).toBeFalsy();
  });

  /** The job step's original guarantee, kept exactly where it still applies. */
  it('rejects a job step with no processing job', () => {
    const r = createWorkflowStepSchema.safeParse({ ...base });
    expect(r.success).toBe(false);
    expect(r.success === false && JSON.stringify(r.error.issues)).toContain('requires processing_job_id');
  });

  /**
   * An input step pointing at a job is the dangerous shape: it reads as configured, and would sit
   * in the table meaning two different things at once.
   */
  it('rejects an input step that also references a job', () => {
    const r = createWorkflowStepSchema.safeParse({ ...base, step_type: 'input', processing_job_id: JOB_ID });
    expect(r.success).toBe(false);
    expect(r.success === false && JSON.stringify(r.error.issues)).toContain('must not reference a processing job');
  });

  it('rejects an unknown step type rather than coercing it', () => {
    expect(createWorkflowStepSchema.safeParse({ ...base, step_type: 'human' }).success).toBe(false);
  });
});
