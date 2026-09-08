import { CHECKIN_ADJUSTMENT_OPTIONS, type CheckinAdjustment, type MoodValue } from '@cadence/shared';

/**
 * What the daily check-in's one button says, from what has been picked (owner, 2026-09-08):
 * nothing → the quiet "Not now"; a mood or "Keep the week as is" → Done; an offer that carries
 * a steer → Next, because that pick starts a conversation with the coach rather than ending one.
 * A router, so it has a table test.
 */
export function commitLabel(mood: MoodValue | null, picked: CheckinAdjustment | null): string {
  const opt = picked ? CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === picked) : null;
  if (opt) return opt.commit;
  if (mood != null) return 'Done';
  return 'Not now — take me to today';
}
