/**
 * Does Devs.ai keep our conversation, or do we have to re-send it every turn?
 *
 * The coach currently sends its ENTIRE transcript on every turn (self-contained `input`, no
 * `previous_response_id`), which is why one four-day thread reached 119,605 prompt tokens. The
 * owner — who works at Devs.ai — expects the chat endpoints to hold history server-side, which
 * would make all of that resending unnecessary. The docs do not settle it (the spec URL serves an
 * app shell), so this probe settles it against the live API.
 *
 * METHOD — a recall test, because token counts alone cannot distinguish "the server had the
 * history" from "the server charged us for something else". Turn 1 states a passphrase the model
 * cannot possibly know otherwise. Turn 2 asks for it back WITHOUT resending turn 1. If the answer
 * comes back, the server kept the conversation; the billed input tokens then say what that cost.
 *
 * A control runs the same second turn with no thread reference at all — if that also "recalls",
 * the passphrase leaked some other way and every other result here is void.
 *
 * Run: node --import tsx backend/scripts/probe-devs-ai-threading.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv({ path: path.join(root, 'backend/.env') });

// The model layer requires a request auth context; a script has none. Go straight to the service
// client and decrypt with the same helper the app uses, so the key is read but never printed.
const { getServiceSupabase } = await import('../src/db/service-supabase.ts');
const { decryptSecret } = await import('../src/lib/crypto.ts');

const PASSPHRASE = 'SEVEN-VIOLET-HARBOR';
const STATE = `Remember this passphrase exactly: ${PASSPHRASE}. Reply with just: OK`;
const RECALL = 'What passphrase did I ask you to remember? Reply with just the passphrase.';

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface V2Response {
  id?: string;
  status?: string;
  usage?: Usage;
  output?: unknown;
  conversation?: unknown;
  error?: unknown;
}

const inTok = (u?: Usage) => u?.input_tokens ?? u?.prompt_tokens ?? 0;

function textOf(r: V2Response): string {
  const out = r.output;
  if (!Array.isArray(out)) return '';
  const parts: string[] = [];
  for (const item of out as Array<Record<string, unknown>>) {
    const content = item?.content;
    if (Array.isArray(content)) {
      for (const c of content as Array<Record<string, unknown>>) {
        if (typeof c?.text === 'string') parts.push(c.text);
      }
    }
  }
  return parts.join(' ').trim();
}

const recalled = (t: string) => t.toUpperCase().includes(PASSPHRASE);

async function main() {
  const baseUrl = (process.env.DEVS_AI_BASE_URL || 'https://devs.ai').replace(/\/$/, '');
  // Prefer a key from the environment. The stored provider key is encrypted, and
  // CREDENTIAL_ENCRYPTION_KEY is not set on a dev machine, so decryptSecret would hand back
  // ciphertext and the API would 401 — which is exactly what happened the first time this ran.
  const envKey = (process.env.DEVS_AI_API_KEY || '').trim();

  const { data: rows, error } = await getServiceSupabase()
    .from('providers')
    .select('id,name,type,base_url,api_key')
    .in('type', ['devs-ai-v2', 'devs-ai'])
    .not('api_key', 'is', null);
  if (error) throw new Error(`provider lookup: ${error.message}`);
  const provider = (rows ?? []).find((p) => p.type === 'devs-ai-v2') ?? (rows ?? [])[0];
  if (!provider?.api_key) throw new Error('No Devs.ai provider with an api_key found');
  const key = envKey || decryptSecret(provider.api_key as string);
  if (!key) throw new Error('no usable Devs.ai key');
  console.log(envKey ? 'key: DEVS_AI_API_KEY from env' : 'key: decrypted from the provider row');
  const model = process.env.PROBE_MODEL || 'gpt-5-mini';
  console.log(`base=${baseUrl}  provider="${provider.name}"  model=${model}\n`);

  async function v2(body: Record<string, unknown>, label: string): Promise<V2Response> {
    const res = await fetch(`${baseUrl}/api/v2/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, ...body }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`  ${label}: HTTP ${res.status} — ${text.slice(0, 220)}`);
      return { error: text };
    }
    const parsed = JSON.parse(text) as V2Response;
    // The full usage object, verbatim: if they follow the OpenAI Responses standard it should
    // carry cached-token details, and THAT is what decides whether threading is cheaper — not
    // the raw input count. Never guess these field names; print them.
    console.log(`  ${label} usage: ${JSON.stringify(parsed.usage ?? {})}`);
    return parsed;
  }

  const results: string[] = [];

  /* ── 1 · v2, threaded with previous_response_id ───────────────────────────── */
  console.log('1 · v2 previous_response_id');
  const a1 = await v2({ input: STATE, store: true }, 'turn 1');
  console.log(`  turn 1: id=${a1.id ?? '-'} in=${inTok(a1.usage)} out="${textOf(a1).slice(0, 40)}"`);
  if (a1.id) {
    const a2 = await v2({ input: RECALL, store: true, previous_response_id: a1.id }, 'turn 2');
    const t = textOf(a2);
    console.log(`  turn 2: in=${inTok(a2.usage)} answer="${t.slice(0, 60)}"`);
    results.push(
      `previous_response_id: ${recalled(t) ? 'REMEMBERS ✓' : 'does NOT remember ✗'} (turn2 input tokens ${inTok(a2.usage)} vs turn1 ${inTok(a1.usage)})`,
    );
  } else {
    results.push('previous_response_id: turn 1 returned no id — cannot test');
  }

  /* ── 2 · control: no thread reference at all ──────────────────────────────── */
  console.log('\n2 · control (no threading)');
  const c = await v2({ input: RECALL, store: true }, 'control');
  const ct = textOf(c);
  console.log(`  in=${inTok(c.usage)} answer="${ct.slice(0, 60)}"`);
  results.push(
    `control (no thread): ${recalled(ct) ? 'REMEMBERS ✗✗ PROBE INVALID' : 'does not remember ✓ (as expected)'}`,
  );

  /* ── 3 · v2 conversation id, if the API mints one ─────────────────────────── */
  console.log('\n3 · v2 conversation');
  const conv = (a1.conversation as { id?: string } | string | undefined) ?? undefined;
  const convId = typeof conv === 'string' ? conv : conv?.id;
  if (convId) {
    const d = await v2({ input: RECALL, store: true, conversation: convId }, 'conversation');
    const dt = textOf(d);
    console.log(`  conversation=${convId} in=${inTok(d.usage)} answer="${dt.slice(0, 60)}"`);
    results.push(`conversation id: ${recalled(dt) ? 'REMEMBERS ✓' : 'does NOT remember ✗'}`);
  } else {
    console.log('  turn 1 returned no conversation id — nothing to thread on');
    results.push('conversation id: not returned by the API on a plain response');
  }

  /* ── 4 · v1 Chat Sessions, which the spec says keeps history ──────────────── */
  console.log('\n4 · v1 chat sessions');
  const aiId = process.env.PROBE_AI_ID || '';
  if (!aiId) {
    console.log('  skipped — set PROBE_AI_ID to a Devs.ai agent id to test the v1 path');
    results.push('v1 chat sessions: skipped (no PROBE_AI_ID)');
  } else {
    const mk = await fetch(`${baseUrl}/api/v1/ai/${aiId}/chats`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    const mkText = await mk.text();
    if (!mk.ok) {
      console.log(`  create chat → HTTP ${mk.status}: ${mkText.slice(0, 200)}`);
      results.push(`v1 chat sessions: create failed (${mk.status})`);
    } else {
      const chatId = (JSON.parse(mkText) as { data?: { id?: string }; id?: string }).data?.id ?? '';
      console.log(`  chatId=${chatId}`);
      const send = async (prompt: string) => {
        const r = await fetch(`${baseUrl}/api/v1/chats/${chatId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, date: new Date().toISOString() }),
          signal: AbortSignal.timeout(120_000),
        });
        return r.text();
      };
      await send(STATE);
      const back = await send(RECALL);
      console.log(`  recall response: ${back.slice(0, 200).replace(/\n/g, ' ')}`);
      results.push(`v1 chat sessions: ${recalled(back) ? 'REMEMBERS ✓' : 'does NOT remember ✗'}`);
    }
  }

  console.log('\n──────── VERDICT ────────');
  for (const r of results) console.log(' •', r);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
