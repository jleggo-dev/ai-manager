/**
 * Point the cadence-coach profile at the devs-ai-v2 provider (Responses API — richer stream
 * reconnect/resume than v1), keeping v1 as failover. The coach is a chat model, so there is NO
 * expectedSchema / JSON assertion here — v2 is used purely for the more robust streaming path.
 * Reversible: pass `v1` to switch the primary back to v1.
 * Run: node --import tsx apps/cadence-api/scripts/set-coach-v2.ts [v1]
 */
import { getAiProfileBySlug, updateAiProfile } from '@ai-admin/core';
import { listProviders } from '../../../backend/src/models/providers.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const toV1 = process.argv[2] === 'v1';

async function main() {
  await withAim(ACTOR, async () => {
    const coach = await getAiProfileBySlug('cadence-coach');
    if (!coach) throw new Error('cadence-coach profile not found');
    const provs = await listProviders({ limit: 50 });
    const v2 = provs.find((p) => p.type === 'devs-ai-v2');
    // Prefer the real "Devs.ai" provider, not the auto-generated Lifecycle test ones.
    const v1 = provs.find((p) => p.type === 'devs-ai' && p.name === 'Devs.ai') ?? provs.find((p) => p.type === 'devs-ai');
    if (!v2 || !v1) throw new Error('need both a devs-ai and devs-ai-v2 provider');

    // Both models must be in the CURRENT v2 catalog — Devs.ai silently removed gemini-2.0-flash
    // (and opus is not on v2), so a stale failover id would 400/hang. claude-sonnet-5 is a
    // catalog-verified strong failover on the same provider.
    const COACH_MODEL = 'anthropic-claude-4-5-sonnet';
    const FAILOVER_MODEL = 'claude-sonnet-5';
    const primary = toV1 ? v1 : v2;
    await updateAiProfile(coach.id, {
      provider_id: primary.id,
      external_ai_id: COACH_MODEL,
      failover_provider_id: v2.id,
      failover_external_ai_id: FAILOVER_MODEL,
    } as unknown as Parameters<typeof updateAiProfile>[1]);
    console.log(`✓ cadence-coach → ${primary.type} / ${COACH_MODEL} (failover ${v2.type} / ${FAILOVER_MODEL})`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
