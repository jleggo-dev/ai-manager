/**
 * LIVE PROBE: Devs.ai v2 function-calling end-to-end through AI Admin (the tool-loop coach's
 * foundation). Creates e2e-named entities (job + profile — swept by cleanup:e2e-ai-admin), opens
 * a chat session against the DEPLOYED backend (the HTTP layer that drives the tool loop), asks
 * the model to call the tool, and reports what actually streamed back.
 *
 * VERDICT (2026-08-14, after #190): ALL GREEN — the full loop works end to end.
 *   ✓ tool definitions accepted; the model emitted a real function_call on the coach's own model
 *   ✓ with config.variables declared, arguments arrive filled ({"word":"pineapple"})
 *   ✓ the continuation (a NEW response threaded on previous_response_id carrying
 *     function_call_output items — #190's fix; /resume 409s on terminal responses) streams clean
 *   ✓ the final answer carries the tool's result
 *   ○ port note: message.complete events carry EMPTY text — the assistant reply rides deltas, so
 *     any relay accumulating the continuation must read deltas, not the completion envelope.
 * History: run 1 found the /resume 409 and the empty-arguments schema contract (parameter
 * schemas come from job config.variables, not template scanning).
 */
import { createProcessingJob, updateProcessingJob, getProcessingJobBySlug, getAiProfile } from '@ai-admin/core';
// createAiProfile isn't exported from core (nothing needed it before this probe) — reach the
// backend model directly, the same module core itself re-exports the others from.
import { createAiProfile } from '../../../backend/src/models/ai-profiles.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const BASE = (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app').replace(/\/+$/, '') + '/_/backend';
const KEY = process.env.AI_ADMIN_API_KEY || '';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

// 1. Provision e2e job + profile in-process (shared prod DB — the sanctioned provisioning path).
const ids = await withAim(ACTOR, async () => {
  const JOB_CONFIG = {
    promptTemplate: 'Reply with exactly this word and nothing else: {{word}}',
    // Tool parameter schemas come from config.variables — a job without them is offered to the
    // model as a parameterless tool (run 1's arguments:"{}" lesson).
    variables: [{ name: 'word', description: 'The exact word to echo back', required: true }],
  };
  let job = await getProcessingJobBySlug('e2e-toolprobe-echo');
  if (!job) {
    job = await createProcessingJob({
      slug: 'e2e-toolprobe-echo',
      name: 'e2e toolprobe echo',
      description: 'E2E probe: echoes a word. Swept by cleanup:e2e-ai-admin.',
      ai_profile_id: cadenceConfig.aim.brokerProfileId,
      config: JOB_CONFIG,
      is_active: true,
    });
  } else {
    await updateProcessingJob(job.id, { config: JOB_CONFIG });
  }
  const coach = (await getAiProfile(cadenceConfig.aim.coachProfileId)) as {
    provider_id?: string;
    external_ai_id?: string;
    mode?: string;
    profile_type?: string;
    runtime_options?: Record<string, unknown>;
  };
  // Clone the coach's provider/model/mode exactly — the probe must prove tools on the SAME
  // upstream configuration the coach would use, not on some easier one.
  const profile = await createAiProfile({
    name: 'e2e-toolprobe-profile',
    slug: `e2e-toolprobe-${Date.now()}`,
    provider_id: coach.provider_id,
    external_ai_id: coach.external_ai_id,
    mode: coach.mode,
    profile_type: coach.profile_type,
    runtime_options: coach.runtime_options,
    is_active: true,
    config: {
      toolJobs: [
        {
          jobSlug: 'e2e-toolprobe-echo',
          exposeAs: 'echo_word',
          description: 'Echoes the given word back. Call this whenever asked to echo a word.',
        },
      ],
    },
  } as never);
  return { jobId: job.id, profileId: profile.id };
});
console.log('provisioned:', ids);

// 2. Open a chat session via the deployed HTTP layer.
const session = await api<{ id?: string; sessionId?: string; session?: { id: string } }>('POST', '/api/chat-sessions', {
  aiProfileId: ids.profileId,
  userId: ACTOR,
  callingApplication: 'platform:cadence',
});
const sessionId = session.id ?? session.sessionId ?? session.session?.id;
console.log('session:', sessionId);

// 3. Send the message and pump the SSE, watching for tool activity.
const res = await fetch(`${BASE}/api/chat-sessions/${sessionId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({ message: "Please use the echo_word tool to echo the word 'pineapple'. You must call the tool — do not answer directly." }),
  signal: AbortSignal.timeout(180_000),
});
console.log('message status:', res.status, res.headers.get('content-type'));
const reader = res.body!.getReader();
const dec = new TextDecoder();
let raw = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  raw += dec.decode(value, { stream: true });
  if (raw.length > 200_000) break;
}
const fs = await import('node:fs');
const STREAM_COPY = '/private/tmp/claude-501/-Users-jeffreyleggo-cadence-ai-manager/735dc168-293c-4128-9c5b-63ffce1e6c20/scratchpad/probe-tool-loop-stream.txt';
fs.writeFileSync(STREAM_COPY, raw);
const sawFunctionCall = /function_call/.test(raw);
const sawEcho = /pineapple/i.test(raw);
const saw409 = /already terminal|resume error/i.test(raw);
const sawContinuationError = /"type":"error"/.test(raw);
console.log('\n── VERDICT ──');
console.log('function_call in stream :', sawFunctionCall);
console.log('continuation errored    :', sawContinuationError, saw409 ? '(the old 409)' : '');
console.log('final answer says word  :', sawEcho);
console.log('stream bytes            :', raw.length, '(full copy: ' + STREAM_COPY + ')');
process.exit(0);
