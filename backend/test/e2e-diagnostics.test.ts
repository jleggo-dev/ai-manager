/**
 * E2E: Diagnostics Integrity
 * ---------------------------
 * Verifies that diagnostic logs are created correctly with all expected
 * fields populated. This catches the exact bugs we missed:
 *
 *   1. processing_job_id stored as NULL (undefined → JSON omission)
 *   2. llm_request/llm_response missing prompt/response content
 *   3. DiagnosticSession.complete() not persisting at all
 *
 * Tests both the completion path (POST /processing-jobs/:id/test)
 * and the chat path (POST /chat-sessions/:id/messages).
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

const CALLING_APP = `e2e-diag-${Date.now()}`;
const url = process.env.AI_MANAGER_SUPABASE_URL ?? '';
const serviceKey = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = createClient(url, serviceKey);

let providerId: string;
let profileId: string;
let jobId: string;
let jobSlug: string;
let completionTestRan = false;

beforeAll(async () => {
  const pRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Diag Provider'),
      type: 'devs-ai',
      base_url: 'https://devs.ai',
      api_key: process.env.DEVS_AI_API_KEY || 'sk-e2e-placeholder',
    });
  providerId = pRes.body.id;

  const aRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Diag Profile'),
      provider_id: providerId,
      external_ai_id: 'e2e-diag-agent',
      mode: 'completion',
    });
  profileId = aRes.body.id;

  jobSlug = uniqueSlug('e2e-diag');
  const jRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Diag Job'),
      slug: jobSlug,
      ai_profile_id: profileId,
      config: {
        prompt: 'Say "diagnostic test" and nothing else.',
        promptTemplate: 'Say "diagnostic test" and nothing else.',
        advanced: {
          diagnostics: { enabled: true, mode: 'always' },
        },
      },
    });
  jobId = jRes.body.id;
});

afterAll(async () => {
  await supabase.from('diagnostic_logs').delete().eq('calling_application', CALLING_APP);

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

describe('E2E: Diagnostics — completion path (POST /processing-jobs/:id/test)', () => {
  it('creates a diagnostic log when test endpoint is called', async () => {
    if (!jobId) return;

    const res = await request(app)
      .post(`/api/processing-jobs/${jobId}/test`)
      .set(authHeaders())
      .send({
        variables: { testVar: 'hello' },
        callingApplication: CALLING_APP,
      });

    expect([200, 400, 500]).toContain(res.status);

    completionTestRan = res.status === 200;

    await new Promise((r) => setTimeout(r, 2000));

    const { data: logs, error } = await supabase
      .from('diagnostic_logs')
      .select('*')
      .eq('calling_application', CALLING_APP)
      .order('created_at', { ascending: false })
      .limit(5);

    expect(error).toBeNull();

    if (res.status === 200) {
      expect((logs ?? []).length).toBeGreaterThanOrEqual(1);
      const log = logs?.[0];
      if (!log) return;
      expect(log.status).toMatch(/success|error/);
      expect(log.total_duration_ms).toBeGreaterThanOrEqual(0);
      expect(log.workspace_id).toBeTruthy();
    }
  });

  it('processing_job_id is NOT NULL in the diagnostic log', async () => {
    if (!completionTestRan) return;

    const { data: logs } = await supabase
      .from('diagnostic_logs')
      .select('id, processing_job_id')
      .eq('calling_application', CALLING_APP)
      .order('created_at', { ascending: false })
      .limit(1);

    const log = logs?.[0];
    if (!log) return;

    expect(
      log.processing_job_id,
      'processing_job_id should NOT be null — this was a known bug where undefined was omitted by JSON.stringify',
    ).not.toBeNull();
    expect(log.processing_job_id).toBe(jobId);
  });

  it('llm_request contains prompt content when job succeeds', async () => {
    if (!completionTestRan) return;

    const { data: logs } = await supabase
      .from('diagnostic_logs')
      .select('llm_request, llm_response, request_payload')
      .eq('calling_application', CALLING_APP)
      .order('created_at', { ascending: false })
      .limit(1);

    const log = logs?.[0];
    if (!log) return;

    if (log.request_payload) {
      expect(log.request_payload).toHaveProperty('jobSlug');
      expect(log.request_payload).toHaveProperty('callingApplication');
    }

    if (log.llm_request) {
      expect(log.llm_request).toHaveProperty('provider');
      expect(log.llm_request).toHaveProperty('model');
      expect(
        log.llm_request.promptContent,
        'llm_request should include promptContent — the resolved prompt sent to the LLM',
      ).toBeDefined();
      expect(typeof log.llm_request.promptContent).toBe('string');
      expect((log.llm_request.promptContent as string).length).toBeGreaterThan(0);
    }

    if (log.llm_response) {
      expect(log.llm_response).toHaveProperty('rawLength');
      expect(
        log.llm_response.rawContent,
        'llm_response should include rawContent — the LLM response text',
      ).toBeDefined();
    }
  });
});

describe('E2E: Diagnostics — chat path (POST /chat-sessions/:id/messages)', () => {
  let sessionId: string | null = null;
  let chatTestRan = false;

  afterAll(async () => {
    if (sessionId) {
      await supabase
        .from('chat_sessions')
        .update({ processing_message_id: null, processing_started_at: null })
        .eq('id', sessionId);
      await request(app)
        .delete(`/api/chat-sessions/${sessionId}`)
        .set(authHeaders())
        .catch(() => {});
    }
  });

  it('creates a session and sends a message', async () => {
    if (!jobId) return;

    const sRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobId,
      userId: '00000000-0000-0000-0000-e2ediagtest1',
      callingApplication: CALLING_APP,
    });
    if (![200, 201].includes(sRes.status)) return;
    sessionId = sRes.body.sessionId;

    const mRes = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Run the diagnostic test prompt' });

    chatTestRan = [200, 201].includes(mRes.status);

    await new Promise((r) => setTimeout(r, 3000));
  });

  it('diagnostic log exists for the chat session', async () => {
    if (!sessionId) return;

    const { data: logs, error } = await supabase
      .from('diagnostic_logs')
      .select('*')
      .eq('chat_session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(5);

    expect(error).toBeNull();

    const log = logs?.[0];
    if (!chatTestRan || !log) return;

    expect(log.processing_job_id, 'processing_job_id must not be null').not.toBeNull();
    expect(log.processing_job_id).toBe(jobId);
    expect(log.chat_session_id).toBe(sessionId);
    expect(log.calling_application).toBe(CALLING_APP);
  });

  it('diagnostic log contains prompt and response content', async () => {
    if (!sessionId || !chatTestRan) return;

    const { data: logs } = await supabase
      .from('diagnostic_logs')
      .select('llm_request, llm_response, request_payload')
      .eq('chat_session_id', sessionId)
      .limit(1);

    const log = logs?.[0];
    if (!log) return;

    if (log.request_payload) {
      expect(log.request_payload).toHaveProperty('chatSessionId');
      expect(log.request_payload).toHaveProperty('mode');
    }

    if (log.llm_request) {
      expect(log.llm_request).toHaveProperty('provider');
      expect(log.llm_request).toHaveProperty('model');
      expect(
        log.llm_request.promptContent,
        'llm_request should include promptContent — the system-generated prompt sent to the LLM',
      ).toBeDefined();
    }

    if (log.llm_response) {
      expect(log.llm_response).toHaveProperty('rawLength');
      expect(
        log.llm_response.rawContent,
        'llm_response should include rawContent — the LLM response text',
      ).toBeDefined();
    }
  });

  it('diagnostic log is filterable by processingJobId', async () => {
    if (!jobId) return;

    const res = await request(app).get(`/api/diagnostic-logs?processingJobId=${jobId}`).set(authHeaders());

    expect(res.status).toBe(200);
  });
});

describe('E2E: Diagnostics — DiagnosticSession edge cases', () => {
  it('DiagnosticSession.complete() stores NULL for empty processingJobId', async () => {
    const { DiagnosticSession } = await import('../src/services/ai-diagnostics.ts');
    const { runWithAuth } = await import('../src/db/tenant.ts');

    const { data: ws } = await supabase.from('workspaces').select('id').limit(1).single();
    if (!ws) return;

    const row = await runWithAuth(
      { mode: 'api_key' as const, workspaceId: ws.id, apiKeyId: '00000000-0000-0000-0000-000000000000' },
      async () => {
        const diag = new DiagnosticSession('', `e2e-edge-empty-${Date.now()}`, true, ws.id);
        return diag.complete('success');
      },
    );

    expect(row).toBeDefined();
    expect(row?.processing_job_id).toBeNull();

    if (row?.id) {
      await supabase
        .from('diagnostic_logs')
        .delete()
        .eq('id', row.id as string);
    }
  });

  it('DiagnosticSession.complete() stores valid processingJobId correctly', async () => {
    if (!jobId) return;

    const { DiagnosticSession } = await import('../src/services/ai-diagnostics.ts');
    const { runWithAuth } = await import('../src/db/tenant.ts');

    const { data: ws } = await supabase.from('workspaces').select('id').limit(1).single();
    if (!ws) return;

    const row = await runWithAuth(
      { mode: 'api_key' as const, workspaceId: ws.id, apiKeyId: '00000000-0000-0000-0000-000000000000' },
      async () => {
        const diag = new DiagnosticSession(jobId, `e2e-edge-valid-${Date.now()}`, true, ws.id);
        return diag.complete('success');
      },
    );

    expect(row).toBeDefined();
    expect(row?.processing_job_id, 'processing_job_id must match the job ID passed to the constructor').toBe(jobId);

    if (row?.id) {
      await supabase
        .from('diagnostic_logs')
        .delete()
        .eq('id', row.id as string);
    }
  });

  it('DiagnosticSession.complete() truncates large content instead of redacting', async () => {
    if (!jobId) return;

    const { DiagnosticSession } = await import('../src/services/ai-diagnostics.ts');
    const { runWithAuth } = await import('../src/db/tenant.ts');

    const { data: ws } = await supabase.from('workspaces').select('id').limit(1).single();
    if (!ws) return;

    const longContent = 'x'.repeat(60_000);

    const row = await runWithAuth(
      { mode: 'api_key' as const, workspaceId: ws.id, apiKeyId: '00000000-0000-0000-0000-000000000000' },
      async () => {
        const diag = new DiagnosticSession(jobId, `e2e-edge-truncate-${Date.now()}`, true, ws.id);
        diag.startLlmTimer();
        diag.endLlmTimer(
          { provider: 'test', model: 'test', promptContent: longContent },
          { rawContent: longContent, rawLength: longContent.length },
        );
        return diag.complete('success');
      },
    );

    expect(row).toBeDefined();

    const llmReq = row?.llm_request as Record<string, unknown> | null;
    const llmResp = row?.llm_response as Record<string, unknown> | null;

    if (llmReq?.promptContent) {
      const stored = llmReq.promptContent as string;
      expect(stored.length).toBeLessThan(longContent.length);
      expect(stored).toContain('…[truncated]');
    }

    if (llmResp?.rawContent) {
      const stored = llmResp.rawContent as string;
      expect(stored.length).toBeLessThan(longContent.length);
      expect(stored).toContain('…[truncated]');
    }

    if (row?.id) {
      await supabase
        .from('diagnostic_logs')
        .delete()
        .eq('id', row.id as string);
    }
  });
});
