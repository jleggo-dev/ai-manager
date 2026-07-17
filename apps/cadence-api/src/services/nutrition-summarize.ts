import type { NutritionLog, NutritionSummary } from '@cadence/shared';

/**
 * Deterministic Observe-phase read over meal logs (pure, no DB/engine imports — unit-testable
 * like capture-normalize.ts). `days_logged` (distinct dates) is the module arc's PHASE SIGNAL:
 * ~7 logged days means the observation window is rich enough to talk baseline and introduce
 * ONE gradual change — never before, and never a judgment in the numbers themselves.
 */

type Row = Pick<NutritionLog, 'date' | 'meal' | 'items' | 'flags'>;

export function summarizeNutrition(rows: Row[], windowDays = 7): NutritionSummary {
  const days = new Set<string>();
  const alcoholDays = new Set<string>();
  const caffeineDays = new Set<string>();
  const itemCounts = new Map<string, number>();

  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    days.add(d);
    if (r.flags?.alcohol) alcoholDays.add(d);
    if (r.flags?.caffeine) caffeineDays.add(d);
    for (const it of r.items ?? []) {
      const name = String(it?.name ?? '').trim().toLowerCase();
      if (name) itemCounts.set(name, (itemCounts.get(name) ?? 0) + 1);
    }
  }

  const top_items = [...itemCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const days_logged = days.size;
  return {
    window_days: windowDays,
    days_logged,
    meals_logged: rows.length,
    meals_per_logged_day: days_logged ? Math.round((rows.length / days_logged) * 10) / 10 : 0,
    top_items,
    alcohol_days: alcoholDays.size,
    caffeine_days: caffeineDays.size,
  };
}

/** One compact line for dossier/retrieval rendering; '' when nothing is logged. */
export function renderNutritionLine(s: NutritionSummary): string {
  if (!s.days_logged) return '';
  const bits = [
    `${s.days_logged} of last ${s.window_days} days logged`,
    `~${s.meals_per_logged_day} meals/day`,
  ];
  if (s.top_items.length) bits.push(`often: ${s.top_items.slice(0, 3).map((t) => t.name).join(', ')}`);
  if (s.alcohol_days) bits.push(`alcohol on ${s.alcohol_days} day${s.alcohol_days === 1 ? '' : 's'}`);
  return `Food log (observe): ${bits.join(' · ')}.`;
}
