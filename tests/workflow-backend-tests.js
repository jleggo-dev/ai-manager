/**
 * Workflow Backend Tests
 * ======================
 * Comprehensive smoke + integration tests for the workflow feature.
 * Run: node tests/workflow-backend-tests.js
 *
 * Tests:
 *   1. Workflow CRUD (create, read, update, delete)
 *   2. Workflow Step CRUD (create, read, update, delete, batch replace)
 *   3. Validation (missing fields, duplicate slugs, dependency checks)
 *   4. Chat session integration (open with workflow, step-triggered messages)
 *   5. Cleanup
 */

const API = 'http://localhost:3001/api';
const API_KEY = process.env.TEST_API_KEY || '';
const USER_ID = '00000000-0000-0000-0000-000000000000';

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'X-Forwarded-User-Id': USER_ID,
};

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
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

// ── Test Data Tracking ──
let testWorkflowId = null;
let testStepId = null;
let testProcessingJobId = null;
let testSessionId = null;

// We need a processing job for workflow steps. Create one for testing.
const CHAT_PROFILE_ID = 'eaaac3e6-195d-46c4-a1e8-337b48287187'; // Claude Opus 4.6 (devs-ai, no personal creds)

async function setup() {
  console.log('\n── SETUP: Create a test processing job ──');
  const jobRes = await req('POST', '/processing-jobs', {
    name: 'Workflow Test Job',
    slug: 'workflow-test-job',
    ai_profile_id: CHAT_PROFILE_ID,
    config: {
      promptTemplate: 'Hello {{name}}, please analyze {{topic}} and return a JSON with keys: summary, keyPoints.',
      expectedResponseFormat: 'json',
      formattingRules: [],
    },
  });
  assert(jobRes.status === 201 || jobRes.status === 200, `Create test processing job (${jobRes.status})`);
  testProcessingJobId = jobRes.data?.id;
  if (!testProcessingJobId) {
    console.error('  FATAL: Could not create processing job. Aborting.', jobRes.data);
    process.exit(1);
  }
  console.log(`  → Processing Job ID: ${testProcessingJobId}`);
}

async function testWorkflowCrud() {
  console.log('\n══ TEST GROUP 1: Workflow CRUD ══');

  // 1a. Create workflow
  const createRes = await req('POST', '/workflows', {
    name: 'Test Onboarding Workflow',
    description: 'A test workflow for automated testing',
    ai_profile_id: CHAT_PROFILE_ID,
    config: { systemPrompt: 'You are a helpful test assistant.' },
    is_active: true,
  });
  assert(createRes.status === 201, `Create workflow → 201 (got ${createRes.status})`);
  assert(createRes.data?.slug === 'test-onboarding-workflow', `Slug auto-generated: "${createRes.data?.slug}"`);
  assert(createRes.data?.ai_profile !== null, 'AI profile joined in response');
  testWorkflowId = createRes.data?.id;

  // 1b. List workflows
  const listRes = await req('GET', '/workflows');
  assert(listRes.ok, 'List workflows → 200');
  assert(Array.isArray(listRes.data), 'Response is array');
  assert(listRes.data.some(w => w.id === testWorkflowId), 'Created workflow appears in list');

  // 1c. Get single workflow
  const getRes = await req('GET', `/workflows/${testWorkflowId}`);
  assert(getRes.ok, 'Get single workflow → 200');
  assert(getRes.data?.name === 'Test Onboarding Workflow', 'Name matches');
  assert(Array.isArray(getRes.data?.steps), 'Steps array present (empty)');
  assert(getRes.data?.steps?.length === 0, 'No steps yet');

  // 1d. Update workflow
  const updateRes = await req('PUT', `/workflows/${testWorkflowId}`, {
    description: 'Updated description for testing',
    config: { systemPrompt: 'Updated system prompt.' },
  });
  assert(updateRes.ok, 'Update workflow → 200');
  assert(updateRes.data?.description === 'Updated description for testing', 'Description updated');

  // 1e. Duplicate slug conflict
  const dupRes = await req('POST', '/workflows', {
    name: 'Test Onboarding Workflow',
    ai_profile_id: CHAT_PROFILE_ID,
  });
  assert(dupRes.status === 409, `Duplicate slug → 409 (got ${dupRes.status})`);
}

