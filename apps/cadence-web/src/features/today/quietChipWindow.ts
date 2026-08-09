import { withinQuietHours } from '@cadence/shared';

/**
 * When the quiet-hours chip is worth showing.
 *
 * A permanent chip is a settings badge; one that appears around five in the afternoon is a coach
 * mentioning, at the hour it matters, when it is going to stop talking — and giving you one tap to
 * move that if tonight is different. Once quiet hours have actually begun it disappears: at that
 * point it would be announcing something that has already happened.
 *
 * The window test comes from the shared catalog, not a local copy. It is the same arithmetic the
 * device uses to refuse to schedule inside quiet hours and the server uses to refuse to send —
 * and a chip that disagreed with either about when the evening ends would be the visible half of
 * a bug in the invisible half.
 *
 * Pure and in its own module so it is testable without rendering, and so the chip file stays a
 * component file (Fast Refresh only works when a file exports components alone).
 */

/** From 5pm. Early enough to be actionable, late enough that it is not decoration all day. */
export const QUIET_CHIP_FROM_HOUR = 17;

export function shouldShowQuietChip(nowMinutes: number, quietStartMin: number, quietEndMin: number): boolean {
  if (quietStartMin === quietEndMin) return false; // no window set — nothing to announce
  if (withinQuietHours(nowMinutes, quietStartMin, quietEndMin)) return false;
  return nowMinutes >= QUIET_CHIP_FROM_HOUR * 60;
}
