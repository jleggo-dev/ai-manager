/**
 * LIVE PROBE: does the tool RESULT actually reach the model? (#232)
 *
 * Runs through prod AI Admin's deployed HTTP layer — Cadence never speaks to Devs.ai directly.
 *
 * ── Why this probe exists ──
 * `probe-tool-loop.ts` declared the loop "ALL GREEN" on 2026-08-14 and it was wrong. Its final
 * check was `/pineapple/i.test(raw)` against the WHOLE SSE stream — and "pineapple" was in the
 * tool ARGUMENTS the model emitted, so the test passed on a turn where the model never saw a
 * result. Re-read afterwards, that same capture shows input_tokens frozen at 3,539 across six
 * requests and no final answer at all.
 *
 * ── The two things it takes to not be fooled ──
 * 1. A NONCE the model cannot guess and cannot have read. It is generated here, returned only in
 *    the tool's OUTPUT, and never appears in the prompt or in any argument the model could emit.
 *    The prompt asks for a code it has no other way to know. Matched against her accumulated
 *    DELTA TEXT — the reply — not against the raw stream, so a match in an argument echo, a tool
 *    definition or a debug frame cannot count.
 * 2. `usage.input_tokens` PER ROUND. The bug's signature was a number that did not move: round 1
 *    billed 18,979 and rounds 2-4 each billed exactly 12,772. A self-contained continuation must
 *    bill MORE than round 1, because it carries round 1's request plus the exchange. Equal
 *    consecutive counts mean the provider is rebuilding from its own thread again.
 *
 * Either check failing is a red verdict. Both must pass.
 *
 * Usage:  AI_ADMIN_API_KEY=… npx tsx scripts/probe-tool-result-lands.ts
 * Leaves e2e-named entities behind; sweep with `npm run cleanup:test-data`.
 */
import { createProcessingJob, updateProcessingJob, getProcessingJobBySlug, getAiProfile } from '@ai-admin/core';
import { createAiProfile } from '../../../backend/src/models/ai-profiles.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const BASE =
  (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app').replace(/\/+$/, '') + '/_/backend';
const KEY = process.env.AI_ADMIN_API_KEY || '';
if (!KEY) throw new Error('AI_ADMIN_API_KEY is required — the probe talks to prod AI Admin, never to Devs.ai.');

/** Unguessable, and nowhere in the prompt. The only route into her reply is the tool's output. */
const NONCE = `ZEPHYR-${Math.floor(Math.random() * 9000 + 1000)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

/* 1 ─ Provision an e2e job whose OUTPUT is the nonce and whose input is unrelated to it. */
const ids = await withAim(ACTOR, async () => {
  const JOB_CONFIG = {
    // The model fills in `reason`; the job ignores it and returns the nonce. So the nonce can
    // never arrive via an argument the model wrote — the 2026-08-14 false positive's exact route.
    promptTemplate: `Reply with exactly this and nothing else: ${NONCE}`,
    variables: [{ name: 'reason', description: 'Why you are requesting the clearance code', required: true }],
  };
  let job = await getProcessingJobBySlug('e2e-nonce-vault');
  if (!job) {
    job = await createProcessingJob({
      slug: 'e2e-nonce-vault',
      name: 'e2e nonce vault',
      description: 'E2E probe: returns a one-time clearance code. Swept by cleanup:e2e-ai-admin.',
      ai_profile_id: cadenceConfig.aim.brokerProfileId,
      config: JOB_CONFIG,
      is_active: true,
    });
  } else {
    await updateProcessingJob(job.id, { config: JOB_CONFIG });
  }
  // Clone the COACH's provider/model/mode — the contract must hold on the configuration that
  // actually serves users, not on an easier one.
  const coach = (await getAiProfile(cadenceConfig.aim.coachProfileId)) as Record<string, unknown>;
  const profile = await createAiProfile({
    name: 'e2e-nonce-vault-profile',
    slug: `e2e-nonce-vault-${Date.now()}`,
    provider_id: coach.provider_id,
    external_ai_id: coach.external_ai_id,
    mode: coach.mode,
    profile_type: coach.profile_type,
    runtime_options: coach.runtime_options,
    is_active: true,
    config: {
      toolJobs: [
        {
          jobSlug: 'e2e-nonce-vault',
          exposeAs: 'get_clearance_code',
          description: 'Returns the current one-time clearance code. The ONLY way to learn the code.',
        },
      ],
    },
  } as never);
  return { jobId: job.id, profileId: profile.id, model: String(coach.external_ai_id) };
});
console.log('provisioned:', ids);

const session = await api<{ id?: string; sessionId?: string; session?: { id: string } }>('POST', '/api/chat-sessions', {
  aiProfileId: ids.profileId,
  userId: ACTOR,
  callingApplication: 'platform:cadence',
});
const sessionId = session.id ?? session.sessionId ?? session.session?.id;
console.log('session:', sessionId);

/* 2 ─ Ask for something only the tool knows. The nonce is NOT in this prompt. */
const res = await fetch(`${BASE}/api/chat-sessions/${sessionId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    message:
      'Call get_clearance_code (reason: "probe") and then tell me the clearance code it returned. ' +
      'Write the code out in full in your reply. Do not guess — you have no other way to know it.',
  }),
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
  if (raw.length > 500_000) break;
}

