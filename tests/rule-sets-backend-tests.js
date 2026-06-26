/**
 * Rule Sets — Backend Integration Test
 * -------------------------------------
 * Tests the full rule-set flow:
 *   1. Find a chat-mode processing job (or create one if none exists).
 *   2. Save ruleSets into config via PUT /api/processing-jobs/:id.
 *   3. Open a chat session with that job.
 *   4. Verify ruleSets are returned in the session response.
 *   5. Send a message using ruleSetKey + variables.
 *   6. Stream the SSE response and verify completion.
 *   7. Clean up.
 */

// fetch is global in Node 18+

const BASE = 'http://localhost:3001';
const API_KEY = process.env.TEST_API_KEY || '';

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_KEY}`,
};

let pass = 0;
let fail = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    fail++;
  }
}

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: r.status, json };
}

/* ── helpers ─────────────────────────────────── */

async function findChatJob() {
  const { status, json } = await req('GET', '/api/processing-jobs');
  ok('list jobs 200', status === 200, `status=${status}`);
  if (!Array.isArray(json)) return null;
  /* Prefer a chat-mode job; fall back to any active job for CI */
  return json.find((j) => j.ai_profile?.mode === 'chat')
    || json.find((j) => j.is_active)
    || null;
}

/* ── tests ───────────────────────────────────── */

async function testSaveRuleSets(jobId) {
  console.log('\n── 1. Save rule sets into job config ──');
  const ruleSets = [
    {
      key: 'test-analysis',
      name: 'Test Analysis',
      description: 'A simple test rule set',
      promptTemplate: 'Say hello and mention that the subject is {{subject}}. Respond in JSON: {"greeting": "..."}',
      variables: [{ name: 'subject', label: 'Subject', source: 'user' }],
      expectedFormat: 'json',
      formattingRules: [{ type: 'extract-json', order: 0, options: {} }],
      testData: { subject: 'rule sets testing' },
    },
    {
      key: 'test-summary',
      name: 'Test Summary',
      description: 'A second rule set',
      promptTemplate: 'Summarise this in one sentence: {{content}}',
      variables: [{ name: 'content', label: 'Content', source: 'pipeline' }],
      expectedFormat: 'text',
      formattingRules: [],
      testData: { content: 'The quick brown fox jumped over the lazy dog.' },
    },
  ];

  const { status, json } = await req('PUT', `/api/processing-jobs/${jobId}`, {
    config: { ruleSets },
  });
  ok('PUT job 200', status === 200, `status=${status}`);

  const saved = json?.config?.ruleSets;
  ok('ruleSets array saved', Array.isArray(saved) && saved.length === 2);
  ok('first key correct', saved?.[0]?.key === 'test-analysis');
  ok('second key correct', saved?.[1]?.key === 'test-summary');
  return Array.isArray(saved) && saved.length === 2;
}

async function testOpenSession(jobId) {
  console.log('\n── 2. Open chat session and verify ruleSets in response ──');
  const { status, json } = await req('POST', '/api/chat-sessions', {
    jobId,
    userId: 'test-rule-sets-user',
    callingApplication: 'ai-admin-test',
  });
  ok('POST chat-sessions 200/201', status === 200 || status === 201, `status=${status} err=${json?.error}`);
  ok('sessionId present', typeof json?.sessionId === 'string');
  ok('ruleSets in response', Array.isArray(json?.ruleSets), `got: ${JSON.stringify(json?.ruleSets)}`);
  ok('ruleSets has 2 entries', json?.ruleSets?.length === 2, `length=${json?.ruleSets?.length}`);
  ok('first ruleSet key', json?.ruleSets?.[0]?.key === 'test-analysis');
  return json?.sessionId || null;
}

async function testSendRuleSetMessage(sessionId) {
  console.log('\n── 3. Send message via ruleSetKey and stream response ──');

  const r = await fetch(`${BASE}/api/chat-sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      ruleSetKey: 'test-analysis',
      variables: { subject: 'AI rule sets' },
    }),
  });

  ok('POST messages 200', r.status === 200, `status=${r.status}`);

  /* Read SSE stream */
  let fullContent = '';
  let gotData = false;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const timeout = setTimeout(() => reader.cancel(), 15_000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') break;
        try {
          const parsed = JSON.parse(raw);
          const delta = parsed?.choices?.[0]?.delta?.content || parsed?.delta?.content || '';
          if (delta) { fullContent += delta; gotData = true; }
        } catch { /* non-JSON chunk */ }
      }
    }
  } catch (e) {
    ok('stream read error', false, e.message);
  } finally {
    clearTimeout(timeout);
  }

  ok('got streaming content', gotData, `content preview: "${fullContent.slice(0, 80)}"`);
  return fullContent;
}

async function testValidationErrors(sessionId) {
  console.log('\n── 4. Validation: mutual exclusivity ──');

  /* message + ruleSetKey should fail */
  const { status: s1, json: j1 } = await req('POST', `/api/chat-sessions/${sessionId}/messages`, {
    message: 'hello',
    ruleSetKey: 'test-analysis',
  });
  ok('message + ruleSetKey rejected (400)', s1 === 400, `status=${s1} err=${j1?.error}`);

  /* stepKey + ruleSetKey should fail */
  const { status: s2, json: j2 } = await req('POST', `/api/chat-sessions/${sessionId}/messages`, {
    stepKey: 'foo',
    ruleSetKey: 'test-analysis',
  });
  ok('stepKey + ruleSetKey rejected (400)', s2 === 400, `status=${s2} err=${j2?.error}`);

  /* no message/stepKey/ruleSetKey should fail */
  const { status: s3, json: j3 } = await req('POST', `/api/chat-sessions/${sessionId}/messages`, {});
  ok('missing trigger rejected (400)', s3 === 400, `status=${s3} err=${j3?.error}`);

  /* bad ruleSetKey should fail */
  const { status: s4, json: j4 } = await req('POST', `/api/chat-sessions/${sessionId}/messages`, {
    ruleSetKey: 'nonexistent-key',
    variables: {},
  });
  ok('bad ruleSetKey rejected (500 or 400)', s4 >= 400, `status=${s4} err=${j4?.error}`);
}

async function testCleanup(sessionId) {
  console.log('\n── 5. Cleanup: close session ──');
  const { status } = await req('DELETE', `/api/chat-sessions/${sessionId}`);
  ok('session deleted (200/204)', status === 200 || status === 204, `status=${status}`);
}

/* ── main ──────────────────────────────────────── */

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Rule Sets — Backend Integration Tests  ║');
  console.log('╚══════════════════════════════════════════╝');

  const job = await findChatJob();
  if (!job) {
    console.error('\n✗ No chat-mode processing job found. Create one in AI Admin first.\n');
    process.exit(1);
  }
  console.log(`\nUsing job: "${job.name}" (${job.id})`);
  console.log(`Profile: ${job.ai_profile?.name} [mode=${job.ai_profile?.mode}]`);

  const saved = await testSaveRuleSets(job.id);
  if (!saved) {
    console.error('\nAborted — could not save rule sets.');
    process.exit(1);
  }

  const sessionId = await testOpenSession(job.id);
  if (!sessionId) {
    console.error('\nAborted — could not open chat session.');
    process.exit(1);
  }
  console.log(`\nSession ID: ${sessionId}`);

  await testSendRuleSetMessage(sessionId);
  await testValidationErrors(sessionId);
  await testCleanup(sessionId);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Passed: ${pass}   Failed: ${fail}`);
  console.log('─'.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
