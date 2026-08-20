/**
 * Does the tool loop still SPEAK on turn 2+? (Owner, 2026-08-20: "started calling a tool.
 * But then just never replied." — the transcript shows pre-tool narration only, three tool
 * rounds billed, no post-tool text persisted. Every existing probe tests turn 1 of a fresh
 * session; this reproduces his shape: an anchored session, tools firing on a LATER turn.)
 * Run: node --import tsx apps/cadence-api/scripts/probe-tool-turn2.ts
 */
import { missingEnv, setUp, tearDown, API, type World } from './eval-tool-selection-world.ts';

const TURNS = [
  'can you move the easy run off thursday, thursdays are dead for me now. friday would work', // tools on turn 1
  'i think it’s odd that i have a goal but no numbers behind it — can you check what my targets actually are?', // tools on turn 2 (his shape)
];

async function openSession(token: string): Promise<string> {
  const res = await fetch(`${API}/coach/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'ongoing', healthAvailable: false, healthAnswered: true }),
  });
  const body = (await res.json()) as { sessionId?: string };
  if (!res.ok || !body.sessionId) throw new Error(`open failed ${res.status}`);
  return body.sessionId;
}

/** Drain one turn's SSE; count text deltas BEFORE and AFTER the first function_call event. */
async function sendAndWatch(token: string, sessionId: string, message: string) {
  const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) throw new Error(`send failed ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let sawToolCall = false;
  let textBefore = 0;
  let textAfter = 0;
  let sawDone = false;
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        sawDone = true;
        continue;
      }
      if (/function_call/.test(payload)) sawToolCall = true;
      // count text delta events by the shapes the app itself accumulates
      if (/"(delta|text)"\s*:\s*"[^"]/.test(payload) && !/function_call/.test(payload)) {
        if (sawToolCall) textAfter++;
        else textBefore++;
      }
    }
  }
  return { sawToolCall, textBefore, textAfter, sawDone };
}

async function main() {
  const missing = missingEnv();
  if (missing) throw new Error(missing);
  let world: World | null = null;
  try {
    world = await setUp();
    const sessionId = await openSession(world.token);
    console.log(`session ${sessionId}\n`);
    for (let i = 0; i < TURNS.length; i++) {
      const r = await sendAndWatch(world.token, sessionId, TURNS[i] as string);
      console.log(
        `turn ${i + 1}: tool_call=${String(r.sawToolCall)}  text-before-tools=${r.textBefore}  TEXT-AFTER-TOOLS=${r.textAfter}  done=${String(r.sawDone)}`,
      );
    }
    console.log('\nHis failure shape = a turn with tool_call=true and TEXT-AFTER-TOOLS=0.');
  } finally {
    await tearDown(world);
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
