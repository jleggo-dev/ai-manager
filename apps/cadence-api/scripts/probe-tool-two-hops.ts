/**
 * LIVE PROBE: does a SEQUENTIAL tool chain close? (the multi-hop question, 2026-08-23)
 *
 * `probe-tool-result-lands.ts` proves ONE hop: a tool's output reaches the model's next
 * generation. The agentic designs (nutrition consult: fan out → read → decide → research →
 * read → answer) need more — round 2's result must inform round 3, through the same
 * self-contained continuation, with every earlier exchange still visible.
 *
 * ── The discriminators (each impossible to fake) ──
 * 1. KEY in hop-2's ARGUMENTS. The key is generated here and returned ONLY in hop-1's tool
 *    output — it is in no prompt and no tool description. A get_phrase_part_two call whose
 *    arguments carry the key is a call composed by READING hop-1's result. A parallel or
 *    speculative call cannot contain it.
 * 2. NONCE-B in her REPLY. Returned only by hop-2's tool. Her final prose containing it means
 *    round 2's result reached round 3's generation — the second delivery, over an input that
 *    already carried the first exchange.
 * 3. No byte-identical repeated call — the #232 fingerprint stays absent across BOTH rounds.
 *
 * Usage:  node --import tsx scripts/probe-tool-two-hops.ts
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

const rand = () => `${Math.floor(Math.random() * 9000 + 1000)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
/** Unlock key: exists only in hop-1's OUTPUT; must reappear in hop-2's ARGUMENTS. */
const UNLOCK = `KEY-${rand()}`;
/** Second half of the phrase: exists only in hop-2's OUTPUT; must reappear in her REPLY. */
const NONCE_B = `LUMEN-${rand()}`;
/** First half — proves hop 1 landed too, same as the single-hop probe. */
const NONCE_A = `ZEPHYR-${rand()}`;

/* 1 ─ Two e2e jobs: part one hands out the unlock key; part two needs it (by prose contract). */
const ids = await withAim(ACTOR, async () => {
  const upsert = async (slug: string, name: string, config: Record<string, unknown>) => {
    const existing = await getProcessingJobBySlug(slug);
    if (existing) {
      await updateProcessingJob(existing.id, { config });
      return existing.id;
    }
    const job = await createProcessingJob({
      slug,
      name,
      description: 'E2E probe (two-hop tool chain). Swept by cleanup:e2e-ai-admin.',
      ai_profile_id: cadenceConfig.aim.brokerProfileId,
      config,
      is_active: true,
    });
    return job.id;
  };

  const partOneId = await upsert('e2e-phrase-part-one', 'e2e phrase part one', {
    promptTemplate:
      `Reply with exactly this and nothing else: Part one of today's phrase is "${NONCE_A}". ` +
      `To read part two, call get_phrase_part_two with the unlock key ${UNLOCK}.`,
    variables: [{ name: 'section', description: 'Which bulletin section to read (e.g. "general")', required: true }],
  });
  const partTwoId = await upsert('e2e-phrase-part-two', 'e2e phrase part two', {
    // The job ignores the key's VALUE — what matters is that the model had to read hop-1's
    // output to know it. Verification happens on the arguments, not here.
    promptTemplate: `Reply with exactly this and nothing else: Part two of today's phrase is "${NONCE_B}".`,
    variables: [{ name: 'key', description: 'The unlock key, from get_phrase_part_one', required: true }],
  });

  // Clone the COACH's provider/model/mode — the contract must hold on the configuration that
  // actually serves users, not on an easier one.
  const coach = await getAiProfile(cadenceConfig.aim.coachProfileId);
  const profile = await createAiProfile({
    name: 'e2e-two-hop-profile',
    slug: `e2e-two-hop-${Date.now()}`,
    provider_id: coach.provider_id,
    external_ai_id: coach.external_ai_id,
    mode: coach.mode,
    profile_type: coach.profile_type,
    runtime_options: coach.runtime_options,
    is_active: true,
    config: {
      toolJobs: [
        {
          jobSlug: 'e2e-phrase-part-one',
          exposeAs: 'get_phrase_part_one',
          description:
            "Returns part one of today's phrase for the workspace bulletin, and where to find " +
            'part two. Use this first. Pass {"section": "general"}.',
        },
        {
          jobSlug: 'e2e-phrase-part-two',
          exposeAs: 'get_phrase_part_two',
          description:
            "Returns part two of today's phrase. Requires the unlock key that " +
            'get_phrase_part_one hands out — pass {"key": "<the key it gave you>"}.',
        },
      ],
    },
  } as never);
  return { partOneId, partTwoId, profileId: profile.id, model: String(coach.external_ai_id) };
});
console.log('provisioned:', ids);