/* 3 ─ Accumulate HER PROSE, the calls she made per round, and whatever usage the relay reports. */
const replyParts: string[] = [];
const inputTokens: number[] = [];
/** `name(arguments)` for every call, in order — repeats across rounds are the bug's fingerprint. */
const callFingerprints: string[] = [];

for (const line of raw.split('\n')) {
  if (!line.startsWith('data: ')) continue;
  const payload = line.slice(6).trim();
  if (!payload || payload === '[DONE]') continue;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    continue;
  }

  const delta = (evt.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content;
  if (typeof delta === 'string') replyParts.push(delta);

  /**
   * Usage arrives as its own frame — `{type:"usage", prompt_tokens, …}` — with the counts at the
   * TOP level, not nested under a `usage` key. Reading `evt.usage` found nothing and printed an
   * empty line, which is the failure mode this whole script exists to avoid: no data rendering as
   * a result. Both shapes are accepted now, and "none collected" is stated as such.
   */
  const nested = evt.usage as { prompt_tokens?: number; input_tokens?: number } | undefined;
  const n = typeof nested === 'object' && nested ? (nested.prompt_tokens ?? nested.input_tokens) : undefined;
  const flat = evt.type === 'usage' ? ((evt.prompt_tokens ?? evt.input_tokens) as number | undefined) : undefined;
  if (typeof (n ?? flat) === 'number') inputTokens.push((n ?? flat) as number);

  if (evt.type === 'message.complete') {
    for (const item of (evt.output as Array<Record<string, unknown>>) ?? []) {
      if (item.type === 'function_call') callFingerprints.push(`${String(item.name)}(${String(item.arguments)})`);
    }
  }
}
const reply = replyParts.join('');

const fs = await import('node:fs');
const COPY = `/private/tmp/claude-501/-Users-jeffreyleggo-cadence-ai-manager/735dc168-293c-4128-9c5b-63ffce1e6c20/scratchpad/probe-tool-result-lands.txt`;
fs.writeFileSync(COPY, raw);

/* 4 ─ Verdict.
 *
 * Two checks, and neither may pass on absent data. The original version printed
 * `frozen across rounds: false` when it had collected NO token counts at all, which reads exactly
 * like a pass — the same "silence looks like success" shape as the 2026-08-14 false positive it
 * was written to prevent. Every check below is three-valued: pass, fail, or "not measurable here",
 * and only a real pass counts toward GREEN.
 */
const nonceInReply = reply.includes(NONCE);

/**
 * The bug's fingerprint, and the discriminator that actually works against this relay.
 *
 * Per-round token counts are NOT available: the relay emits one aggregate `usage` frame for the
 * whole turn, so the "18,979 then 12,772 three times" signature cannot be reconstructed from the
 * client side. What IS visible per round is the calls themselves — and a model that never receives
 * a result re-issues the same call with byte-identical arguments, which is precisely what the
 * production capture showed. So: a repeat is the failure, and the check needs no usage data.
 */
const repeated = callFingerprints.filter((f, i) => callFingerprints.indexOf(f) !== i);
const madeACall = callFingerprints.length > 0;

const verdict = (ok: boolean, measurable = true) => (!measurable ? '— not measurable here' : ok ? '✓' : '✗');

console.log('\n── VERDICT ──');
console.log('nonce                    :', NONCE);
console.log('made a tool call         :', madeACall, verdict(madeACall));
console.log('nonce anywhere in stream :', raw.includes(NONCE), '(necessary, NOT sufficient — the 08-14 trap)');
console.log('nonce in HER REPLY       :', nonceInReply, verdict(nonceInReply), nonceInReply ? 'the result reached the model' : '');
console.log('calls made               :', callFingerprints.length ? callFingerprints.join(' | ') : '(none)');
console.log('  no byte-identical repeat:', !repeated.length, verdict(!repeated.length, madeACall));
if (repeated.length) console.log('  REPEATED               :', [...new Set(repeated)].join(' | '));
console.log(
  'usage frames             :',
  inputTokens.length ? `${inputTokens.join(' → ')} (aggregate per turn, not per round)` : '(none reported)',
);

console.log('reply                    :', JSON.stringify(reply.slice(0, 400)));
console.log('full stream              :', COPY);

// GREEN needs a call to have happened, its result to have reached her, and no re-issued call.
const green = madeACall && nonceInReply && !repeated.length;
console.log('\nRESULT:', green ? 'GREEN' : 'RED');
process.exit(green ? 0 : 1);
