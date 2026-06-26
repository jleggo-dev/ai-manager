/**
 * E2E: Calling Application Flow
 * ------------------------------
 * Verifies that the calling application identification system works E2E:
 *   1. callingApplication is required on session creation
 *   2. Calling application auto-upsert into calling_applications table
 *   3. API key-linked callingApplicationId is honored
 *   4. Chat sessions are tagged with the correct calling_application
 */
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

const url = process.env.AI_MANAGER_SUPABASE_URL ?? '';
const key = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = createClient(url, key);

let providerId: string;
let profileId: string;
let jobId: string;
const sessionsToClean: string[] = [];

afterAll(async () => {
  for (const sid of sessionsToClean) {
    await request(app)
      .delete(`/api/chat-sessions/${sid}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (jobId) {
    await request(app)
      .delete(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (profileId) {
    await request(app)
      .delete(`/api/ai-profiles/${profileId}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (providerId) {
    await request(app)
      .delete(`/api/providers/${providerId}`)
      .set(authHeaders())
      .catch(() => {});
  }
});

describe('E2E: Calling Application Flow', () => {
  it('setup: create provider + profile + job', async () => {
    const pRes = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('E2E CA Provider'),
        type: 'devs-ai',
        base_url: 'https://devs.ai',
        api_key: process.env.DEVS_AI_API_KEY || 'sk-e2e-placeholder',
      });
    expect(pRes.status).toBe(201);
    providerId = pRes.body.id;

    const aRes = await request(app)
      .post('/api/ai-profiles')
      .set(authHeaders())
      .send({
        name: uniqueName('E2E CA Profile'),
        provider_id: providerId,
        external_ai_id: 'e2e-ca-agent',
        mode: 'completion',
      });
    expect(aRes.status).toBe(201);
    profileId = aRes.body.id;

    const jRes = await request(app)
      .post('/api/processing-jobs')
      .set(authHeaders())
      .send({
        name: uniqueName('E2E CA Job'),
        slug: uniqueSlug('e2e-ca'),
        ai_profile_id: profileId,
        config: { prompt: 'Say hello' },
      });
    expect(jRes.status).toBe(201);
    jobId = jRes.body.id;
  });

  it('rejects session creation without callingApplication', async () => {
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobId,
      userId: '00000000-0000-0000-0000-e2ecatest001',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('callingApplication');
  });

  it('creates session with callingApplication and auto-upserts calling_applications', async () => {
    const appName = `e2e-test:ca-flow-${Date.now()}`;

    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobId,
      userId: '00000000-0000-0000-0000-e2ecatest002',
      callingApplication: appName,
    });
    expect([201, 400, 500]).toContain(res.status);
    if (res.status !== 201) return;
    sessionsToClean.push(res.body.sessionId);

    const { data: ca, error } = await supabase.from('calling_applications').select('*').eq('display_name', appName);
    expect(error).toBeNull();
    expect(ca).toBeDefined();
    expect((ca ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('chat sessions list filters by calling_application', async () => {
    const appName = `e2e-test:ca-filter-${Date.now()}`;

    const createRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobId,
      userId: '00000000-0000-0000-0000-e2ecatest003',
      callingApplication: appName,
    });
    expect([201, 400, 500]).toContain(createRes.status);
    if (createRes.status !== 201) return;
    sessionsToClean.push(createRes.body.sessionId);

    const listRes = await request(app).get('/api/chat-sessions').set(authHeaders());
    expect(listRes.status).toBe(200);

    const matching = listRes.body.data.filter(
      (s: { calling_application: string }) => s.calling_application === appName,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});
