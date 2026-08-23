import { useEffect, useRef } from 'react';
import { enrichMeal, type Meal, type NutritionDayData } from '../../lib/api.ts';

/**
 * Meals the server says are still worth improving — pure, so it lives here rather than in the API
 * client. A predicate is not a network call, and putting it behind the api module only meant every
 * suite that mocks the client had to remember to stub it.
 */
export function mealsNeedingEnrich(meals: Meal[]): string[] {
  return meals.filter((m) => m.flags?.needs_enrich === true && m.flags?.enriched !== true).map((m) => m.log_id);
}

/**
 * The background improvement, driven from the client — brief: show "logged", sharpen it after.
 *
 * Owner's ruling (2026-08-23): *"we don't have to show that slowness to the user. We can just show
 * 'logged' and input the information in the background — updating the user's UI / macros whenever
 * we get the update back."*
 *
 * WHY THE CLIENT DRIVES IT. The API runs on Vercel without `waitUntil`, so work the server starts
 * after sending a response can be frozen the instant the function returns — the meal would be
 * logged, the lookup would silently never finish, and nothing would say so. A request the client
 * owns has its own lifetime and its own visible outcome.
 *
 * WHY THIS RUNS ON EVERY DAY LOAD, not just after a log. It makes the whole thing self-healing:
 * if the app is closed mid-lookup, or the tab dies, or the request fails, the flag is still on the
 * row and the next time that day is opened it simply tries again. Nothing to queue, nothing to
 * reconcile, no cron.
 *
 * `attempted` is per-mount rather than persisted: it stops a re-render storm firing the same
 * lookup twice, while still letting a genuinely fresh visit retry. The server is idempotent
 * anyway (it marks itself done), so the worst case of a double fire is a wasted round trip.
 */
export function useMealEnrichment(day: NutritionDayData | null, onImproved: () => void): void {
  const attempted = useRef(new Set<string>());
  const onImprovedRef = useRef(onImproved);
  onImprovedRef.current = onImproved;

  useEffect(() => {
    const pending = mealsNeedingEnrich(day?.meals ?? []).filter((id) => !attempted.current.has(id));
    if (pending.length === 0) return;

    let cancelled = false;
    for (const id of pending) attempted.current.add(id);

    void Promise.all(pending.map((id) => enrichMeal(id))).then((results) => {
      // Only disturb the screen if something actually changed. A lookup that found nothing must
      // not cause a flicker — the numbers on screen are still the right ones.
      if (cancelled || !results.some((r) => (r?.improved ?? 0) > 0)) return;
      onImprovedRef.current();
    });

    return () => {
      cancelled = true;
    };
  }, [day]);
}