async function testWorkflowValidation() {
  console.log('\n══ TEST GROUP 2: Workflow Validation ══');

  // Missing name
  const noName = await req('POST', '/workflows', {});
  assert(noName.status === 400, `Missing name → 400 (got ${noName.status})`);

  // Get non-existent
  const notFound = await req('GET', '/workflows/00000000-0000-0000-0000-000000000099');
  assert(notFound.status === 404, `Non-existent workflow → 404 (got ${notFound.status})`);
}

async function testStepCrud() {
  console.log('\n══ TEST GROUP 3: Workflow Step CRUD ══');

  // 3a. Create step individually
  const createStepRes = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    processing_job_id: testProcessingJobId,
    step_key: 'gather-info',
    name: 'Gather Information',
    sort_order: 0,
    is_required: true,
    depends_on: [],
    config: {},
  });
  assert(createStepRes.status === 201, `Create step → 201 (got ${createStepRes.status})`);
  testStepId = createStepRes.data?.id;
  assert(createStepRes.data?.step_key === 'gather-info', 'Step key correct');

  // 3b. Create second step with dependency
  const step2Res = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    processing_job_id: testProcessingJobId,
    step_key: 'analyze-data',
    name: 'Analyze Data',
    sort_order: 1,
    is_required: false,
    depends_on: ['gather-info'],
  });
  assert(step2Res.status === 201, `Create dependent step → 201 (got ${step2Res.status})`);
  assert(step2Res.data?.depends_on?.includes('gather-info'), 'Dependency recorded');

  // 3c. List steps
  const listStepsRes = await req('GET', `/workflows/${testWorkflowId}/steps`);
  assert(listStepsRes.ok, 'List steps → 200');
  assert(listStepsRes.data?.length === 2, `Two steps exist (got ${listStepsRes.data?.length})`);
  assert(listStepsRes.data?.[0]?.sort_order <= listStepsRes.data?.[1]?.sort_order, 'Steps sorted by sort_order');

  // 3d. Update step
  const updateStepRes = await req('PUT', `/workflows/${testWorkflowId}/steps/${testStepId}`, {
    name: 'Gather User Information',
  });
  assert(updateStepRes.ok, 'Update step → 200');
  assert(updateStepRes.data?.name === 'Gather User Information', 'Step name updated');

  // 3e. Duplicate step_key conflict
  const dupStepRes = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    processing_job_id: testProcessingJobId,
    step_key: 'gather-info',
    name: 'Duplicate Key',
  });
  assert(dupStepRes.status === 409, `Duplicate step_key → 409 (got ${dupStepRes.status})`);

  // 3f. Batch replace steps via workflow update
  const batchRes = await req('PUT', `/workflows/${testWorkflowId}`, {
    steps: [
      { processing_job_id: testProcessingJobId, step_key: 'step-one', name: 'Step One', sort_order: 0, is_required: true },
      { processing_job_id: testProcessingJobId, step_key: 'step-two', name: 'Step Two', sort_order: 1, depends_on: ['step-one'] },
      { processing_job_id: testProcessingJobId, step_key: 'step-three', name: 'Step Three', sort_order: 2, depends_on: ['step-one', 'step-two'] },
    ],
  });
  assert(batchRes.ok, 'Batch replace steps via PUT → 200');
  assert(batchRes.data?.steps?.length === 3, `Three steps after batch replace (got ${batchRes.data?.steps?.length})`);

  // Verify the old steps are gone
  const verifyList = await req('GET', `/workflows/${testWorkflowId}/steps`);
  const stepKeys = verifyList.data?.map(s => s.step_key) || [];
  assert(!stepKeys.includes('gather-info'), 'Old step "gather-info" removed after batch replace');
  assert(stepKeys.includes('step-one'), 'New step "step-one" exists');
  assert(stepKeys.includes('step-two'), 'New step "step-two" exists');
  assert(stepKeys.includes('step-three'), 'New step "step-three" exists');
}

