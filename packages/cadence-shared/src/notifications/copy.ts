/* ════════════════════════════════════════════════════════════════
   One door into the copy catalog
   ════════════════════════════════════════════════════════════════ */

import type { NudgeCopy, NudgeCopyInput } from './copy-types.ts';
import {
  almostTimeCopy,
  beforeQuietHoursCopy,
  milestoneWaypointCopy,
  morningAdjustCopy,
  weeklyCheckinCopy,
} from './copy-local.ts';
import { detourEndingCopy, freezeSaveCopy, reEntryCopy, weatherMoveCopy } from './copy-push.ts';

/**
 * `nudgeCopy` is the ONLY way anything outside this folder gets words for a notification. The
 * per-kind builders are exported too (they type better at each call site), but the union
 * dispatcher is what makes "every kind, every variant, in voice" a single test rather than nine
 * that someone forgets to add a tenth to.
 *
 * The switch is exhaustive by construction: adding a kind to `NudgeCopyInput` without adding a
 * case here fails the build on the `never` assignment below, so a new nudge cannot ship wordless.
 */
export function nudgeCopy(input: NudgeCopyInput): NudgeCopy {
  switch (input.kind) {
    case 'weekly_checkin':
      return weeklyCheckinCopy(input);
    case 'almost_time':
      return almostTimeCopy(input);
    case 'milestone_waypoint':
      return milestoneWaypointCopy(input);
    case 'before_quiet_hours':
      return beforeQuietHoursCopy(input);
    case 'morning_adjust':
      return morningAdjustCopy(input);
    case 'freeze_save':
      return freezeSaveCopy(input);
    case 'detour_ending':
      return detourEndingCopy(input);
    case 're_entry':
      return reEntryCopy(input);
    case 'weather_move':
      return weatherMoveCopy(input);
    default: {
      const unreachable: never = input;
      throw new Error(`nudgeCopy: no copy for ${JSON.stringify(unreachable)}`);
    }
  }
}

export type { NudgeCopy, NudgeCopyInput, NudgeCopyInputFor } from './copy-types.ts';
export {
  almostTimeCopy,
  beforeQuietHoursCopy,
  milestoneWaypointCopy,
  morningAdjustCopy,
  weeklyCheckinCopy,
} from './copy-local.ts';
export { detourEndingCopy, freezeSaveCopy, reEntryCopy, weatherMoveCopy } from './copy-push.ts';
