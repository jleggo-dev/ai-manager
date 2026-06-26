import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

describe('Workflows CRUD & Steps', () => {
  let workflowId: string;
  let stepId: string;
  let processingJobId: string;
  const cleanupWorkflowIds: string[] = [];

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/processing-jobs')
      .set(authHeaders())
      .send({ name: uniqueName('StepJob'), slug: uniqueSlug('step-job') });
    expect(res.status).toBe(201);
    processingJobId = res.body.id;
  });

  afterAll(async () => {
    for (const id of cleanupWorkflowIds.reverse()) {
      await request(app).delete(`/api/workflows/${id}`).set(authHeaders());
    }
    if (processingJobId) {
      await request(app).delete(`/api/processing-jobs/${processingJobId}`).set(authHeaders());
    }
  });

  it('lists workflows with pagination', async () => {
    const res = await request(app).get('/api/workflows').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('creates a workflow', async () => {
    const name = uniqueName('Test Workflow');
    const slug = uniqueSlug('test-wf');
    const res = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name, slug, description: 'Integration test workflow' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(name);
    expect(res.body.slug).toBe(slug);
    workflowId = res.body.id;
    cleanupWorkflowIds.push(workflowId);
  });

  it('gets a workflow by ID', async () => {
    const res = await request(app).get(`/api/workflows/${workflowId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(workflowId);
    expect(res.body).toHaveProperty('steps');
  });

  it('updates a workflow', async () => {
    const res = await request(app)
      .put(`/api/workflows/${workflowId}`)
      .set(authHeaders())
      .send({ name: 'Updated Workflow Name', description: 'Updated description' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Workflow Name');
  });

  it('deletes a workflow and returns 204', async () => {
    const createRes = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name: uniqueName('Disposable'), slug: uniqueSlug('disposable') });
    const id = createRes.body.id;

    const res = await request(app).delete(`/api/workflows/${id}`).set(authHeaders());
    expect(res.status).toBe(204);
  });

  it('returns 404 for a deleted workflow', async () => {
    const createRes = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name: uniqueName('Ghost'), slug: uniqueSlug('ghost') });
    const id = createRes.body.id;

    await request(app).delete(`/api/workflows/${id}`).set(authHeaders());

    const res = await request(app).get(`/api/workflows/${id}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it('adds a step to a workflow', async () => {
    const res = await request(app).post(`/api/workflows/${workflowId}/steps`).set(authHeaders()).send({
      processing_job_id: processingJobId,
      step_key: 'step-one',
      name: 'Step One',
      sort_order: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.step_key).toBe('step-one');
    stepId = res.body.id;
  });

  it('updates a step', async () => {
    const res = await request(app)
      .put(`/api/workflows/${workflowId}/steps/${stepId}`)
      .set(authHeaders())
      .send({ name: 'Step One Updated', sort_order: 10 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Step One Updated');
  });

  it('deletes a step and returns 204', async () => {
    const createRes = await request(app).post(`/api/workflows/${workflowId}/steps`).set(authHeaders()).send({
      processing_job_id: processingJobId,
      step_key: 'step-temp',
      name: 'Temp Step',
      sort_order: 99,
    });
    const tempStepId = createRes.body.id;

    const res = await request(app).delete(`/api/workflows/${workflowId}/steps/${tempStepId}`).set(authHeaders());
    expect(res.status).toBe(204);
  });

  it('returns steps sorted by sort_order', async () => {
    await request(app).post(`/api/workflows/${workflowId}/steps`).set(authHeaders()).send({
      processing_job_id: processingJobId,
      step_key: 'step-zero',
      name: 'Step Zero',
      sort_order: 0,
    });

    const res = await request(app).get(`/api/workflows/${workflowId}`).set(authHeaders());
    expect(res.status).toBe(200);

    const steps = res.body.steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].sort_order).toBeGreaterThanOrEqual(steps[i - 1].sort_order);
    }
  });

  it('rejects a duplicate slug with 409', async () => {
    const slug = uniqueSlug('dup');
    const res1 = await request(app).post('/api/workflows').set(authHeaders()).send({ name: 'Dup First', slug });
    expect(res1.status).toBe(201);
    cleanupWorkflowIds.push(res1.body.id);

    const res2 = await request(app).post('/api/workflows').set(authHeaders()).send({ name: 'Dup Second', slug });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toContain('slug already exists');
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app).post('/api/workflows').set(authHeaders()).send({ description: 'No name or slug' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body).toHaveProperty('details');
  });

  it('persists workflow config.inputVariables', async () => {
    const name = uniqueName('VarPipeline');
    const slug = uniqueSlug('var-pipeline');
    const create = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name,
        slug,
        config: {
          inputVariables: [
            { name: 'topic', label: 'Topic', required: true },
            { name: 'audience', label: 'Audience', required: false },
          ],
        },
      });
    expect(create.status).toBe(201);
    cleanupWorkflowIds.push(create.body.id);

    const get = await request(app).get(`/api/workflows/${create.body.id}`).set(authHeaders());
    expect(get.status).toBe(200);
    expect(get.body.config).toBeDefined();
    expect(get.body.config.inputVariables).toHaveLength(2);
    expect(get.body.config.inputVariables[0].name).toBe('topic');
    expect(get.body.config.inputVariables[1].required).toBe(false);
  });

  it('persists step config.inputMappings and outputMappings', async () => {
    const name = uniqueName('MappingWf');
    const slug = uniqueSlug('mapping-wf');
    const create = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name,
        slug,
        steps: [
          {
            processing_job_id: processingJobId,
            step_key: 'mapped-step',
            name: 'Mapped Step',
            sort_order: 0,
            config: {
              inputMappings: { current_title: 'wf_title' },
              outputMappings: { title: 'wf_generated_title' },
            },
          },
        ],
      });
    expect(create.status).toBe(201);
    cleanupWorkflowIds.push(create.body.id);

    const get = await request(app).get(`/api/workflows/${create.body.id}`).set(authHeaders());
    expect(get.status).toBe(200);
    const step = get.body.steps[0];
    expect(step.config).toBeDefined();
    expect(step.config.inputMappings).toEqual({ current_title: 'wf_title' });
    expect(step.config.outputMappings).toEqual({ title: 'wf_generated_title' });
  });

  /* ── Semantic validation: inline step refs ────────────────── */

  it('rejects workflow with inline step referencing non-existent processing_job_id', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name: uniqueName('BadJobRef'),
        slug: uniqueSlug('bad-job-ref'),
        steps: [
          {
            processing_job_id: '00000000-0000-0000-0000-000000000000',
            step_key: 'broken',
            name: 'Broken Step',
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'steps.0.processing_job_id',
          message: expect.stringContaining('not found'),
        }),
      ]),
    );
  });

  /* ── Semantic validation: circular dependencies ───────────── */

  it('rejects workflow with circular step dependencies', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name: uniqueName('Circular'),
        slug: uniqueSlug('circular'),
        steps: [
          {
            processing_job_id: processingJobId,
            step_key: 'step-a',
            name: 'Step A',
            depends_on: ['step-b'],
          },
          {
            processing_job_id: processingJobId,
            step_key: 'step-b',
            name: 'Step B',
            depends_on: ['step-a'],
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Circular') })]),
    );
  });

  /* ── PUT with steps array: atomic replace ─────────────────── */

  it('replaces all steps atomically via PUT with steps array', async () => {
    const name = uniqueName('ReplaceSteps');
    const slug = uniqueSlug('replace-steps');
    const create = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name,
        slug,
        steps: [{ processing_job_id: processingJobId, step_key: 'old-step', name: 'Old Step' }],
      });
    expect(create.status).toBe(201);
    cleanupWorkflowIds.push(create.body.id);

    const wfId = create.body.id;

    const update = await request(app)
      .put(`/api/workflows/${wfId}`)
      .set(authHeaders())
      .send({
        steps: [
          { processing_job_id: processingJobId, step_key: 'new-a', name: 'New A', sort_order: 0 },
          { processing_job_id: processingJobId, step_key: 'new-b', name: 'New B', sort_order: 1 },
        ],
      });
    expect(update.status).toBe(200);

    const get = await request(app).get(`/api/workflows/${wfId}`).set(authHeaders());
    expect(get.status).toBe(200);
    const keys = get.body.steps.map((s: { step_key: string }) => s.step_key);
    expect(keys).toEqual(['new-a', 'new-b']);
    expect(keys).not.toContain('old-step');
  });

  /* ── PUT with steps: [] clears all steps ──────────────────── */

  it('clears all steps when PUT sends steps: []', async () => {
    const name = uniqueName('ClearSteps');
    const slug = uniqueSlug('clear-steps');
    const create = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name,
        slug,
        steps: [{ processing_job_id: processingJobId, step_key: 'will-go', name: 'Will Go' }],
      });
    expect(create.status).toBe(201);
    cleanupWorkflowIds.push(create.body.id);

    const wfId = create.body.id;

    const update = await request(app).put(`/api/workflows/${wfId}`).set(authHeaders()).send({ steps: [] });
    expect(update.status).toBe(200);

    const get = await request(app).get(`/api/workflows/${wfId}`).set(authHeaders());
    expect(get.status).toBe(200);
    expect(get.body.steps).toHaveLength(0);
  });

  /* ── Duplicate step_key → 409 ─────────────────────────────── */

  it('rejects a step with a duplicate step_key on the same workflow with 409', async () => {
    await request(app).post(`/api/workflows/${workflowId}/steps`).set(authHeaders()).send({
      processing_job_id: processingJobId,
      step_key: 'unique-key',
      name: 'First',
      sort_order: 50,
    });

    const dup = await request(app).post(`/api/workflows/${workflowId}/steps`).set(authHeaders()).send({
      processing_job_id: processingJobId,
      step_key: 'unique-key',
      name: 'Duplicate',
      sort_order: 51,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('step with this key already exists');
  });

  /* ── PUT workflow with duplicate slug → 409 ───────────────── */

  it('rejects PUT with a slug that already belongs to another workflow', async () => {
    const slug1 = uniqueSlug('slug-owner');
    const slug2 = uniqueSlug('slug-thief');

    const owner = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name: uniqueName('Owner'), slug: slug1 });
    expect(owner.status).toBe(201);
    cleanupWorkflowIds.push(owner.body.id);

    const thief = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name: uniqueName('Thief'), slug: slug2 });
    expect(thief.status).toBe(201);
    cleanupWorkflowIds.push(thief.body.id);

    const res = await request(app).put(`/api/workflows/${thief.body.id}`).set(authHeaders()).send({ slug: slug1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('slug already exists');
  });

  /* ── Warnings in response ─────────────────────────────────── */

  it('returns warnings for duplicate sort_order in inline steps', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({
        name: uniqueName('DupSort'),
        slug: uniqueSlug('dup-sort'),
        steps: [
          { processing_job_id: processingJobId, step_key: 'sa', name: 'A', sort_order: 1 },
          { processing_job_id: processingJobId, step_key: 'sb', name: 'B', sort_order: 1 },
        ],
      });
    expect(res.status).toBe(201);
    cleanupWorkflowIds.push(res.body.id);
    expect(res.body).toHaveProperty('warnings');
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.warnings[0]).toContain('sort_order');
  });

  /* ── Tier 2: Backend completeness ─────────────────────────── */

  it('rejects PUT with invalid ai_profile_id', async () => {
    const create = await request(app)
      .post('/api/workflows')
      .set(authHeaders())
      .send({ name: uniqueName('PutBadProfile'), slug: uniqueSlug('put-bad-prof') });
    expect(create.status).toBe(201);
    cleanupWorkflowIds.push(create.body.id);

    const res = await request(app)
      .put(`/api/workflows/${create.body.id}`)
      .set(authHeaders())
      .send({ ai_profile_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'ai_profile_id' })]));
  });

  it('rejects standalone step with invalid UUID processing_job_id', async () => {
    const res = await request(app)
      .post(`/api/workflows/${workflowId}/steps`)
      .set(authHeaders())
      .send({ processing_job_id: 'not-a-uuid', step_key: 'bad-uuid', name: 'Bad UUID' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'processing_job_id' })]));
  });

  it('rejects standalone step missing required name', async () => {
    const res = await request(app)
      .post(`/api/workflows/${workflowId}/steps`)
      .set(authHeaders())
      .send({ processing_job_id: processingJobId, step_key: 'no-name' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name' })]));
  });

  it('lists steps via GET /api/workflows/:id/steps', async () => {
    const res = await request(app).get(`/api/workflows/${workflowId}/steps`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('auto-generates slug from name when slug omitted', async () => {
    const name = uniqueName('Auto Slug');
    const res = await request(app).post('/api/workflows').set(authHeaders()).send({ name, slug: '' });

    if (res.status === 201) {
      cleanupWorkflowIds.push(res.body.id);
      expect(res.body.slug).toMatch(/^auto-slug/);
    } else {
      expect(res.status).toBe(400);
    }
  });
});