const session = await api<{ id?: string; sessionId?: string; session?: { id: string } }>('POST', '/api/chat-sessions', {
  aiProfileId: ids.profileId,
  userId: ACTOR,
  callingApplication: 'platform:cadence',
});
const sessionId = session.id ?? session.sessionId ?? session.session?.id;
console.log('session:', sessionId);

/* 2 ─ One ask that requires the chain. Neither nonce nor the key is anywhere in this prompt. */
const res = await fetch(`${BASE}/api/chat-sessions/${sessionId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    message:
      "What is today's full phrase of the day — both parts? Look them up and write both parts " +
      'out in full in your reply, exactly as returned. Do not guess — you have no other way to know them.',
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

/* 3 ─ Accumulate her prose and the calls per round (same parsing as probe-tool-result-lands). */
const replyParts: string[] = [];
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
  if (evt.type === 'message.complete') {
    for (const item of (evt.output as Array<Record<string, unknown>>) ?? []) {
      if (item.type === 'function_call') callFingerprints.push(`${String(item.name)}(${String(item.arguments)})`);
    }
  }
}
const reply = replyParts.join('');

const fs = await import('node:fs');
const COPY = process.env.PROBE_STREAM_COPY || `/tmp/probe-tool-two-hops.txt`;
try {
  fs.writeFileSync(COPY, raw);
} catch (e) {
  console.warn('could not save the stream copy (verdict unaffected):', (e as Error).message);
}

/* 4 ─ Verdict. Three-valued like the single-hop probe: absent data must never read as a pass. */
const partTwoCalls = callFingerprints.filter((f) => f.startsWith('get_phrase_part_two('));
const calledPartOne = callFingerprints.some((f) => f.startsWith('get_phrase_part_one('));
const keyInPartTwoArgs = partTwoCalls.some((f) => f.includes(UNLOCK));
const repeated = callFingerprints.filter((f, i) => callFingerprints.indexOf(f) !== i);
const nonceAInReply = reply.includes(NONCE_A);
const nonceBInReply = reply.includes(NONCE_B);

const verdict = (ok: boolean, measurable = true) => (!measurable ? '— not measurable here' : ok ? '✓' : '✗');

console.log('\n── VERDICT ──');
console.log('unlock key               :', UNLOCK);
console.log('nonces                   :', NONCE_A, '+', NONCE_B);
console.log('called part one          :', calledPartOne, verdict(calledPartOne));
console.log('called part two          :', partTwoCalls.length > 0, verdict(partTwoCalls.length > 0));
console.log(
  'KEY in part-two args     :',
  keyInPartTwoArgs,
  verdict(keyInPartTwoArgs, partTwoCalls.length > 0),
  keyInPartTwoArgs ? 'hop 2 was composed from hop 1’s result' : '',
);
console.log(
  'nonce B in her reply     :',
  nonceBInReply,
  verdict(nonceBInReply),
  nonceBInReply ? 'round 2’s result reached round 3' : '',
);
console.log(
  'nonce A in her reply     :',
  nonceAInReply,
  verdict(nonceAInReply),
  '(the earlier exchange stayed visible)',
);
console.log('  no byte-identical repeat:', !repeated.length, verdict(!repeated.length, callFingerprints.length > 0));
if (repeated.length) console.log('  REPEATED               :', [...new Set(repeated)].join(' | '));
console.log('calls made               :', callFingerprints.length ? callFingerprints.join(' | ') : '(none)');
console.log('reply                    :', JSON.stringify(reply.slice(0, 400)));
console.log('full stream              :', COPY);

// GREEN = the chain: part-two's arguments prove hop-1 was read; her reply proves hop-2 was read;
// the earlier half is still on screen at the end; and nothing was re-issued blind.
const green = calledPartOne && keyInPartTwoArgs && nonceBInReply && nonceAInReply && !repeated.length;
console.log('\nRESULT:', green ? 'GREEN' : 'RED');
process.exit(green ? 0 : 1);

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}
