import type { Macros, MealKind, MicronutrientTarget, NutritionLog, NutritionSummary } from '@cadence/shared';
import { microInsights, type MicroInsightRollup } from './nutrition-insight-micro.ts';

/**
 * Req 5 WS-I — deterministic nutrition insight pack (macro / pattern / variety / micro).
 *
 * Pure: no DB, no LLM. Callers pass the already-built day rollup from `getNutritionDay`
 * (totals / left / targets) — we never re-sum meals into day totals. Numbers are only
 * narrated when grounded in that read or in the Observe summary / recent logs.
 * Micro insights need a precomputed rollup from real-data foods AND this person's resolved
 * reference intakes (see nutrition-insight-micro) — this file never holds a floor of its own.
 *
 * Brand: coach speaks as "I"; observe, never judge; count what happened; no scoreboard.
 */

export type InsightKind = 'macro' | 'pattern' | 'variety' | 'micro';

export type InsightStatus = 'quiet' | 'observing' | 'on_track' | 'room_left' | 'a_little_over';

export interface NutritionInsightItem {
  kind: InsightKind;
  body: string;
}

export interface NutritionInsightDrillMacro {
  key: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';
  label: string;
  eaten: number;
  target: number | null;
  left: number | null;
}

export interface NutritionInsightDrillMeal {
  meal: MealKind;
  summary: string;
  kcal: number | null;
  provisional?: boolean;
}

export interface NutritionInsightPack {
  status: InsightStatus;
  status_line: string;
  /** Single coaching line shown upfront; null when the card should stay quiet. */
  primary: NutritionInsightItem | null;
  more: NutritionInsightItem[];
  drill: {
    date: string;
    macros: NutritionInsightDrillMacro[];
    meals: NutritionInsightDrillMeal[];
    window: {
      days_logged: number;
      window_days: number;
      top_items: { name: string; count: number }[];
    };
  };
}

export interface NutritionInsightDayInput {
  date: string;
  meals: Array<
    Pick<NutritionLog, 'meal' | 'items' | 'macros' | 'provisional' | 'raw_text'> & {
      meal: MealKind;
    }
  >;
  totals: Macros;
  provisional_totals?: Macros;
  targets: Macros | null;
  left: Macros | null;
  confirmed_count: number;
  provisional_count: number;
}

const MACRO_LABELS: Record<'kcal' | 'protein_g' | 'carbs_g' | 'fat_g', string> = {
  kcal: 'Calories',
  protein_g: 'Protein',
  carbs_g: 'Carbs',
  fat_g: 'Fat',
};

const GREEN_WORDS =
  /\b(spinach|kale|salad|broccoli|berry|berries|fruit|apple|banana|orange|veggie|vegetable|greens|avocado|tomato|pepper|carrot|cucumber|zucchini|lettuce|asparagus|bean|beans|lentil|chickpea)\b/i;

const BEIGE_WORDS =
  /\b(pasta|rice|bread|toast|cheese|pizza|fries|chip|chips|bagel|cereal|noodle|noodles|bun|cracker|pretzel|white rice|mac)\b/i;

const LATE_MEALS = new Set<MealKind>(['dinner', 'snack', 'drink', 'other']);

