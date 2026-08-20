/**
 * What does a threaded coach turn actually BILL?
 *
 * Thread mode (#250) slices what we UPLOAD, but the number that matters is what Devs.ai's
 * ThreadWorkflow assembles and charges for — their context budget, their caching, their call.
 * No document answers that; this measures it against the deployed coach job.
 *
 * Method: one session, several sequential turns, per-turn prompt tokens read back as deltas of
 * the session's cumulative counter. Turn 1 is stateless by construction (nothing to anchor on) —
 * it IS the control, ~20.4–20.9k on yesterday's baseline. Turns 2+ are the experiment: if the
 * anchor was captured and threading engaged, their upload is persona + tools + one line, and the
 * billed number tells us what the server assembled. If they bill like turn 1, either the
 * x-response-id header never arrived (check provider_metadata afterwards) or threading fell back.
 *
 * The probe user and calling application are prefixed `e2e` so `npm run cleanup:test-data`
 * sweeps every row this leaves behind.
 *
 * Run: node --import tsx backend/scripts/probe-thread-billing.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || '';
const BASE = (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app') + '/_/backend';
if (!KEY) throw new Error('No AI_ADMIN_API_KEY in backend/.env');

const TURNS = [
  'quick one — should i stretch before or after tomorrow’s easy run?',
  'after, got it. how long is actually worth doing, honestly',
  'ok. and does foam rolling add anything on top of that or is it hype',
  'fair. remind me what you said about stretching order at the start?',
];

async function api(method: string, p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const text = await res.text(); // for SSE this waits for the stream to finish — exactly what we want
  try {
    return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 400) } };
  }
}

async function sessionCounters(sessionId: string): Promise<{ prompt: number; completion: number }> {
  const { json } = await api('GET', `/api/chat-sessions/${sessionId}`);
  const s = (json.session ?? json) as Record<string, unknown>;
  return { prompt: Number(s.total_prompt_tokens ?? 0), completion: Number(s.total_completion_tokens ?? 0) };
}

async function main() {
  console.log(`AI Admin: ${BASE}\ncoach job: cadence-coach-chat\n`);
  const { status, json: open } = await api('POST', '/api/chat-sessions', {
    jobSlug: 'cadence-coach-chat',
    userId: `e2e-thread-probe-${Date.now()}`,
    callingApplication: 'e2e-thread-probe',
  });
  if (status !== 201) throw new Error(`open failed (${status}): ${JSON.stringify(open).slice(0, 300)}`);
  const sessionId = String(open.sessionId ?? open.id ?? '');
  console.log(`session ${sessionId}\n`);

  let prevPrompt = 0;
  const rows: Array<{ turn: number; prompt: number; completion: number }> = [];
  for (let i = 0; i < TURNS.length; i++) {
    const { status: st } = await api('POST', `/api/chat-sessions/${sessionId}/messages`, { message: TURNS[i] });
    const { prompt, completion } = await sessionCounters(sessionId);
    const delta = prompt - prevPrompt;
    prevPrompt = prompt;
    rows.push({ turn: i + 1, prompt: delta, completion });
    console.log(`turn ${i + 1}: HTTP ${st} — prompt tokens this turn: ${delta.toLocaleString()} (cumulative ${prompt.toLocaleString()})`);
  }

  console.log('\n════════ RESULT ════════');
  console.log('turn 1 (stateless by construction — the control):', rows[0]?.prompt.toLocaleString());
  for (const r of rows.slice(1)) {
    console.log(`turn ${r.turn} (threaded if the anchor landed):`, r.prompt.toLocaleString());
  }
  console.log(
    '\nRead provider_metadata on this session to confirm the anchor; a threaded turn billing like',
    '\nturn 1 means either no x-response-id header or a stateless fallback. Clean up with',
    '\n`npm run cleanup:test-data` (everything here is e2e-prefixed).',
  );
  console.log(`\nsessionId for the metadata check: ${sessionId}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
