/**
 * Does Devs.ai keep the conversation for us, or must we re-send it every turn?
 *
 * The coach re-sends its ENTIRE transcript on every turn — which is how one four-day thread
 * reached 119,605 prompt tokens. The owner (who works at Devs.ai) expects the chat endpoints to
 * hold history server-side, which would make all of that unnecessary. Documentation does not
 * settle it, so this settles it against the live API through AI Admin production.
 *
 * WHY THIS SHAPE. AI Admin's v1 path already sends ONLY the new message
 * (`chat-messaging-stream.ts:62-84` — the system prompt is prepended once, on message_count 0, and
 * no history array is ever sent). So a v1 `mode: 'chat'` profile is a ready-made experiment: if
 * turn 2 can recall a passphrase from turn 1, the server kept the conversation, because our side
 * demonstrably did not send it.
 *
 * The control is the same test on a v2 profile, which is what the coach actually uses.
 *
 * Run: node --import tsx backend/scripts/probe-devs-ai-history.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const BASE = (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app') + '/_/backend';
if (!KEY) throw new Error('No AI_ADMIN_API_KEY in backend/.env');

const PASSPHRASE = 'SEVEN-VIOLET-HARBOR';
const STATE = `Remember this passphrase exactly: ${PASSPHRASE}. Reply with just: OK`;
const RECALL = 'What passphrase did I ask you to remember? Reply with the passphrase only.';

/** v1 chat-mode profile — this is the path that sends prompt-only. */
const V1_CHAT_PROFILE = process.env.PROBE_V1_PROFILE || 'f746c10b-60df-47ee-bb3d-762ca682cabc';
/** v2 profile — what the coach uses; we assemble and send everything. */
const V2_PROFILE = process.env.PROBE_V2_PROFILE || '';

async function api(method: string, p: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/** Pull whatever readable text the send-message response carries. */
function replyText(r: Record<string, unknown>): string {
  for (const k of ['content', 'message', 'text', 'response', 'raw']) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>).content;
      if (typeof inner === 'string' && inner.trim()) return inner;
    }
  }
  return JSON.stringify(r).slice(0, 400);
}

async function runCase(label: string, aiProfileId: string) {
  console.log(`\n──── ${label} ────`);
  console.log(`profile ${aiProfileId}`);
  const open = await api('POST', '/api/chat-sessions', {
    aiProfileId,
    userId: `probe-history-${Date.now()}`,
    callingApplication: 'probe-history',
  });
  const sessionId = String(open.sessionId ?? open.id ?? '');
  const externalChatId = open.externalChatId ?? null;
  console.log(`session ${sessionId}  externalChatId=${String(externalChatId)}`);
  if (!sessionId) {
    console.log('  no session id — cannot continue this case');
    return `${label}: could not open a session`;
  }

  await api('POST', `/api/chat-sessions/${sessionId}/messages`, { message: STATE });
  console.log('  turn 1 sent (states the passphrase)');

  const r2 = await api('POST', `/api/chat-sessions/${sessionId}/messages`, { message: RECALL });
  const answer = replyText(r2);
  console.log(`  turn 2 answer: ${answer.slice(0, 160).replace(/\s+/g, ' ')}`);

  const detail = await api('GET', `/api/chat-sessions/${sessionId}`);
  const s = (detail.session ?? detail) as Record<string, unknown>;
  console.log(
    `  session totals: prompt=${String(s.total_prompt_tokens ?? '?')} completion=${String(s.total_completion_tokens ?? '?')} messages=${String(s.message_count ?? '?')}`,
  );

  const remembered = answer.toUpperCase().includes(PASSPHRASE);
  return `${label}: ${remembered ? 'REMEMBERS ✓ (server kept the history)' : 'does NOT remember ✗'} — prompt tokens ${String(s.total_prompt_tokens ?? '?')}`;
}

async function main() {
  console.log(`AI Admin: ${BASE}`);
  const verdicts: string[] = [];

  try {
    verdicts.push(await runCase('v1 chat mode (we send ONLY the new message)', V1_CHAT_PROFILE));
  } catch (e) {
    verdicts.push(`v1 chat mode: FAILED — ${(e as Error).message.slice(0, 160)}`);
  }

  if (V2_PROFILE) {
    try {
      verdicts.push(await runCase('v2 (we assemble and send everything)', V2_PROFILE));
    } catch (e) {
      verdicts.push(`v2: FAILED — ${(e as Error).message.slice(0, 160)}`);
    }
  } else {
    verdicts.push('v2: skipped (set PROBE_V2_PROFILE)');
  }

  console.log('\n════════ VERDICT ════════');
  for (const v of verdicts) console.log(' •', v);
  console.log(
    '\nIf v1 remembers, Devs.ai maintains chat history and the coach re-sends its transcript\nby our own choice, not by necessity.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
