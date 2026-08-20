/**
 * Flip server-side threading for the coach — the measured alternative to re-sending the whole
 * transcript every turn.
 *
 * ON: each coach turn sends `previous_response_id` + only the NEW input (persona rides every turn
 * as instructions); Devs.ai's ThreadWorkflow holds the conversation and its org context budget
 * bounds it. OFF (the default): the stateless full-history shape that has always shipped.
 *
 * The flag lives on the coach AI PROFILE's runtime options (`devs_ai_v2.threading`), where the
 * other v2 runtime knobs live. Like every profile/job edit, it reaches sessions on their NEXT
 * message — thread-mode reads it per send, so no session rotation is needed.
 *
 * Run: node --import tsx apps/cadence-api/scripts/set-coach-threading.ts on|off
 */
import { getAiProfile, updateAiProfile } from '@ai-admin/core';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001'; // same actor as set-coach-persona

async function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  if (arg !== 'on' && arg !== 'off') throw new Error('Usage: set-coach-threading.ts on|off');
  const enable = arg === 'on';

  const profileId = cadenceConfig.aim.coachProfileId;
  if (!profileId) throw new Error('AIM_COACH_PROFILE_ID is not set — provision the coach profile first.');

  await withAim(ACTOR, async () => {
    const profile = (await getAiProfile(profileId)) as {
      runtime_options?: Record<string, unknown> | null;
      provider?: { type?: string } | null;
    };
    const providerType = profile.provider?.type ?? '(unknown)';
    if (enable && providerType !== 'devs-ai-v2') {
      throw new Error(`Coach profile provider is "${providerType}" — threading is a devs-ai-v2 feature.`);
    }
    const runtime = { ...(profile.runtime_options ?? {}) };
    const v2 = { ...((runtime.devs_ai_v2 as Record<string, unknown>) ?? {}) };
    v2.threading = enable;
    runtime.devs_ai_v2 = v2;
    await updateAiProfile(profileId, { runtime_options: runtime } as unknown as Parameters<typeof updateAiProfile>[1]);
    console.log(`✓ coach profile ${profileId}: devs_ai_v2.threading = ${String(enable)}`);
    console.log(
      enable
        ? 'Threaded from each session’s NEXT message. Watch prompt tokens in cadence.ai_log — that is the measurement.'
        : 'Stateless full-history from each session’s next message.',
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
