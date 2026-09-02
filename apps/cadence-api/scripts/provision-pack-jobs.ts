/**
 * Provision the ambient-capture Broker job (capture-extract) in AI Admin, in-process
 * (no SK/HTTP). Reads the definition from config/ai-admin/ai-admin.config.json and upserts
 * it by slug against the Broker profile. Re-run after editing the prompt. (The other two
 * P2 context-pack jobs, pack-select and pack-summarize, were retired with the Broker
 * phase-out — session open is zero-model-call now.)
 *
 * Run: node --import tsx apps/cadence-api/scripts/provision-pack-jobs.ts
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProcessingJob, updateProcessingJob, getProcessingJobBySlug } from '@ai-admin/core';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const SLUGS = ['capture-extract'];

async function main() {
  const broker = cadenceConfig.aim.brokerProfileId;
  if (!broker) throw new Error('AIM_BROKER_PROFILE_ID is not set — provision the broker profile first.');

  const cfg = JSON.parse(await readFile(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
    jobs: Array<{ slug: string; name: string; description: string; config: unknown }>;
  };
  const defs = cfg.jobs.filter((j) => SLUGS.includes(j.slug));
  if (defs.length !== SLUGS.length) throw new Error(`Expected ${SLUGS.length} pack jobs in config, found ${defs.length}`);

  await withAim(ACTOR, async () => {
    for (const def of defs) {
      const payload = {
        slug: def.slug,
        name: def.name,
        description: def.description,
        ai_profile_id: broker,
        config: def.config,
        is_active: true,
      } as unknown as Parameters<typeof createProcessingJob>[0];
      const existing = await getProcessingJobBySlug(def.slug);
      if (existing) {
        await updateProcessingJob(existing.id, payload);
        console.log(`✓ updated ${def.slug} (${existing.id})`);
      } else {
        const created = await createProcessingJob(payload);
        console.log(`✓ created ${def.slug} (${created.id})`);
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
