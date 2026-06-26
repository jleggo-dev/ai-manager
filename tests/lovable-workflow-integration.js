/**
 * Lovable Workflow Integration Test
 * ===================================
 * Simulates what a Lovable frontend would do when calling AI Admin
 * through the integration patterns described in the handbook:
 *
 *   1. Create a processing job + workflow with steps
 *   2. Open a chat session with workflowSlug
 *   3. Trigger step-one (SSE stream, parse response)
 *   4. Trigger step-two (depends on step-one)
 *   5. Send free-form chat message interleaved
 *   6. Trigger step-three (depends on step-one + step-two)
 *   7. Attempt invalid step → expect error
 *   8. Cleanup
 *
 * Run: node tests/lovable-workflow-integration.js
 */

const API = 'http://localhost:3001/api';
const API_KEY = process.env.TEST_API_KEY || '';
const USER_ID = '00000000-0000-0000-0000-000000000000';
const PROFILE_ID = 'eaaac3e6-195d-46c4-a1e8-337b48287187'; // Claude Opus 4.6

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'X-Forwarded-User-Id': USER_ID,
};

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
}

async function req(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, ok: res.ok };
}

/**
 * Simulate Lovable's SSE stream consumption:
 * fetch() + ReadableStream reader, parse data: lines, accumulate content.
 */
