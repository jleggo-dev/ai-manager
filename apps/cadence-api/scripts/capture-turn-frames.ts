/**
 * Dump every usage-bearing SSE frame of a real coach turn, so the token accounting can be fixed
 * against what the provider ACTUALLY sends rather than against a reading of our own parser.
 *
 * The coach route relays upstream SSE verbatim to the client, so what this prints is exactly what
 * `applySseDataPayload` sees. It exists because the prompt-cache probe reproduced, byte-identically
 * across two runs, a turn reporting MORE cached tokens (30,510) than prompt tokens (24,113) — which
 * is impossible, and which two separate static readings of the parser failed to explain.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

/** Turns chosen to force a multi-round tool loop — the rounds are where the accounting diverges. */
const TURNS = ['morning — what should i be doing today?', 'how did last week go for me?', 'and what about my protein?'];

interface Frame {
  type?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  estimatedInputTokens?: number;
  responseId?: string;
}

async function main(): Promise<void> {
  const { API, missingEnv, setUp, tearDown } = await import('./eval-tool-selection-world.ts');
  const missing = missingEnv();
  if (missing) {
    console.error(missing);
    process.exit(1);
  }

  let world: Awaited<ReturnType<typeof setUp>> | null = null;
  try {
    world = await setUp();
    const auth = { Authorization: `Bearer ${world.token}`, 'Content-Type': 'application/json' };
    const open = await fetch(`${API}/coach/sessions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ intent: 'ongoing', healthAvailable: false, healthAnswered: true }),
      signal: AbortSignal.timeout(180_000),
    });
    const sessionId = ((await open.json()) as { sessionId?: string }).sessionId;
    if (!sessionId) throw new Error('could not open a session');

    for (const [i, text] of TURNS.entries()) {
      const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ message: text }),
        signal: AbortSignal.timeout(300_000),
      });
      const body = await res.text();

      console.log(`\n══ TURN ${i + 1} ═══════════════════════════════════════`);
      let promptSum = 0;
      let cachedSum = 0;
      let frameNo = 0;
      for (const line of body.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        let f: Frame;
        try {
          f = JSON.parse(payload) as Frame;
        } catch {
          continue;
        }
        // Only frames that move the token counters are interesting.
        const hasUsage = f.usage !== undefined;
        const hasV2 = f.inputTokens !== undefined || f.cachedInputTokens !== undefined;
        if (!hasUsage && !hasV2) continue;
        frameNo += 1;

        // Mirror EXACTLY what applySseDataPayload does, so the sums here are its sums.
        const parts: string[] = [];
        if (hasUsage) {
          const pt = f.usage?.prompt_tokens;
          const ct = f.usage?.completion_tokens;
          if (typeof pt === 'number') promptSum += pt;
          parts.push(`usage{prompt_tokens:${pt ?? '—'}, completion_tokens:${ct ?? '—'}}`);
        }
        if (f.type === 'message.complete') {
          const it = f.inputTokens ?? f.estimatedInputTokens;
          if (typeof it === 'number') promptSum += it;
          if (typeof f.cachedInputTokens === 'number') cachedSum += f.cachedInputTokens;
          parts.push(
            `message.complete{inputTokens:${f.inputTokens ?? '—'}, cachedInputTokens:${f.cachedInputTokens ?? '—'}, outputTokens:${f.outputTokens ?? '—'}} resp=${String(f.responseId ?? '—').slice(-12)}`,
          );
        } else if (hasV2) {
          parts.push(
            `type=${String(f.type)}{inputTokens:${f.inputTokens ?? '—'}, cachedInputTokens:${f.cachedInputTokens ?? '—'}}`,
          );
        }
        console.log(`  frame ${String(frameNo).padStart(2)}  ${parts.join('  ')}`);
        console.log(`            running: prompt=${promptSum}  cached=${cachedSum}`);
      }
      console.log(
        `  ── turn ${i + 1} totals: prompt=${promptSum}  cached=${cachedSum}` +
          (cachedSum > promptSum ? '   ← IMPOSSIBLE' : ''),
      );
    }
  } finally {
    await tearDown(world);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(String(e));
    process.exit(1);
  },
);
