import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

describe('Health Checks API', () => {
  const createdProviderKeyIds: string[] = [];
  const createdProfileIds: string[] = [];
  const createdCheckIds: string[] = [];

  afterAll(async () => {
    for (const id of [...createdCheckIds].reverse()) {
      try {
        await request(app).delete(`/api/health-checks/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
    for (const id of [...createdProfileIds].reverse()) {
      try {
        await request(app).delete(`/api/health-checks/profiles/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
    for (const id of [...createdProviderKeyIds].reverse()) {
      try {
        await request(app).delete(`/api/health-checks/provider-keys/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  /* ── Prerequisites ─────────────────────────────────────────── */

  let testProviderId: string;

  it('GET /api/providers — find a stable provider to use', async () => {
    const res = await request(app).get('/api/providers?limit=100').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    /* Prefer a long-lived provider — list is newest-first, so data[0] is often an
       ephemeral e2e provider that another file's afterAll CASCADE-deletes mid-suite. */
    const rows: Array<{ id: string; name?: string; type?: string }> = res.body.data || [];
    const stable =
      rows.find((p) => p.name === 'Devs.ai' || p.name === 'Devs.ai v2' || p.name === 'Google Gemini') ||
      rows.find((p) => p.type === 'devs-ai' || p.type === 'devs-ai-v2' || p.type === 'google-gemini') ||
      rows[0];
    expect(stable?.id).toBeTruthy();
    testProviderId = stable!.id;
  });

  /* ── Provider Keys CRUD ────────────────────────────────────── */

  let providerKeyId: string;

  it('POST /api/health-checks/provider-keys — creates an HC provider key', async () => {
    const res = await request(app)
      .post('/api/health-checks/provider-keys')
      .set(authHeaders())
      .send({
        provider_id: testProviderId,
        name: uniqueName('HC Key'),
        api_key: 'sk-hc-test-key-12345',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.api_key).toBeUndefined();
    providerKeyId = res.body.id;
    createdProviderKeyIds.push(providerKeyId);
  });

  it('GET /api/health-checks/provider-keys — lists keys', async () => {
    const res = await request(app).get('/api/health-checks/provider-keys').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('PUT /api/health-checks/provider-keys/:id — updates key name', async () => {
    const newName = uniqueName('HC Key Updated');
    const res = await request(app)
      .put(`/api/health-checks/provider-keys/${providerKeyId}`)
      .set(authHeaders())
      .send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
  });

  /* ── HC Profiles CRUD ──────────────────────────────────────── */

  let profileId: string;

  it('POST /api/health-checks/profiles — creates an HC profile', async () => {
    const res = await request(app)
      .post('/api/health-checks/profiles')
      .set(authHeaders())
      .send({
        provider_id: testProviderId,
        hc_provider_key_id: providerKeyId,
        external_ai_id: 'test-model',
        name: uniqueName('HC Profile'),
        mode: 'completion',
        profile_type: 'model',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    profileId = res.body.id;
    createdProfileIds.push(profileId);
  });

  it('GET /api/health-checks/profiles — lists profiles', async () => {
    const res = await request(app).get('/api/health-checks/profiles').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('PUT /api/health-checks/profiles/:id — updates profile name', async () => {
    const newName = uniqueName('HC Profile Updated');
    const res = await request(app)
      .put(`/api/health-checks/profiles/${profileId}`)
      .set(authHeaders())
      .send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
  });

  /* ── Health Checks CRUD ────────────────────────────────────── */

  let checkId: string;

  it('POST /api/health-checks — creates a health check with outage_cadence_minutes', async () => {
    const res = await request(app)
      .post('/api/health-checks')
      .set(authHeaders())
      .send({
        health_check_profile_id: profileId,
        name: uniqueName('HC Test'),
        test_message: 'ping',
        cadence_minutes: 60,
        outage_cadence_minutes: 3,
        is_active: false,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.outage_cadence_minutes).toBe(3);
    checkId = res.body.id;
    createdCheckIds.push(checkId);
  });

  it('GET /api/health-checks — lists checks', async () => {
    const res = await request(app).get('/api/health-checks').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('PUT /api/health-checks/:id — updates check name', async () => {
    const newName = uniqueName('HC Test Updated');
    const res = await request(app).put(`/api/health-checks/${checkId}`).set(authHeaders()).send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
  });

  /* ── Runs and Dashboard ────────────────────────────────────── */

  it('GET /api/health-checks/:id/runs — returns empty runs initially', async () => {
    const res = await request(app).get(`/api/health-checks/${checkId}/runs`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('GET /api/health-checks/:id/incidents — returns empty incidents initially', async () => {
    const res = await request(app).get(`/api/health-checks/${checkId}/incidents`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('GET /api/health-checks/dashboard — returns dashboard with semaphore and outageCadenceMinutes', async () => {
    const res = await request(app).get('/api/health-checks/dashboard').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const item of res.body.data) {
      expect(item).toHaveProperty('semaphore');
      expect(['green', 'yellow', 'red', 'gray']).toContain(item.semaphore);
      expect(item).toHaveProperty('outageCadenceMinutes');
      expect(typeof item.outageCadenceMinutes).toBe('number');
    }
  });

  /* ── Validation ────────────────────────────────────────────── */

  it('POST /api/health-checks/provider-keys — rejects missing fields', async () => {
    const res = await request(app).post('/api/health-checks/provider-keys').set(authHeaders()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('POST /api/health-checks/profiles — rejects missing fields', async () => {
    const res = await request(app).post('/api/health-checks/profiles').set(authHeaders()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('POST /api/health-checks — rejects missing fields', async () => {
    const res = await request(app).post('/api/health-checks').set(authHeaders()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('POST /api/health-checks — rejects outage_cadence_minutes = 0', async () => {
    const res = await request(app)
      .post('/api/health-checks')
      .set(authHeaders())
      .send({
        health_check_profile_id: profileId,
        name: uniqueName('HC Boundary'),
        cadence_minutes: 5,
        outage_cadence_minutes: 0,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('POST /api/health-checks — rejects outage_cadence_minutes = 1441', async () => {
    const res = await request(app)
      .post('/api/health-checks')
      .set(authHeaders())
      .send({
        health_check_profile_id: profileId,
        name: uniqueName('HC Boundary'),
        cadence_minutes: 5,
        outage_cadence_minutes: 1441,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('PUT /api/health-checks/:id — accepts valid outage_cadence_minutes update', async () => {
    const res = await request(app)
      .put(`/api/health-checks/${checkId}`)
      .set(authHeaders())
      .send({ outage_cadence_minutes: 5 });
    expect(res.status).toBe(200);
    expect(res.body.outage_cadence_minutes).toBe(5);
  });

  /* ── Cleanup via DELETE ────────────────────────────────────── */

  it('DELETE /api/health-checks/:id — deletes the check', async () => {
    const res = await request(app).delete(`/api/health-checks/${checkId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const idx = createdCheckIds.indexOf(checkId);
    if (idx !== -1) createdCheckIds.splice(idx, 1);
  });

  it('DELETE /api/health-checks/profiles/:id — deletes the profile', async () => {
    const res = await request(app).delete(`/api/health-checks/profiles/${profileId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const idx = createdProfileIds.indexOf(profileId);
    if (idx !== -1) createdProfileIds.splice(idx, 1);
  });

  it('DELETE /api/health-checks/provider-keys/:id — deletes the key', async () => {
    const res = await request(app).delete(`/api/health-checks/provider-keys/${providerKeyId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const idx = createdProviderKeyIds.indexOf(providerKeyId);
    if (idx !== -1) createdProviderKeyIds.splice(idx, 1);
  });
});