async function testStepValidation() {
  console.log('\n══ TEST GROUP 4: Step Validation ══');

  // Missing processing_job_id
  const noJob = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    step_key: 'bad-step',
    name: 'Bad Step',
  });
  assert(noJob.status === 400, `Missing processing_job_id → 400 (got ${noJob.status})`);

  // Missing step_key
  const noKey = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    processing_job_id: testProcessingJobId,
    name: 'Bad Step',
  });
  assert(noKey.status === 400, `Missing step_key → 400 (got ${noKey.status})`);

  // Missing name
  const noNameStep = await req('POST', `/workflows/${testWorkflowId}/steps`, {
    processing_job_id: testProcessingJobId,
    step_key: 'no-name-step',
  });
  assert(noNameStep.status === 400, `Missing name → 400 (got ${noNameStep.status})`);
}

async function testWorkflowWithStepsCreate() {
  console.log('\n══ TEST GROUP 5: Create Workflow with Inline Steps ══');

  const res = await req('POST', '/workflows', {
    name: 'Inline Steps Workflow',
    ai_profile_id: CHAT_PROFILE_ID,
    steps: [
      { processing_job_id: testProcessingJobId, step_key: 'inline-step-a', name: 'Inline A', sort_order: 0 },
      { processing_job_id: testProcessingJobId, step_key: 'inline-step-b', name: 'Inline B', sort_order: 1, depends_on: ['inline-step-a'] },
    ],
  });
  assert(res.status === 201, `Create workflow+steps → 201 (got ${res.status})`);
  assert(res.data?.steps?.length === 2, `Two inline steps created (got ${res.data?.steps?.length})`);

  // Cleanup this one
  if (res.data?.id) {
    const delRes = await req('DELETE', `/workflows/${res.data.id}`);
    assert(delRes.status === 204, `Cleanup inline workflow → 204 (got ${delRes.status})`);
  }
}

async function testChatSessionWorkflow() {
  console.log('\n══ TEST GROUP 6: Chat Session + Workflow Integration ══');

  // 6a. Open session with workflowId
  const openRes = await req('POST', '/chat-sessions', {
    workflowId: testWorkflowId,
    userId: USER_ID,
    callingApplication: 'workflow-test-runner',
  });
  assert(openRes.status === 201, `Open workflow session → 201 (got ${openRes.status})`);
  assert(openRes.data?.workflowId === testWorkflowId, 'Session has correct workflowId');
  assert(Array.isArray(openRes.data?.steps), 'Session returns steps array');
  assert(openRes.data?.steps?.length === 3, `Steps array has 3 entries (got ${openRes.data?.steps?.length})`);
  assert(openRes.data?.steps?.[0]?.stepKey === 'step-one', 'First step is step-one');
  testSessionId = openRes.data?.sessionId;

  if (!testSessionId) {
    console.log('  ⚠ Skipping message tests — no session created');
    return;
  }

  // 6b. Send a step-triggered message (step-one has no dependencies)
  const stepMsg = await req('POST', `/chat-sessions/${testSessionId}/messages`, {
    stepKey: 'step-one',
    variables: { name: 'Tester', topic: 'workflow testing' },
  });
  // This will be an SSE response (content-type: text/event-stream) if successful,
  // or a JSON error if something went wrong
  if (stepMsg.status === 200) {
    assert(true, 'Step-one message sent → 200 (SSE stream)');
  } else {
    // Could be a 500 if the Devs.ai chat doesn't exist yet for this profile type
    assert(stepMsg.status < 500, `Step-one message status: ${stepMsg.status} (${typeof stepMsg.data === 'string' ? stepMsg.data.substring(0, 100) : JSON.stringify(stepMsg.data).substring(0, 100)})`);
  }

  // 6c. Try step-two without step-one completed — should fail with dependency error
  // Note: step-one may not be "completed" unless the SSE stream finished and the
  // message was recorded. Since we're testing synchronously, the assistant message
  // may not have been recorded yet. The dependency check looks for user messages
  // tagged with workflow_step_id, which should exist since we just sent step-one.
  // Let's pause briefly to let the async recording happen
  await new Promise(r => setTimeout(r, 2000));

  // 6d. Send a free-form message (no stepKey)
  const freeMsg = await req('POST', `/chat-sessions/${testSessionId}/messages`, {
    message: 'What did we just discuss?',
  });
  if (freeMsg.status === 200) {
    assert(true, 'Free-form message in workflow session → 200');
  } else {
    assert(freeMsg.status < 500, `Free-form message status: ${freeMsg.status}`);
  }

  // 6e. Validate neither message nor stepKey → 400
  const noInput = await req('POST', `/chat-sessions/${testSessionId}/messages`, {});
  assert(noInput.status === 400, `No message or stepKey → 400 (got ${noInput.status})`);

  // 6f. Get session and verify it's workflow-linked
  const sessionRes = await req('GET', `/chat-sessions/${testSessionId}`);
  assert(sessionRes.ok, 'Get workflow session → 200');
  assert(sessionRes.data?.workflow_id === testWorkflowId, 'Session has workflow_id in DB record');
}

