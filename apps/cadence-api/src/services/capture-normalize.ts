import { randomUUID } from 'node:crypto';
import {
  isTimeOfDay,
  type Availability,
  type AvailabilityWindow,
  type Constraint,
  type StartingPoint,
} from '@cadence/shared';

/**
 * Pure, dependency-free transforms for the capture pipeline (no DB, no engine imports) so the
 * trust-critical logic — weight normalization and goal de-duplication — is unit-testable in
 * isolation. `capture.ts` orchestrates; this module decides shape.
 */

const LB_TO_KG = 0.453592;
/** A brief is a few plain sentences. Past this the model is writing, not transcribing. */
const BRIEF_MAX = 800;
/** One phrase per thing they do, and no more things than a person credibly lists in a chat. */
const ROUTINE_ITEM_MAX = 120;
const ROUTINE_ITEMS_MAX = 12;

/** "2026-08-14" and nothing else. A half-parsed date schedules someone in the wrong week. */
function isYmd(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) && !Number.isNaN(Date.parse(raw.trim()));
}

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

/** "19:00", "7:00", "07:00" → "HH:MM"; anything else → undefined (a mangled clock time is worse
 *  than no clock time — it schedules someone somewhere they never said they were free). */
function normalizeClock(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * The windows they named and how long one session runs. Bounds are deliberately generous but
 * real: a session is at least a minute and at most a day's worth of waking hours (10 h) — past
 * that the model is transcribing something that wasn't a session length, and a bad number here
 * sizes every commitment in the week.
 *
 * Duplicated slots collapse (a model listing "morning" twice is one window), and 'flexible'
 * alongside a named slot is dropped: "any time" plus "evenings" is a contradiction, and the
 * specific answer is the one they actually gave.
 */
function normalizeAvailability(raw: unknown): Availability | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as { windows?: unknown; session_minutes?: unknown };

  const windows: AvailabilityWindow[] = [];
  const seen = new Set<string>();
  for (const w of Array.isArray(src.windows) ? src.windows : []) {
    const part = normalizeTimeOfDay(typeof w === 'string' ? w : (w as { part_of_day?: unknown })?.part_of_day);
    if (!part || !isTimeOfDay(part) || seen.has(part)) continue;
    seen.add(part);
    const obj = (typeof w === 'object' && w !== null ? w : {}) as Record<string, unknown>;
    windows.push({
      part_of_day: part,
      ...(normalizeClock(obj.earliest) ? { earliest: normalizeClock(obj.earliest)! } : {}),
      ...(normalizeClock(obj.latest) ? { latest: normalizeClock(obj.latest)! } : {}),
    });
  }
  const named = windows.filter((w) => w.part_of_day !== 'flexible');
  const kept = named.length ? named : windows;

  let session: Availability['session_minutes'];
  const sm = src.session_minutes as { min?: unknown; max?: unknown } | number | undefined;
  const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 600;
  if (typeof sm === 'number' && inRange(sm)) session = { min: Math.round(sm) };
  else if (sm && typeof sm === 'object' && inRange(sm.min)) {
    session = { min: Math.round(sm.min) };
    // A max below the min is the model getting them backwards; keep the honest half, drop the rest.
    if (inRange(sm.max) && sm.max >= sm.min) session.max = Math.round(sm.max);
  }

  if (!kept.length && !session) return undefined;
  return { windows: kept, ...(session ? { session_minutes: session } : {}) };
}

/**
 * What they say they already do. Kept as phrases, not parsed into numbers: "runs 4-5 k a few
 * times a week" is worth more to a planner whole than it is dismantled into a frequency the app
 * would then be tempted to enforce as a limit.
 */
function normalizeStartingPoint(raw: unknown): StartingPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as { doing_now?: unknown; trend?: unknown };
  const doing = (Array.isArray(src.doing_now) ? src.doing_now : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, ROUTINE_ITEM_MAX))
    .filter(Boolean)
    .slice(0, ROUTINE_ITEMS_MAX);
  const trend = typeof src.trend === 'string' ? src.trend.replace(/\s+/g, ' ').trim().slice(0, ROUTINE_ITEM_MAX) : '';
  if (!doing.length && !trend) return undefined;
  return { doing_now: doing, ...(trend ? { trend } : {}) };
}

