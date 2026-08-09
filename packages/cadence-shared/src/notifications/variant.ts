/* ════════════════════════════════════════════════════════════════
   Deterministic variant rotation — different, without being random
   ════════════════════════════════════════════════════════════════ */

/**
 * Why rotate at all: the same sentence, at the same time, every week, stops being read. The eye
 * learns the shape and skips it, and a nudge nobody reads is a notification budget spent on
 * nothing.
 *
 * Why NOT randomly: a notification must be reproducible. If the copy is random, the same nudge
 * says something different when it is rescheduled, a support question ("what did it actually
 * say?") is unanswerable, and no test can pin the catalog. Random copy also makes the coach seem
 * to change its mind for no reason, which is the opposite of remembering you.
 *
 * So: a hash of (seed, weekday) picks the variant. The same activity on the same weekday always
 * reads the same — Tuesday's run has ITS sentence — while Thursday's gets a different one, and two
 * users with different activity ids do not receive an identical script. There is no clock in here
 * and no state: given the same inputs it returns the same answer forever, on device and on server.
 */

/** FNV-1a over the seed — the same hash `localNotificationId` uses, for one arithmetic to trust. */
function fnv1a(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Index into a variant list, from a stable seed and a weekday.
 *
 * `weekday` is folded in rather than a date so a WEEKLY repeating notification — which iOS
 * schedules once and fires forever — keeps saying the right thing without the app being reopened.
 * A date-based rotation would freeze on whatever date the notification was scheduled, giving the
 * illusion of variety while delivering exactly one sentence for months.
 *
 * Returns 0 for an empty list rather than throwing: a copy builder calling this is on the path to
 * someone's lock screen, and the caller's own fallback text is a better outcome than an exception.
 */
export function variantIndex(seed: string, weekday: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const day = Number.isFinite(weekday) ? Math.trunc(weekday) : 0;
  return fnv1a(`${seed}:${day}`) % count;
}

/**
 * A variant list that is guaranteed non-empty, so `pickVariant` always has something to return and
 * no copy builder needs a "what if there are no variants" branch on the way to a lock screen.
 */
export type Variants<T = string> = readonly [T, ...T[]];

/** Pick from `variants` by the same rule. The list is the caller's; this only chooses. */
export function pickVariant<T>(variants: Variants<T>, seed: string, weekday: number): T {
  return variants[variantIndex(seed, weekday, variants.length)] ?? variants[0];
}