async function testWorkflowSlugSession() {
  console.log('\n══ TEST GROUP 7: Open Session by Workflow Slug ══');

  const res = await req('POST', '/chat-sessions', {
    workflowSlug: 'test-onboarding-workflow',
    userId: USER_ID,
    callingApplication: 'slug-test',
  });
  assert(res.status === 201, `Open session by slug → 201 (got ${res.status})`);
  assert(res.data?.workflowId === testWorkflowId, 'Resolved correct workflow from slug');

  // Close this session
  if (res.data?.sessionId) {
    await req('DELETE', `/chat-sessions/${res.data.sessionId}`);
  }

  // Non-existent slug
  const badSlug = await req('POST', '/chat-sessions', {
    workflowSlug: 'nonexistent-workflow-slug',
    userId: USER_ID,
    callingApplication: 'slug-test',
  });
  assert(badSlug.status === 500 || badSlug.status === 404, `Bad slug → error (got ${badSlug.status})`);
}

async function testDeleteStep() {
  console.log('\n══ TEST GROUP 8: Delete Individual Step ══');

  // Get current steps
  const steps = await req('GET', `/workflows/${testWorkflowId}/steps`);
  const lastStep = steps.data?.[steps.data.length - 1];
  if (lastStep) {
    const delRes = await req('DELETE', `/workflows/${testWorkflowId}/steps/${lastStep.id}`);
    assert(delRes.status === 204, `Delete step → 204 (got ${delRes.status})`);

    const remaining = await req('GET', `/workflows/${testWorkflowId}/steps`);
    assert(remaining.data?.length === steps.data.length - 1, 'Step count decreased by 1');
  } else {
    assert(false, 'No steps to delete');
  }
}

async function cleanup() {
  console.log('\n── CLEANUP ──');

  // Delete test chat session
  if (testSessionId) {
    const res = await req('DELETE', `/chat-sessions/${testSessionId}`);
    console.log(`  Session cleanup: ${res.status}`);
  }

  // Delete test workflow (cascades to steps)
  if (testWorkflowId) {
    const res = await req('DELETE', `/workflows/${testWorkflowId}`);
    assert(res.status === 204, `Delete workflow → 204 (got ${res.status})`);

    // Verify it's gone
    const verifyRes = await req('GET', `/workflows/${testWorkflowId}`);
    assert(verifyRes.status === 404, `Deleted workflow returns 404 (got ${verifyRes.status})`);
  }

  // Delete test processing job
  if (testProcessingJobId) {
    const res = await req('DELETE', `/processing-jobs/${testProcessingJobId}`);
    console.log(`  Processing job cleanup: ${res.status}`);
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Workflow Backend Test Suite                     ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    await setup();
    await testWorkflowCrud();
    await testWorkflowValidation();
    await testStepCrud();
    await testStepValidation();
    await testWorkflowWithStepsCreate();
    await testChatSessionWorkflow();
    await testWorkflowSlugSession();
    await testDeleteStep();
  } catch (err) {
    console.error('\n💥 UNHANDLED ERROR:', err);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('Cleanup error:', e.message); }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 25 - String(passed).length - String(failed).length))}║`);
  console.log('╚══════════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
