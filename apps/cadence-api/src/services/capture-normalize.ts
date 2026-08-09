import { randomUUID } from 'node:crypto';
import { isTimeOfDay, type Constraint } from '@cadence/shared';

/**
 * Pure, dependency-free transforms for the capture pipeline (no DB, no engine imports) so the
 * trust-critical logic — weight normalization and goal de-duplication — is unit-testable in
 * isolation. `capture.ts` orchestrates; this module decides shape.
 */

const LB_TO_KG = 0.453592;

/**
 * Coerce the Broker's free-form baseline_updates into the typed Baseline shape. Notably,
 * weight can arrive as { value, unit }, weight_kg, weight_lbs, or a bare number — we store
 * the canonical kg in weight_kg AND the user's unit in weight_unit so the app can display it
 * in the UOM they used (fixes weight landing in a field the UI can't read).
 */
/**
 * Availability, from however the Broker phrased it. The prompt asks for the enum, but people say
 * "mornings" and models echo people, so the obvious plurals and near-misses map rather than drop —
 * a silently-dropped answer is one the user watched themselves give and then never sees again.
 */
function normalizeTimeOfDay(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase().replace(/s$/, '');
  if (isTimeOfDay(v)) return v;
  if (v === 'am' || v === 'early' || v === 'first thing') return 'morning';
  if (v === 'lunchtime' || v === 'noon' || v === 'afternoon' || v === 'midday') return 'midday';
  if (v === 'pm' || v === 'night' || v === 'after work') return 'evening';
  if (v === 'any' || v === 'anytime' || v === 'whenever' || v === 'varies') return 'flexible';
  return undefined;
}

export function normalizeBaseline(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw.age === 'number') out.age = raw.age;
  if (typeof raw.height_cm === 'number') out.height_cm = raw.height_cm;

  const tod = normalizeTimeOfDay(raw.time_of_day);
  if (tod) out.time_of_day = tod;
  // A week has seven days; anything outside that is the model guessing, and a guess here would
  // quietly reshape someone's plan.
  const days = Number(raw.days_per_week);
  if (Number.isFinite(days) && days >= 1 && days <= 7) out.days_per_week = Math.round(days);

  let value: number | undefined;
  let unit: 'kg' | 'lbs' | undefined;
  const w = raw.weight as { value?: unknown; unit?: unknown } | number | undefined;
  if (w && typeof w === 'object' && typeof w.value === 'number') {
    value = w.value;
    unit = w.unit === 'lbs' ? 'lbs' : 'kg';
  } else if (typeof raw.weight_lbs === 'number') {
    value = raw.weight_lbs as number;
    unit = 'lbs';
  } else if (typeof raw.weight_kg === 'number') {
    value = raw.weight_kg as number;
    unit = 'kg';
  } else if (typeof raw.weight === 'number') {
    value = raw.weight;
    unit = 'kg';
  }
  if (typeof value === 'number' && value > 0) {
    // 2-dp (not 1): rounding lbs→kg at 0.1 kg makes a whole-lb input round-trip back to lbs off by
    // .1 (195 → 88.5 → 195.1). 0.01 kg is fine enough that whole lbs display as whole lbs.
    const kg = unit === 'lbs' ? Math.round(value * LB_TO_KG * 100) / 100 : value;
    out.weight_kg = { current: kg, start: kg, source: 'captured', updated_at: new Date().toISOString() };
    out.weight_unit = unit ?? 'kg';
  }

  // Unified "what we work around" list. The prompt asks for constraints
  // [{label, kind, plan_around}]; legacy shapes (injuries [{area, condition}] or bare
  // strings) are mapped, never dropped.
  const constraints: Constraint[] = [];
  const pushConstraint = (label: string, kind: Constraint['kind'], plan_around: boolean) => {
    const l = label.trim();
    if (l) constraints.push({ id: randomUUID(), label: l, kind, plan_around });
  };
  if (Array.isArray(raw.constraints)) {
    for (const c of raw.constraints as Array<Record<string, unknown> | string>) {
      if (typeof c === 'string') pushConstraint(c, 'life', false);
      else if (c && typeof c === 'object') {
        const kind = c.kind === 'physical' || c.kind === 'life' || c.kind === 'other' ? c.kind : 'other';
        pushConstraint(String(c.label ?? [c.area, c.condition].filter(Boolean).join(' — ')), kind, !!c.plan_around);
      }
    }
  }
  if (Array.isArray(raw.injuries)) {
    for (const i of raw.injuries as Array<Record<string, unknown>>) {
      if (i && typeof i === 'object') {
        pushConstraint([i.area, i.condition].filter(Boolean).join(' — '), 'physical', i.plan_around !== false);
      }
    }
  }
  if (constraints.length) out.constraints = constraints;
  return out;
}

/** Normalize a goal title for fuzzy comparison: lowercase, punctuation→spaces, collapsed. */
export const normTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Two normalized titles are "the same goal" when identical, or one contains the other — this
 * catches the model rephrasing a goal ("Run a 10k" → "Run a 10k this spring") while leaving
 * genuinely distinct goals apart ("Run a 10k" vs "Run a marathon"). Both inputs must already be
 * normalized via normTitle.
 */
const sameNormTitle = (a: string, b: string): boolean =>
  a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));

/**
 * Decide which freshly-captured goals to persist. Drops, in order: empty titles; EXACT matches of
 * an already confirmed/committed goal (a locked goal is never re-captured); FUZZY matches of a
 * milestone-bearing "sticky" captured goal (survives a rephrase between runs); and — the
 * deterministic backstop against duplicate goal cards — intra-run near-duplicates (keep the first
 * seen). `confirmedExact` and `stickyFuzzy` must already be normalized via normTitle.
 */
export function selectCapturedGoals<T extends { title?: string }>(
  goals: T[],
  confirmedExact: ReadonlySet<string>,
  stickyFuzzy: readonly string[],
): T[] {
  const kept: T[] = [];
  const keptNorm: string[] = [];
  for (const g of goals) {
    const nt = normTitle(g.title ?? '');
    if (!nt) continue;
    if (confirmedExact.has(nt)) continue;
    if (stickyFuzzy.some((s) => sameNormTitle(s, nt))) continue;
    if (keptNorm.some((k) => sameNormTitle(k, nt))) continue; // intra-run dedup
    kept.push(g);
    keptNorm.push(nt);
  }
  return kept;
}