function hasTargets(targets: Macros | null): boolean {
  if (!targets) return false;
  return (['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const).some(
    (k) => typeof targets[k] === 'number' && (targets[k] as number) > 0,
  );
}

function mealSummary(m: NutritionInsightDayInput['meals'][number]): string {
  const names = (m.items ?? [])
    .map((i) => String(i?.name ?? '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (names.length) return names.join(', ');
  const raw = String(m.raw_text ?? '').trim();
  return raw ? raw.slice(0, 48) : m.meal;
}

function buildDrill(day: NutritionInsightDayInput, summary: NutritionSummary): NutritionInsightPack['drill'] {
  const keys = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;
  return {
    date: day.date,
    macros: keys.map((key) => ({
      key,
      label: MACRO_LABELS[key],
      eaten: Math.round(day.totals[key] ?? 0),
      target: typeof day.targets?.[key] === 'number' ? Math.round(day.targets[key] as number) : null,
      left: typeof day.left?.[key] === 'number' ? Math.round(day.left[key] as number) : null,
    })),
    meals: day.meals.map((m) => ({
      meal: m.meal,
      summary: mealSummary(m),
      kcal: typeof m.macros?.kcal === 'number' ? Math.round(m.macros.kcal) : null,
      ...(m.provisional ? { provisional: true } : {}),
    })),
    window: {
      days_logged: summary.days_logged,
      window_days: summary.window_days,
      top_items: summary.top_items.slice(0, 5),
    },
  };
}

function statusForDay(day: NutritionInsightDayInput): { status: InsightStatus; status_line: string } {
  const mealsToday = day.meals.length > 0 || day.confirmed_count > 0 || day.provisional_count > 0;
  if (!mealsToday && !hasTargets(day.targets)) {
    return { status: 'quiet', status_line: '' };
  }
  if (!hasTargets(day.targets)) {
    return { status: 'observing', status_line: "I'm just listening for now" };
  }

  const targetKcal = day.targets!.kcal;
  const eatenKcal = day.totals.kcal ?? 0;
  if (typeof targetKcal === 'number' && targetKcal > 0 && eatenKcal > targetKcal + 80) {
    return { status: 'a_little_over', status_line: 'A little over today' };
  }

  const proteinLeft = day.left?.protein_g;
  const kcalLeft = day.left?.kcal;
  const room =
    (typeof proteinLeft === 'number' && proteinLeft >= 20) || (typeof kcalLeft === 'number' && kcalLeft >= 250);
  if (room && eatenKcal > 0) {
    return { status: 'room_left', status_line: 'Room left today' };
  }
  if (eatenKcal > 0 || day.confirmed_count > 0) {
    return { status: 'on_track', status_line: 'On track today' };
  }
  return { status: 'room_left', status_line: 'Room left today' };
}

function macroInsights(day: NutritionInsightDayInput): NutritionInsightItem[] {
  if (!hasTargets(day.targets) || day.confirmed_count === 0) return [];
  const out: NutritionInsightItem[] = [];
  const proteinLeft = day.left?.protein_g;
  if (typeof proteinLeft === 'number' && proteinLeft >= 20) {
    const n = Math.round(proteinLeft);
    out.push({
      kind: 'macro',
      body: `Protein's landed about ${n}g short today — want an easy add? Greek yogurt or eggs usually cover that without much fuss.`,
    });
  }
  const kcalLeft = day.left?.kcal;
  const targetKcal = day.targets!.kcal;
  const eatenKcal = day.totals.kcal ?? 0;
  if (typeof targetKcal === 'number' && targetKcal > 0 && eatenKcal > targetKcal + 80) {
    out.push({
      kind: 'macro',
      body: "Calories ran a little high today. Nothing to fix — I'll keep an eye on the next few days with you.",
    });
  } else if (typeof kcalLeft === 'number' && kcalLeft >= 350 && day.confirmed_count >= 1) {
    out.push({
      kind: 'macro',
      body: `You've got about ${Math.round(kcalLeft)} calories left today. If you're hungry later, that's room — not a miss.`,
    });
  }
  return out;
}

function lateCalorieShare(rows: Array<Pick<NutritionLog, 'meal' | 'macros' | 'provisional'>>): number | null {
  let total = 0;
  let late = 0;
  for (const r of rows) {
    if (r.provisional) continue;
    const k = r.macros?.kcal;
    if (typeof k !== 'number' || k <= 0) continue;
    total += k;
    if (LATE_MEALS.has(r.meal)) late += k;
  }
  if (total < 800) return null;
  return late / total;
}

function patternInsights(
  summary: NutritionSummary,
  recent: Array<Pick<NutritionLog, 'meal' | 'macros' | 'provisional' | 'date' | 'flags'>>,
): NutritionInsightItem[] {
  const out: NutritionInsightItem[] = [];
  if (summary.days_logged < 3) return out;

  const lateShare = lateCalorieShare(recent);
  if (lateShare != null && lateShare >= 0.55) {
    out.push({
      kind: 'pattern',
      body: "Most of your calories have been landing later in the day. That's information, not a problem — want to shift a bit earlier if it feels easier?",
    });
  }

  if (summary.alcohol_days >= 2) {
    out.push({
      kind: 'pattern',
      body: `I noticed alcohol on ${summary.alcohol_days} of the last ${summary.window_days} days. No judgment — just something I'm holding so we can plan around it.`,
    });
  }

  // Weekday vs weekend drift (needs enough days + weekend samples).
  const byDow = new Map<number, { kcal: number; days: Set<string> }>();
  for (const r of recent) {
    if (r.provisional) continue;
    const k = r.macros?.kcal;
    if (typeof k !== 'number' || k <= 0) continue;
    const d = String(r.date).slice(0, 10);
    const dow = new Date(`${d}T12:00:00`).getDay(); // 0 Sun … 6 Sat
    const bucket = byDow.get(dow) ?? { kcal: 0, days: new Set<string>() };
    bucket.kcal += k;
    bucket.days.add(d);
    byDow.set(dow, bucket);
  }
  let weekdayKcal = 0;
  let weekdayDays = 0;
  let weekendKcal = 0;
  let weekendDays = 0;
  for (const [dow, v] of byDow) {
    const avg = v.kcal / Math.max(1, v.days.size);
    if (dow === 0 || dow === 6) {
      weekendKcal += avg * v.days.size;
      weekendDays += v.days.size;
    } else {
      weekdayKcal += avg * v.days.size;
      weekdayDays += v.days.size;
    }
  }
  if (weekdayDays >= 2 && weekendDays >= 1) {
    const wAvg = weekdayKcal / weekdayDays;
    const weAvg = weekendKcal / weekendDays;
    if (wAvg > 0 && weAvg > wAvg * 1.2 && weAvg - wAvg >= 200) {
      out.push({
        kind: 'pattern',
        body: "You've been steadier Mon–Fri; weekends drift a bit higher. That's a common rhythm — we can bend the plan instead of starting over.",
      });
    }
  }

  return out;
}

function itemNames(rows: Array<{ items?: { name?: string }[] }>): string[] {
  const names: string[] = [];
  for (const r of rows) {
    for (const it of r.items ?? []) {
      const n = String(it?.name ?? '').trim();
      if (n) names.push(n);
    }
  }
  return names;
}

function varietyInsights(
  summary: NutritionSummary,
  recent: Array<{ items?: { name?: string }[] }>,
): NutritionInsightItem[] {
  const out: NutritionInsightItem[] = [];
  if (summary.meals_logged < 4 || summary.days_logged < 2) return out;

  const names = itemNames(recent);
  if (names.length < 4) return out;

  const hasGreen = names.some((n) => GREEN_WORDS.test(n));
  const beigeCount = names.filter((n) => BEIGE_WORDS.test(n)).length;
  const beigeShare = beigeCount / names.length;

  if (!hasGreen && beigeShare >= 0.35) {
    out.push({
      kind: 'variety',
      body: "Lots of beige lately — a handful of spinach or berries would round it out when you're next at the store.",
    });
    return out;
  }

  const unique = new Set(names.map((n) => n.toLowerCase())).size;
  if (unique <= 4 && summary.meals_logged >= 6) {
    out.push({
      kind: 'variety',
      body: "You've been circling the same few foods. That can be fine — if you want more color, I can suggest one easy add.",
    });
  }
  return out;
}

function softOnTrack(day: NutritionInsightDayInput, summary: NutritionSummary): NutritionInsightItem | null {
  if (!hasTargets(day.targets) || day.confirmed_count === 0) {
    if (summary.days_logged > 0 && summary.days_logged < 7) {
      return {
        kind: 'pattern',
        body: `You've logged ${summary.days_logged} of the last ${summary.window_days} days. I'm still learning your rhythm — keep telling me what you eat.`,
      };
    }
    return null;
  }
  return {
    kind: 'macro',
    body: "Today's looking steady so far. I'll keep reading the log with you — nothing you need to chase.",
  };
}

/**
 * Build the insight pack for the nutrition card (simple upfront + drill-down).
 * `recent` should be the same window as `summary` (typically 7 days).
 */
export function buildNutritionInsight(
  day: NutritionInsightDayInput,
  summary: NutritionSummary,
  recent: Array<Pick<NutritionLog, 'meal' | 'macros' | 'provisional' | 'date' | 'flags' | 'items'>> = [],
  microRollup: MicroInsightRollup | null = null,
  /** Resolved reference intakes (+ any override) for this person — no targets, no micro lines. */
  microTargets: MicronutrientTarget[] = [],
): NutritionInsightPack {
  const { status, status_line } = statusForDay(day);
  const drill = buildDrill(day, summary);

  const candidates = [
    ...macroInsights(day),
    ...patternInsights(summary, recent),
    ...varietyInsights(summary, recent),
    ...(microRollup ? microInsights(microRollup, microTargets) : []),
  ];

  let primary: NutritionInsightItem | null = candidates[0] ?? null;
  let more = candidates.slice(1);

  if (!primary) {
    primary = softOnTrack(day, summary);
    more = [];
  }

  // Quiet: nothing logged in the window and no today signal worth a card.
  if (!primary && status === 'quiet' && summary.days_logged === 0) {
    return { status: 'quiet', status_line: '', primary: null, more: [], drill };
  }

  // Prefer a grounded primary even when status was quiet (week has signal).
  if (!primary) {
    return { status: 'quiet', status_line: '', primary: null, more: [], drill };
  }

  const finalStatus = status === 'quiet' && summary.days_logged > 0 ? 'observing' : status;
  const finalLine = status_line || (finalStatus === 'observing' ? "I'm just listening for now" : '');

  return {
    status: finalStatus,
    status_line: finalLine,
    primary,
    more,
    drill,
  };
}