async function streamMessage(sessionId, body) {
  const res = await fetch(`${API}/chat-sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, status: res.status, content: '', error: err };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let usageEvent = null;
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    const chunk = decoder.decode(value, { stream: true });

    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (dataStr === '[DONE]') { done = true; continue; }
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.type === 'usage') { usageEvent = parsed; continue; }
        const delta = parsed.choices?.[0]?.delta?.content
          || parsed.candidates?.[0]?.content?.parts?.[0]?.text
          || (typeof parsed.content === 'object' ? parsed.content?.text : parsed.content)
          || '';
        if (delta) fullContent += delta;
      } catch { /* non-JSON SSE line */ }
    }
  }

  return { ok: true, content: fullContent, usage: usageEvent };
}

// ── State ──
let jobId, workflowId, workflowSlug, sessionId;

async function run() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Lovable → AI Admin Workflow Integration Test       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  const t0 = Date.now();

  try {
    /* ── Phase 1: Setup ── */
    console.log('\n── Phase 1: Setup (create job + workflow) ──');

    const jobRes = await req('POST', '/processing-jobs', {
      name: 'Lovable Workflow Test Job',
      slug: 'lovable-wf-test-job',
      ai_profile_id: PROFILE_ID,
      config: {
        promptTemplate: 'Analyze {{topic}} for {{userName}}. Return JSON: { "summary": "...", "confidence": 0.0-1.0 }. Keep it under 50 words total.',
      },
    });
    assert(jobRes.status === 201, `Create processing job → 201 (got ${jobRes.status})`);
    jobId = jobRes.data?.id;

    const wfRes = await req('POST', '/workflows', {
      name: 'Lovable Integration Test WF',
      ai_profile_id: PROFILE_ID,
      config: { systemPrompt: 'You assist with product launch planning. Keep responses concise.' },
      is_active: true,
      steps: [
        { processing_job_id: jobId, step_key: 'initial-analysis', name: 'Initial Analysis', sort_order: 0, is_required: true },
        { processing_job_id: jobId, step_key: 'deep-dive', name: 'Deep Dive', sort_order: 1, depends_on: ['initial-analysis'] },
        { processing_job_id: jobId, step_key: 'final-report', name: 'Final Report', sort_order: 2, depends_on: ['initial-analysis', 'deep-dive'] },
      ],
    });
    assert(wfRes.status === 201, `Create workflow with 3 steps → 201 (got ${wfRes.status})`);
    workflowId = wfRes.data?.id;
    workflowSlug = wfRes.data?.slug;
    assert(wfRes.data?.steps?.length === 3, `Workflow has 3 steps (got ${wfRes.data?.steps?.length})`);
    console.log(`  → Workflow: ${workflowSlug} (${workflowId?.substring(0,8)}…)`);

    /* ── Phase 2: Open workflow session (like Lovable's open-chat-session) ── */
    console.log('\n── Phase 2: Open workflow session ──');

    const sessRes = await req('POST', '/chat-sessions', {
      workflowSlug,
      userId: USER_ID,
      callingApplication: 'lovable:integration-test',
    });
    assert(sessRes.status === 201, `Open session by workflowSlug → 201 (got ${sessRes.status})`);
    sessionId = sessRes.data?.sessionId;
    assert(!!sessionId, 'Session ID returned');
    assert(sessRes.data?.workflowId === workflowId, 'Correct workflowId in response');

    const steps = sessRes.data?.steps || [];
    assert(steps.length === 3, `Steps array has 3 items (got ${steps.length})`);
    assert(steps[0]?.stepKey === 'initial-analysis', `First step is "initial-analysis" (got "${steps[0]?.stepKey}")`);
    assert(steps[1]?.dependsOn?.includes('initial-analysis'), 'Step 2 depends on step 1');
    assert(steps[2]?.dependsOn?.length === 2, 'Step 3 has 2 dependencies');

    console.log(`  → Session: ${sessionId?.substring(0,8)}…`);
    console.log(`  → Steps: ${steps.map(s => s.stepKey).join(' → ')}`);

    /* ── Phase 3: Step-triggered messages with SSE streaming ── */
    console.log('\n── Phase 3: Step-triggered messages (SSE) ──');

    // 3a. Trigger initial-analysis (no dependencies)
    console.log('  Streaming step: initial-analysis...');
    const s1 = await streamMessage(sessionId, {
      stepKey: 'initial-analysis',
      variables: { topic: 'AI-powered workflow automation', userName: 'Lovable Tester' },
    });
    assert(s1.ok, `Step initial-analysis → stream OK`);
    assert(s1.content.length > 10, `Received ${s1.content.length} chars from stream`);
    console.log(`  → Response preview: ${s1.content.substring(0, 100)}…`);

    // Brief pause for async assistant message recording
    await new Promise(r => setTimeout(r, 1500));

    // 3b. Trigger deep-dive (depends on initial-analysis)
    console.log('  Streaming step: deep-dive...');
    const s2 = await streamMessage(sessionId, {
      stepKey: 'deep-dive',
      variables: { topic: 'implementation timeline', userName: 'Lovable Tester' },
    });
    assert(s2.ok, `Step deep-dive → stream OK (dependency satisfied)`);
    assert(s2.content.length > 10, `Received ${s2.content.length} chars from stream`);
    console.log(`  → Response preview: ${s2.content.substring(0, 100)}…`);

    await new Promise(r => setTimeout(r, 1500));

    /* ── Phase 4: Free-form chat interleaved ── */
    console.log('\n── Phase 4: Free-form chat (interleaved with workflow) ──');

    console.log('  Streaming free-form message...');
    const freeMsg = await streamMessage(sessionId, {
      message: 'Based on the analysis so far, what would you recommend as the top priority?',
    });
    assert(freeMsg.ok, 'Free-form message → stream OK');
    assert(freeMsg.content.length > 10, `Received ${freeMsg.content.length} chars`);
    console.log(`  → Response preview: ${freeMsg.content.substring(0, 100)}…`);

    await new Promise(r => setTimeout(r, 1500));

    /* ── Phase 5: Complete final step ── */
    console.log('\n── Phase 5: Final report step (all dependencies met) ──');

    console.log('  Streaming step: final-report...');
    const s3 = await streamMessage(sessionId, {
      stepKey: 'final-report',
      variables: { topic: 'complete launch plan', userName: 'Lovable Tester' },
    });
    assert(s3.ok, `Step final-report → stream OK (both dependencies met)`);
    assert(s3.content.length > 10, `Received ${s3.content.length} chars`);
    console.log(`  → Response preview: ${s3.content.substring(0, 100)}…`);

    /* ── Phase 6: Error cases ── */
    console.log('\n── Phase 6: Error handling ──');

    // 6a. Invalid step key
    const badStep = await req('POST', `/chat-sessions/${sessionId}/messages`, {
      stepKey: 'nonexistent-step',
      variables: {},
    });
    assert(badStep.status >= 400, `Invalid stepKey → error (got ${badStep.status})`);

    // 6b. No message or stepKey
    const emptyReq = await req('POST', `/chat-sessions/${sessionId}/messages`, {});
    assert(emptyReq.status === 400, `Empty body → 400 (got ${emptyReq.status})`);

    // 6c. Verify session history
    const historyRes = await req('GET', `/chat-sessions/${sessionId}`);
    assert(historyRes.ok, 'Get session history → 200');
    assert(historyRes.data?.workflow_id === workflowId, 'Session linked to workflow');

  } catch (err) {
    console.error('\n💥 UNHANDLED ERROR:', err);
    failed++;
  }

  /* ── Phase 7: Cleanup ── */
  console.log('\n── Phase 7: Cleanup ──');
  try {
    if (sessionId) {
      const r = await req('DELETE', `/chat-sessions/${sessionId}`);
      assert(r.status === 204, `Delete session → 204 (got ${r.status})`);
    }
    if (workflowId) {
      const r = await req('DELETE', `/workflows/${workflowId}`);
      assert(r.status === 204, `Delete workflow → 204 (got ${r.status})`);
    }
    if (jobId) {
      const r = await req('DELETE', `/processing-jobs/${jobId}`);
      assert(r.status === 204, `Delete processing job → 204 (got ${r.status})`);
    }
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }

  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed (${duration}s)${' '.repeat(Math.max(0, 20 - String(passed).length - String(failed).length - duration.length))}║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
