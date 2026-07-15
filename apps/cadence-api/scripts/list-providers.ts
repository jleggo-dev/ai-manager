/** List AI Admin providers in Cadence's workspace (to see if a devs-ai-v2 provider exists). */
import { listProviders } from '../../../backend/src/models/providers.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';

async function main() {
  const provs = await withAim(ACTOR, () => listProviders({ limit: 50 }));
  for (const p of provs) {
    console.log(`${p.type.padEnd(14)} · ${(p.name ?? '').padEnd(20)} · ${p.id} · base=${p.base_url ?? '(default)'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