/**
 * Coerce the Broker's free-form baseline_updates into the typed Baseline shape. Notably,
 * weight can arrive as { value, unit }, weight_kg, weight_lbs, or a bare number — we store
 * the canonical kg in weight_kg AND the user's unit in weight_unit so the app can display it
 * in the UOM they used (fixes weight landing in a field the UI can't read).
 */
export function normalizeBaseline(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw.age === 'number') out.age = raw.age;
  if (typeof raw.height_cm === 'number') out.height_cm = raw.height_cm;
  // Only the two values the energy formulas take. Anything else stays absent rather than being
  // coerced into one of them, and absent is never a blocker.
  if (raw.sex === 'male' || raw.sex === 'female') out.sex = raw.sex;

  const startingPoint = normalizeStartingPoint(raw.starting_point);
  if (startingPoint) out.starting_point = startingPoint;

  // Availability is what capture writes now. `time_of_day` is still accepted (the review wizard
  // patches it by hand, and older Broker output still sends it) and is DERIVED from a single
  // window so the coarse key can never contradict the richer one. Two or more windows have no
  // honest coarse equivalent — "mornings and evenings" is not "flexible" — so it is left alone.
  const availability = normalizeAvailability(raw.availability);
  if (availability) out.availability = availability;
  const tod =
    normalizeTimeOfDay(raw.time_of_day) ??
    (availability?.windows.length === 1 ? availability.windows[0]!.part_of_day : undefined);
  if (tod) out.time_of_day = tod;
  // days_per_week is deliberately NOT read here. It was captured once and it went null → 1 →
  // 2.5 → 2 for a man training for a 50 km ultra — every value a reading of what he was already
  // doing, none of them a statement of capacity — and it then capped his week. No prompt rule
  // survived that; the field is gone from capture. It stays readable (existing rows, and the
  // manual field in the review wizard), but nothing infers it. Frequency comes from what the
  // goal demands, the availability windows, and observed history.

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
  // [{label, kind, status, until, plan_around}]; legacy shapes (injuries [{area, condition}] or
  // bare strings) are mapped, never dropped.
  const constraints: Constraint[] = [];
  const pushConstraint = (
    label: string,
    kind: Constraint['kind'],
    plan_around: boolean,
    extra?: Partial<Constraint>,
  ) => {
    const l = label.trim();
    if (l) constraints.push({ id: randomUUID(), label: l, kind, plan_around, ...extra });
  };
  if (Array.isArray(raw.constraints)) {
    for (const c of raw.constraints as Array<Record<string, unknown> | string>) {
      if (typeof c === 'string') pushConstraint(c, 'life', false);
      else if (c && typeof c === 'object') {
        const kind = c.kind === 'physical' || c.kind === 'life' || c.kind === 'other' ? c.kind : 'other';
        // Only the two stated statuses land; anything else stays absent, and absent reads as
        // active downstream — the cautious default is the safe one.
        const status = c.status === 'active' || c.status === 'quiet' ? c.status : undefined;
        pushConstraint(String(c.label ?? [c.area, c.condition].filter(Boolean).join(' — ')), kind, !!c.plan_around, {
          ...(status ? { status } : {}),
          ...(isYmd(c.until) ? { until: c.until } : {}),
        });
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

/**
 * An IANA timezone the user stated ("I'm in Quebec, so Eastern"). Validated by asking Intl to
 * actually use it: a name the runtime rejects is a name that would throw somewhere far away, in
 * the middle of scheduling someone's morning. Anything else — an abbreviation, a UTC offset, a
 * country — is dropped rather than guessed at, because a wrong timezone moves every notification
 * and every "today" the app has.
 */
export function normalizeTimezone(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const tz = raw.trim();
  if (!tz.includes('/')) return undefined; // region/city only; "EST" and "UTC-5" are not zones
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    return tz;
  } catch {
    return undefined;
  }
}

/**
 * A goal's load-determining facts, in the user's own words. Whitespace-collapsed and capped —
 * a brief is a few plain sentences, and a model that starts writing an essay here is a model
 * that has started inventing.
 */
export function normalizeBrief(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, BRIEF_MAX) : undefined;
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
