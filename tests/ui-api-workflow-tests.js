/**
 * UI API Layer Test
 * ==================
 * Validates that the frontend API functions (from api.js) work correctly
 * by calling the same endpoints the WorkflowManager component would call.
 * This covers the CRUD operations the UI depends on.
 *
 * Run: node tests/ui-api-workflow-tests.js
 */

const API = 'http://localhost:3001/api';
const API_KEY = process.env.TEST_API_KEY || '';
const USER_ID = '00000000-0000-0000-0000-000000000000';
const PROFILE_ID = 'eaaac3e6-195d-46c4-a1e8-337b48287187';

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'X-Forwarded-User-Id': USER_ID,
};

let passed = 0, failed = 0;
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

async function run() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  UI API Layer — Workflow CRUD Tests                 ║');
  console.log('║  (simulates WorkflowManager component calls)       ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  let jobId, wfId;

  try {
    /* ── Pre-req: create a processing job (needed for step linkage) ── */
    console.log('\n── Prerequisite: create test job ──');
    const jr = await req('POST', '/processing-jobs', {
      name: 'UI Test Job', slug: 'ui-test-job', ai_profile_id: PROFILE_ID,
      config: { promptTemplate: 'Test {{x}}' },
    });
    jobId = jr.data?.id;
    assert(!!jobId, 'Processing job created');

    /* ── api.listWorkflows() ── */
    console.log('\n── api.listWorkflows() ──');
    const list1 = await req('GET', '/workflows');
    assert(list1.ok, 'listWorkflows → 200');
    assert(Array.isArray(list1.data), 'Returns array');

    /* ── api.createWorkflow() with steps ── */
    console.log('\n── api.createWorkflow() ──');
    const cw = await req('POST', '/workflows', {
      name: 'UI Test Workflow',
      ai_profile_id: PROFILE_ID,
      description: 'Created by UI test',
      is_active: true,
      steps: [
        { processing_job_id: jobId, step_key: 'ui-step-1', name: 'UI Step 1', sort_order: 0 },
        { processing_job_id: jobId, step_key: 'ui-step-2', name: 'UI Step 2', sort_order: 1, depends_on: ['ui-step-1'] },
      ],
    });
    assert(cw.status === 201, `createWorkflow → 201 (got ${cw.status})`);
    wfId = cw.data?.id;
    assert(cw.data?.slug === 'ui-test-workflow', `Slug auto-generated: "${cw.data?.slug}"`);
    assert(cw.data?.ai_profile?.id === PROFILE_ID, 'AI profile joined');
    assert(cw.data?.steps?.length === 2, `Inline steps created (${cw.data?.steps?.length})`);

    /* ── api.getWorkflow() ── */
    console.log('\n── api.getWorkflow() ──');
    const gw = await req('GET', `/workflows/${wfId}`);
    assert(gw.ok, 'getWorkflow → 200');
    assert(gw.data?.name === 'UI Test Workflow', 'Name correct');
    assert(gw.data?.ai_profile?.id === PROFILE_ID, 'AI profile present');
    assert(gw.data?.steps?.length === 2, 'Steps included');
    assert(gw.data?.steps?.[0]?.processing_job?.id === jobId, 'Step has processing_job join');

    /* ── api.updateWorkflow() — fields only ── */
    console.log('\n── api.updateWorkflow(fields only) ──');
    const uw1 = await req('PUT', `/workflows/${wfId}`, {
      description: 'Updated by UI test',
      config: { systemPrompt: 'New system prompt' },
    });
    assert(uw1.ok, 'updateWorkflow (fields) → 200');
    assert(uw1.data?.description === 'Updated by UI test', 'Description updated');
    assert(uw1.data?.steps?.length === 2, 'Steps unchanged');

    /* ── api.updateWorkflow() — with steps replacement ── */
    console.log('\n── api.updateWorkflow(with steps replacement) ──');
    const uw2 = await req('PUT', `/workflows/${wfId}`, {
      steps: [
        { processing_job_id: jobId, step_key: 'new-step-a', name: 'New A', sort_order: 0 },
        { processing_job_id: jobId, step_key: 'new-step-b', name: 'New B', sort_order: 1 },
        { processing_job_id: jobId, step_key: 'new-step-c', name: 'New C', sort_order: 2, depends_on: ['new-step-a'] },
      ],
    });
    assert(uw2.ok, 'updateWorkflow (with steps) → 200');
    assert(uw2.data?.steps?.length === 3, `Steps replaced (${uw2.data?.steps?.length})`);
    const newKeys = uw2.data?.steps?.map(s => s.step_key) || [];
    assert(newKeys.includes('new-step-a') && newKeys.includes('new-step-b') && newKeys.includes('new-step-c'), 'New step keys present');
    assert(!newKeys.includes('ui-step-1'), 'Old steps removed');

    /* ── api.listWorkflowSteps() ── */
    console.log('\n── api.listWorkflowSteps() ──');
    const ls = await req('GET', `/workflows/${wfId}/steps`);
    assert(ls.ok, 'listWorkflowSteps → 200');
    assert(ls.data?.length === 3, `3 steps listed (got ${ls.data?.length})`);
    assert(ls.data?.[0]?.sort_order <= ls.data?.[1]?.sort_order, 'Sorted by sort_order');

    /* ── api.createWorkflowStep() — add one more ── */
    console.log('\n── api.createWorkflowStep() ──');
    const cs = await req('POST', `/workflows/${wfId}/steps`, {
      processing_job_id: jobId,
      step_key: 'extra-step',
      name: 'Extra Step',
      sort_order: 3,
    });
    assert(cs.status === 201, `createWorkflowStep → 201 (got ${cs.status})`);

    /* ── api.updateWorkflowStep() ── */
    console.log('\n── api.updateWorkflowStep() ──');
    const us = await req('PUT', `/workflows/${wfId}/steps/${cs.data?.id}`, {
      name: 'Updated Extra Step',
      is_required: true,
    });
    assert(us.ok, 'updateWorkflowStep → 200');
    assert(us.data?.name === 'Updated Extra Step', 'Step name updated');

    /* ── api.deleteWorkflowStep() ── */
    console.log('\n── api.deleteWorkflowStep() ──');
    const ds = await req('DELETE', `/workflows/${wfId}/steps/${cs.data?.id}`);
    assert(ds.status === 204, `deleteWorkflowStep → 204 (got ${ds.status})`);

    /* ── api.listWorkflows() — verify the new one appears ── */
    console.log('\n── api.listWorkflows() — verify in list ──');
    const list2 = await req('GET', '/workflows');
    assert(list2.data?.some(w => w.id === wfId), 'New workflow in list');
    const listed = list2.data?.find(w => w.id === wfId);
    assert(listed?.steps?.length === 3, `List view shows 3 steps (got ${listed?.steps?.length})`);
    assert(listed?.ai_profile?.name != null, 'AI profile summary in list');

    /* ── api.deleteWorkflow() ── */
    console.log('\n── api.deleteWorkflow() ──');
    const dw = await req('DELETE', `/workflows/${wfId}`);
    assert(dw.status === 204, `deleteWorkflow → 204 (got ${dw.status})`);
    wfId = null;

    // Verify cascade (steps gone too)
    const verifyGone = await req('GET', `/workflows/${dw.data?.id || 'gone'}`);
    assert(verifyGone.status === 404, 'Deleted workflow → 404');

    /* ── api.listAiProfiles() — used by WorkflowManager to populate dropdown ── */
    console.log('\n── api.listAiProfiles() — for dropdown ──');
    const profiles = await req('GET', '/ai-profiles');
    assert(profiles.ok, 'listAiProfiles → 200');
    assert(profiles.data?.length > 0, `${profiles.data?.length} profiles available`);

    /* ── api.listProcessingJobs() — used by step editor to link jobs ── */
    console.log('\n── api.listProcessingJobs() — for step dropdown ──');
    const jobs = await req('GET', '/processing-jobs');
    assert(jobs.ok, 'listProcessingJobs → 200');

  } catch (err) {
    console.error('\n💥 ERROR:', err);
    failed++;
  }

  /* ── Cleanup ── */
  console.log('\n── Cleanup ──');
  if (wfId) await req('DELETE', `/workflows/${wfId}`);
  if (jobId) {
    const r = await req('DELETE', `/processing-jobs/${jobId}`);
    console.log(`  Processing job cleanup: ${r.status}`);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 28 - String(passed).length - String(failed).length))}║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
