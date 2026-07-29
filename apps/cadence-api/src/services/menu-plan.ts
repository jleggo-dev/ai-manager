/**
 * Pure placement of the shop + cook tasks a saved week menu implies (design E/2G) — no DB, so it's
 * unit-testable without a database. `syncMenuTasks` (menu-tasks.ts) writes the result as real plan
 * activities + occurrences.
 */
import type { MealPlan } from '@cadence/shared';

export interface MenuTask {
  date: string;
  title: string;
  kind: 'cook' | 'shop';
}

/** One cook task per distinct cooked dinner (first appearance; repeats read as leftovers), plus one
 *  shop task the day before the earliest cook. Deterministic — the design's "adds 2 trail tasks". */
export function planMenuTasks(plan: Pick<MealPlan, 'days' | 'shopping_list'>): MenuTask[] {
  const days = [...plan.days].sort((a, b) => a.day.localeCompare(b.day));
  const seen = new Set<string>();
  const cook: MenuTask[] = [];
  for (const d of days) {
    for (const m of d.meals) {
      if (m.slot !== 'dinner' || !m.recipe_id || seen.has(m.recipe_id)) continue;
      seen.add(m.recipe_id);
      cook.push({ date: d.day, title: `Cook ${m.recipe_name || 'dinner'}`, kind: 'cook' });
    }
  }
  const tasks: MenuTask[] = [];
  const first = cook[0];
  if (first && plan.shopping_list.length > 0) {
    tasks.push({ date: dayBefore(first.date), title: `Pick up ${plan.shopping_list.length} things`, kind: 'shop' });
  }
  tasks.push(...cook);
  return tasks;
}

/** YYYY-MM-DD one calendar day earlier (UTC — dates are calendar days, no time zone). */
export function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
