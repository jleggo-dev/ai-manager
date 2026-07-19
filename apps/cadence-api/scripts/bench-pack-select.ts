/**
 * Repro: run a pack-select-shaped request on the raw v2 client with the SAME strict schema
 * the engine builds, primary model only — to see why the engine's primary call fails.
 * Run: node --import tsx apps/cadence-api/scripts/bench-pack-select.ts [model]
 */
import { withAim } from '../src/ai/aim.ts';
import { listProviders } from '../../../backend/src/models/providers.ts';
import { createLlmClientForProvider } from '../../../backend/src/integrations/client-factory.ts';
import { expectedSchemaFieldsToJsonSchema } from '../../../backend/src/services/expected-schema-to-json-schema.ts';
import { cadenceConfig } from '../src/config.ts';

const DEV = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const MODEL = process.argv[2] || 'gpt-4.1-mini';

const SCHEMA = { fields: { calls: { type: 'array', items: { type: 'object' } }, reason: { type: 'string' } } };

const PROMPT = `You are Cadence's context Broker. Decide which retrieval functions to call.
SESSION INTENT: onboarding
Available functions: get_identity, get_objectives, get_constraints, get_equipment, get_active_plan, get_consistency, get_weight
Return ONLY this JSON: { "calls": [ { "fn": "<function name>", "params": {} } ], "reason": "<one short sentence>" }`;

async function main() {
  await withAim(DEV, async () => {
    const provs = await listProviders({ limit: 50 });
    const v2 = provs.find((p) => p.type === 'devs-ai-v2');
    if (!v2) throw new Error('no v2 provider');
    const client = createLlmClientForProvider(v2) as any;

    const text = expectedSchemaFieldsToJsonSchema(SCHEMA);
    console.log('json_schema sent:', JSON.stringify(text, null, 2).slice(0, 600), '\n');

    for (const label of ['WITH schema (options.text, engine-style)', 'WITHOUT schema'] as const) {
      const opts: Record<string, unknown> = { timeoutMs: 120000 };
      if (label.startsWith('WITH')) opts.text = text;
      const t0 = Date.now();
      try {
        const r = await client.chatCompletion(MODEL, [{ role: 'user', content: PROMPT }], opts);
        const c = String(r.choices?.[0]?.message?.content ?? '');
        console.log(`${label}: OK in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${c.slice(0, 140).replace(/\n/g, ' ')}`);
      } catch (e) {
        console.log(`${label}: FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${(e as Error).message.slice(0, 300)}`);
      }
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
