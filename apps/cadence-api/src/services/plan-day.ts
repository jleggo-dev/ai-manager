import { localDate } from './notify/policy.ts';

/**
 * Which calendar day the Plan screen is built around, as UTC-midnight epoch ms.
 *
 * This was `Date.UTC(now.getUTC*)` inline in plan-view.ts, so the whole screen rolled over at UTC
 * midnight. In Montreal (UTC-4) that is 20:00 local: on Tuesday 2026-08-18 at 20:41 the owner's
 * demo build showed `TODAY · WED 19 AUG`. The label was the visible half. The costly half is that
 * this value also sets the from/to that fetch occurrences — so every evening after 8pm the trail
 * showed TOMORROW'S plan and called it today, and anything logged from that screen landed on the
 * wrong date.
 *
 * Order: the zone the user has stored, then the one the client sent with this request, then UTC.
 * UTC is a floor rather than a default — right for nobody in particular, but deterministic, and
 * it is what the rest of the horizon machinery already assumes.
 *
 * The return is midnight LOCAL expressed as a UTC instant, because every date downstream is a
 * bare `YYYY-MM-DD` and the callers do `base + n * 86_400_000`. Keeping that arithmetic in UTC
 * keeps a DST-shifted day from silently becoming 23 or 25 hours.
 */
export function planDayBase(now: Date, timezone?: string | null, tzHint?: string | null): number {
  const localIso = localDate(now, timezone) ?? localDate(now, tzHint);
  if (localIso) {
    const t = Date.parse(`${localIso}T00:00:00Z`);
    if (Number.isFinite(t)) return t;
  }
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
