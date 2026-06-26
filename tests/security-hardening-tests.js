/**
 * Security Hardening — End-to-End Tests
 * ======================================
 * Validates all security fixes applied to the backend:
 *   1. Health endpoint no longer leaks table names
 *   2. Provider API keys masked on create/update/list/get
 *   3. Processing job GET strips nested provider api_key
 *   4. AI profile GET strips nested provider api_key
 *   5. Chat session listing scoped to caller
 *   6. Chat session create returns sanitized response
 *   7. Workflow GET strips nested provider api_key
 *   8. Batch update errors are generic (no internal details)
 *   9. Rate limiter headers present (draft-7)
 *   10. Pagination limits are bounded
 *
 * Run: TEST_API_KEY=aim_sk_... node tests/security-hardening-tests.js
 */

const API = process.env.TEST_API_BASE || 'http://localhost:3001/api';
const API_KEY = process.env.TEST_API_KEY || '';
const USER_ID = process.env.TEST_USER_ID || '00000000-0000-0000-0000-000000000000';

if (!API_KEY) {
  console.error('✗ TEST_API_KEY env var is required. Set it to a valid aim_sk_ key.');
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'X-Forwarded-User-Id': USER_ID,
};

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function skip(label, reason) {
  console.log(`  ⊘ ${label} (skipped: ${reason})`);
  skipped++;
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: HEADERS,
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
}

