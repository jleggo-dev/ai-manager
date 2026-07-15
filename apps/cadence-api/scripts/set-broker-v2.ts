/**
 * Point the cadence-broker profile at the devs-ai-v2 provider (native JSON structured output).
 * Both primary and failover live on v2 with CURRENTLY-VALID models (gemini-2.0-flash was removed
 * from Devs.ai — do not use it). Override the primary model as the first arg.
 * Run: node --import tsx apps/cadence-api/scripts/set-broker-v2.ts [primaryModel]
 *   e.g. ... set-broker-v2.ts gemini-3.1-flash-lite
 */
import { getAiProfileBySlug, updateAiProfile } from '@ai-admin/core';
import { listProviders } from '../../../backend/src/models/providers.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
// OpenAI models apply the strict native json_schema for free (~4s); gemini pays a ~2.2× penalty
// (~16s) for the same schema via Devs.ai's shim. So the schema-based broker runs on gpt-*.
const PRIMARY_MODEL = process.argv[2] || 'gpt-4.1-mini';
const FAILOVER_MODEL = 'gpt-4o-mini'; // OpenAI, also first-class strict json_schema, catalog-valid

async function main() {
  await withAim(ACTOR, async () => {
    const broker = await getAiProfileBySlug('cadence-broker');
    if (!broker) throw new Error('cadence-broker profile not found');
    const provs = await listProviders({ limit: 50 });
    const v2 = provs.find((p) => p.type === 'devs-ai-v2');
    if (!v2) throw new Error('need a devs-ai-v2 provider');

    await updateAiProfile(broker.id, {
      provider_id: v2.id,
      external_ai_id: PRIMARY_MODEL,
      failover_provider_id: v2.id,
      failover_external_ai_id: FAILOVER_MODEL,
    } as unknown as Parameters<typeof updateAiProfile>[1]);
    console.log(`✓ cadence-broker → ${v2.type} / ${PRIMARY_MODEL} (failover ${v2.type} / ${FAILOVER_MODEL})`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
