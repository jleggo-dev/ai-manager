/**
 * Isolate PURE v2 LLM latency (no app DB in the timed loop) to explain the slow session-open.
 * Builds a raw DevsAiV2Client from the provider row and times: a minimal ping (base transport),
 * a tiny JSON completion, and a broker-sized extraction completion.
 * Run: node --import tsx apps/cadence-api/scripts/bench-v2-latency.ts [model]
 */
import { withAim } from '../src/ai/aim.ts';
import { listProviders } from '../../../backend/src/models/providers.ts';
import { createLlmClientForProvider } from '../../../backend/src/integrations/client-factory.ts';
import { cadenceConfig } from '../src/config.ts';

const DEV = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const MODEL = process.argv[2] || 'gemini-3.5-flash';
const now = () => Date.now();
const secs = (ms: number) => (ms / 1000).toFixed(1) + 's';

async function main() {
  await withAim(DEV, async () => {
    const provs = await listProviders({ limit: 50 });
    const v2 = provs.find((p) => p.type === 'devs-ai-v2');
    if (!v2) throw new Error('no devs-ai-v2 provider');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createLlmClientForProvider(v2) as any;
    console.log(`provider: ${v2.name} · ${v2.base_url} · model: ${MODEL}\n`);

    let s = now();
    const p = await client.ping(MODEL);
    console.log(`ping (min round-trip)      : ${secs(now() - s)}  ok=${p.ok}`);

    s = now();
    const r1 = await client.chatCompletion(
      MODEL,
      [{ role: 'user', content: 'Reply with only this JSON: {"ok":true}' }],
      { timeoutMs: 120000 },
    );
    console.log(`tiny json completion       : ${secs(now() - s)}  out=${JSON.stringify(r1.choices?.[0]?.message?.content ?? '').slice(0, 40)}`);

    const window =
      'User: I want a Spartan Beast at Blue Mountain in October under 5 hours and to get to 180 lbs. ' +
      'I have a squat rack, barbell, dumbbells, kettlebells, pull-up bar, monkey bars, running shoes. I am 48.';
    const prompt = `Extract capture deltas as JSON (keys: name, goals, equipment, baseline_updates, confidence). JSON only.\n\n${window}`;

    s = now();
    const r2 = await client.chatCompletion(MODEL, [{ role: 'user', content: prompt }], { timeoutMs: 120000 });
    console.log(`extraction  NO schema      : ${secs(now() - s)}  ${String(r2.choices?.[0]?.message?.content ?? '').length} chars out`);

    // Same call WITH the strict native json_schema the real broker jobs use (capture-extract shape).
    const expectedSchema = {
      fields: {
        name: { type: 'string' },
        goals: { type: 'array', items: { type: 'object' } },
        equipment: { type: 'array', items: { type: 'object' } },
        baseline_updates: { type: 'object' },
        confidence: { type: 'string', allowedValues: ['high', 'medium', 'low'] },
      },
    };
    s = now();
    const r3 = await client.chatCompletion(MODEL, [{ role: 'user', content: prompt }], { timeoutMs: 120000, expectedSchema });
    console.log(`extraction WITH schema     : ${secs(now() - s)}  ${String(r3.choices?.[0]?.message?.content ?? '').length} chars out`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