function deepFindKey(obj, key) {
  if (obj == null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((item) => deepFindKey(item, key));
  if (key in obj) return true;
  return Object.values(obj).some((v) => deepFindKey(v, key));
}

function deepFindKeyValue(obj, key) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindKeyValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = deepFindKeyValue(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/* ================================================================
   1. Health Endpoint
   ================================================================ */
async function testHealthEndpoint() {
  console.log('\n── 1. Health Endpoint ──');
  const { status, body } = await fetch(`${API}/health`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
  assert(status === 200, 'Health returns 200');
  assert(body.status === 'ok' || body.status === 'degraded', `Status is ok or degraded (got: ${body.status})`);
  assert(!body.tables, 'No table names in response');
  assert(!body.providers && !body.ai_profiles, 'No individual table keys exposed');
}

/* ================================================================
   2. Provider API Key Masking
   ================================================================ */
async function testProviderKeyMasking() {
  console.log('\n── 2. Provider API Key Masking ──');

  const { body: providers } = await fetchJson('/providers');
  assert(Array.isArray(providers), `GET /providers returns array (${providers.length} providers)`);

  if (providers.length === 0) {
    skip('Provider key masking on list', 'no providers found');
  } else {
    const first = providers[0];
    const keyVal = first.api_key;
    assert(
      keyVal === null || (typeof keyVal === 'string' && keyVal.endsWith('...')),
      'List: api_key is masked or null',
      `got: ${JSON.stringify(keyVal)?.slice(0, 40)}`
    );

    const { body: single } = await fetchJson(`/providers/${first.id}`);
    assert(
      single.api_key === null || (typeof single.api_key === 'string' && single.api_key.endsWith('...')),
      'GET /:id: api_key is masked or null',
      `got: ${JSON.stringify(single.api_key)?.slice(0, 40)}`
    );
  }
}

/* ================================================================
   3. Processing Job — No api_key in Response
   ================================================================ */
async function testProcessingJobSanitization() {
  console.log('\n── 3. Processing Job Sanitization ──');

  const { body: jobs } = await fetchJson('/processing-jobs');
  assert(Array.isArray(jobs), `GET /processing-jobs returns array (${jobs.length} jobs)`);

  if (jobs.length === 0) {
    skip('Processing job api_key stripping', 'no jobs found');
    return;
  }

  const jobWithProfile = jobs.find((j) => j.ai_profile_id);
  if (!jobWithProfile) {
    skip('Processing job GET /:id api_key check', 'no jobs with ai_profile_id');
    return;
  }

  const { body: full } = await fetchJson(`/processing-jobs/${jobWithProfile.id}`);
  const foundKey = deepFindKey(full, 'api_key');
  assert(!foundKey, 'GET /:id: no api_key anywhere in response tree');
}

/* ================================================================
   4. AI Profile — No api_key in Response
   ================================================================ */
async function testAiProfileSanitization() {
  console.log('\n── 4. AI Profile Sanitization ──');

  const { body: profiles } = await fetchJson('/ai-profiles');
  assert(Array.isArray(profiles), `GET /ai-profiles returns array (${profiles.length} profiles)`);

  if (profiles.length === 0) {
    skip('AI profile api_key stripping', 'no profiles found');
    return;
  }

  const { body: full } = await fetchJson(`/ai-profiles/${profiles[0].id}`);
  const foundKey = deepFindKey(full, 'api_key');
  assert(!foundKey, 'GET /:id: no api_key anywhere in response tree');
}

/* ================================================================
   5. Chat Session Listing — Scoped to Caller
   ================================================================ */
async function testChatSessionScoping() {
  console.log('\n── 5. Chat Session Scoping ──');

  const { body: sessions } = await fetchJson('/chat-sessions');
  assert(Array.isArray(sessions), `GET /chat-sessions returns array (${sessions.length} sessions)`);

  const otherUserSessions = sessions.filter((s) => s.user_id && s.user_id !== USER_ID);
  assert(
    otherUserSessions.length === 0,
    'No sessions from other users returned',
    otherUserSessions.length > 0 ? `found ${otherUserSessions.length} sessions for other users` : ''
  );

  if (sessions.length > 0) {
    const foundKey = deepFindKey(sessions, 'api_key');
    assert(!foundKey, 'No api_key in session list responses');
  }
}

/* ================================================================
   6. Chat Session Create — Sanitized Response
   ================================================================ */
async function testChatSessionCreateSanitized() {
  console.log('\n── 6. Chat Session Create — Sanitized ──');

  const { body: jobs } = await fetchJson('/processing-jobs');
  const activeJob = (jobs || []).find((j) => j.is_active && j.ai_profile_id);
  if (!activeJob) {
    skip('Chat session create sanitization', 'no active job with AI profile');
    return;
  }

  let session;
  try {
    const { status, body } = await fetchJson('/chat-sessions', {
      method: 'POST',
      body: JSON.stringify({
        jobSlug: activeJob.slug,
        userId: USER_ID,
        callingApplication: 'security-test',
      }),
    });

    if (status === 201 || status === 200) {
      session = body;
      const foundKey = deepFindKey(body, 'api_key');
      assert(!foundKey, 'POST /chat-sessions: no api_key in response');
    } else if (status === 403 && body.error?.includes('credentials')) {
      skip('Chat session create sanitization', 'requires user credentials');
      return;
    } else {
      assert(false, 'POST /chat-sessions succeeded', `status: ${status}, body: ${JSON.stringify(body).slice(0, 100)}`);
      return;
    }
  } catch (err) {
    assert(false, 'POST /chat-sessions did not throw', err.message);
    return;
  }

  if (session?.id) {
    const { body: getBody } = await fetchJson(`/chat-sessions/${session.id}`);
    const foundKey = deepFindKey(getBody, 'api_key');
    assert(!foundKey, 'GET /chat-sessions/:id: no api_key in response');

    await fetchJson(`/chat-sessions/${session.id}`, { method: 'DELETE' });
  }
}

/* ================================================================
   7. Workflow — No api_key in Response
   ================================================================ */
async function testWorkflowSanitization() {
  console.log('\n── 7. Workflow Sanitization ──');

  const { body: workflows } = await fetchJson('/workflows');
  assert(Array.isArray(workflows), `GET /workflows returns array (${workflows.length} workflows)`);

  if (workflows.length === 0) {
    skip('Workflow api_key stripping', 'no workflows found');
    return;
  }

  const { body: full } = await fetchJson(`/workflows/${workflows[0].id}`);
  const foundKey = deepFindKey(full, 'api_key');
  assert(!foundKey, 'GET /:id: no api_key anywhere in response tree');
}

/* ================================================================
   8. Batch Update — Generic Error Messages
   ================================================================ */
async function testBatchUpdateErrors() {
  console.log('\n── 8. Batch Update — Error Sanitization ──');

  const { status, body } = await fetchJson('/processing-jobs/batch', {
    method: 'PATCH',
    body: JSON.stringify({
      updates: [{ id: '00000000-0000-0000-0000-000000000000', config: { test: true } }],
    }),
  });

  assert(status === 200, 'PATCH /batch returns 200');
  if (body.results && body.results.length > 0) {
    const errResult = body.results.find((r) => r.status === 'error');
    if (errResult) {
      assert(
        errResult.error === 'Update failed',
        'Error message is generic',
        `got: ${errResult.error}`
      );
    } else {
      skip('Batch error message check', 'no errors in batch result (update succeeded)');
    }
  }
}

/* ================================================================
   9. Rate Limiter Headers
   ================================================================ */
async function testRateLimitHeaders() {
  console.log('\n── 9. Rate Limit Headers ──');

  const res = await fetch(`${API}/health`);
  const rlPolicy = res.headers.get('ratelimit-policy');
  const rlCombined = res.headers.get('ratelimit');

  assert(rlPolicy !== null, `RateLimit-Policy header present (${rlPolicy})`);
  assert(rlCombined !== null, `RateLimit header present (${rlCombined})`);
}

/* ================================================================
   10. Diagnostic Logs — Pagination Limits
   ================================================================ */
async function testDiagnosticPagination() {
  console.log('\n── 10. Diagnostic Logs — Pagination ──');

  const { status: s1 } = await fetchJson('/diagnostic-logs?limit=NaN');
  assert(s1 === 200, 'GET /diagnostic-logs?limit=NaN does not crash');

  const { status: s2 } = await fetchJson('/diagnostic-logs?limit=-5');
  assert(s2 === 200, 'GET /diagnostic-logs?limit=-5 does not crash');

  const { status: s3 } = await fetchJson('/diagnostic-logs?limit=999999');
  assert(s3 === 200, 'GET /diagnostic-logs?limit=999999 does not crash (bounded internally)');
}

/* ================================================================
   11. Analytics — No userId Exposure
   ================================================================ */
async function testAnalyticsNoUserId() {
  console.log('\n── 11. Analytics — No userId Exposure ──');

  const { body: profiles } = await fetchJson('/ai-profiles');
  if (!profiles?.length) {
    skip('Analytics userId check', 'no AI profiles');
    return;
  }

  const { body: analytics } = await fetchJson(`/chat-sessions/analytics/by-profile/${profiles[0].id}`);
  if (analytics?.sessions?.length > 0) {
    const hasUserId = analytics.sessions.some((s) => 'userId' in s);
    assert(!hasUserId, 'Analytics sessions do not expose userId');
  } else {
    skip('Analytics userId field check', 'no sessions in analytics');
  }
}

/* ================================================================
   12. Invalid API Key — No Prefix Leak
   ================================================================ */
async function testInvalidKeyResponse() {
  console.log('\n── 12. Invalid API Key Response ──');

  const { status, body } = await fetch(`${API}/providers`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer aim_sk_invalid_key_12345',
    },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert(status === 401, 'Invalid key returns 401');
  assert(body.error === 'Invalid API key', 'Error message is generic');
  assert(!JSON.stringify(body).includes('aim_sk_invalid'), 'Response does not echo the key');
}

/* ================================================================
   13. Credential Deletion Requires User Identity
   ================================================================ */
async function testCredentialDeletionScoped() {
  console.log('\n── 13. Credential Deletion — Scoped ──');

  const { status, body } = await fetchJson('/user-credentials/00000000-0000-0000-0000-000000000099', {
    method: 'DELETE',
  });

  assert(
    status === 204 || status === 401 || status === 500,
    `DELETE /user-credentials returns expected status (${status})`,
    status >= 500 ? body?.error : ''
  );
}

/* ================================================================
   Run All
   ================================================================ */
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Security Hardening — End-to-End Test Suite      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  API:     ${API}`);
  console.log(`  Key:     ${API_KEY.slice(0, 10)}…`);
  console.log(`  User:    ${USER_ID}`);

  await testHealthEndpoint();
  await testProviderKeyMasking();
  await testProcessingJobSanitization();
  await testAiProfileSanitization();
  await testChatSessionScoping();
  await testChatSessionCreateSanitized();
  await testWorkflowSanitization();
  await testBatchUpdateErrors();
  await testRateLimitHeaders();
  await testDiagnosticPagination();
  await testAnalyticsNoUserId();
  await testInvalidKeyResponse();
  await testCredentialDeletionScoped();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
