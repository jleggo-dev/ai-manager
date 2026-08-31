/**
 * `then_now` — plain before/after pairs since the start (owner design "Cadence Progress" 1a,
 * "THEN → NOW · since Jan 5"). Cross-goal: it reads the whole done-session feed
 * (`listLoggedForProgress`), never one goal's slice.
 *
 * Honesty rules, enforced by construction:
 *  - a pair exists only when BOTH ends were actually recorded — an early value and a recent one —
 *    and the two display strings differ. Either direction: the card states what changed, it never
 *    manufactures an improvement and never hides a real change.
 *  - the "then" end must predate the recent window (last 28 days) — otherwise there is no honest
 *    "then" yet and the source stays quiet.
 *  - display strings are computed HERE so units render once, consistently; the client never
 *    re-derives a number.
 *  - fewer than two pairs and the whole card is omitted with evidence (one row reads as thin).
 *
 * Sources mined (each drops out silently when its data is not there):
 *  - run/walk pace per activity: sessions with BOTH distance and duration — earliest session's
 *    pace vs the fastest in the last four weeks. Needs a handful of sessions (≥ 5).
 *  - item-level exercises (the session logs' items): per exercise name, a parsed numeric `load`
 *    ("50 lb"), a duration, or reps — first recorded value vs the last-four-weeks max. Loads only
 *    compare within one unit; reps only carry an exercise that never had a load (bodyweight work,
 *    where reps ARE the measure); durations only where the item never carried a distance.
 *  - longest sit: mind-category sit/meditation occurrences — the longest in the first four weeks
 *    of sitting vs the longest in the last four.
 */
import type { GoalArea, OccurrenceLog, ThenNowPair, ThenNowPayload, WidgetOmission } from '@cadence/shared';
import { listLoggedForProgress } from '../repos/occurrences.ts';
import { canonicalMetrics } from './progress.ts';
import { EPOCH_DATE, omit } from './window-range.ts';

/** "Last 4 weeks" — the recent end of every pair, matching the design's own wording. */
const RECENT_DAYS = 28;
/** A pace pair needs a real habit behind it, not two data points. */
const MIN_PACE_SESSIONS = 5;
/** A card, not a table. */
const MAX_PAIRS = 6;
/** Plausibility clamp for a computed pace (min/km) — a typo'd 2-minute 10k must not become a row. */
const PACE_MIN = 2;
const PACE_MAX = 30;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDaysIso = (dateIso: string, days: number): string =>
  iso(new Date(`${dateIso}T00:00:00Z`).getTime() + days * 86_400_000);

/** One logged row as `listLoggedForProgress` hands it back — the resolver's only input shape. */
export interface ThenNowSessionRow {
  date: string; // YYYY-MM-DD
  title: string;
  category?: string | null;
  value: Record<string, number> | null;
  log: OccurrenceLog | null;
}

/* ── Display formatting (server-side, once) ─────────────────────────────────────────────────── */

/** 7.833 min/km → "7:50 /km". */
export function fmtPace(minPerKm: number): string {
  const totalSec = Math.round(minPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

const fmtNumber = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/** Both ends of a duration pair share one unit: seconds when both are short, minutes otherwise. */
export function fmtDurationPair(thenMin: number, nowMin: number): { then: string; now: string } {
  if (thenMin < 3 && nowMin < 3) {
    return { then: `${Math.round(thenMin * 60)} s`, now: `${Math.round(nowMin * 60)} s` };
  }
  return { then: `${Math.max(1, Math.round(thenMin))} min`, now: `${Math.max(1, Math.round(nowMin))} min` };
}

/** "50 lb" / "22.5 kg" → { v, unit } — only the two unambiguous weight-unit spellings; anything
 *  else ("bodyweight", "heavy", "band") is not a number we can compare and is skipped, never
 *  guessed. */
export function parseLoad(load: string | undefined): { v: number; unit: 'lb' | 'kg' } | null {
  if (!load) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(lb|lbs|pound|pounds|kg|kgs)\.?\s*$/i.exec(load);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return { v, unit: /^k/i.test(m[2]!) ? 'kg' : 'lb' };
}

/* ── Folding the rows into per-source series ────────────────────────────────────────────────── */

/** Item-level fallback when the occurrence's `value` rollup is empty — same small fold
 *  progress-sessions.ts keeps privately (progress.ts's own helper is unexported). */
function itemMetrics(log: OccurrenceLog | null): { distance_km?: number; duration_min?: number } {
  if (!log?.items?.length) return {};
  let distance_km = 0;
  let duration_min = 0;
  for (const i of log.items) {
    if (i.done === false) continue;
    if (typeof i.distance_km === 'number') distance_km += i.distance_km;
    if (typeof i.duration_min === 'number') duration_min += i.duration_min;
  }
  return { ...(distance_km > 0 ? { distance_km } : {}), ...(duration_min > 0 ? { duration_min } : {}) };
}

interface PaceSample {
  date: string;
  pace: number; // min/km
}

interface ItemSample {
  date: string;
  load?: { v: number; unit: 'lb' | 'kg' };
  durationMin?: number;
  reps?: number;
  hasDistance: boolean;
  /** The parent session's category was 'mind' — a breath hold, not a lift. */
  mind: boolean;
}

interface ItemSeries {
  label: string; // first-seen original casing
  samples: ItemSample[];
}

interface Mined {
  paceByTitle: Map<string, PaceSample[]>;
  itemsByName: Map<string, ItemSeries>;
  sitDurations: { date: string; durationMin: number }[];
}

const isSitRow = (row: ThenNowSessionRow): boolean =>
  (row.category ?? '').trim().toLowerCase() === 'mind' && /\bsit\b|meditat/i.test(row.title);

function mineRows(rows: ThenNowSessionRow[]): Mined {
  const paceByTitle = new Map<string, PaceSample[]>();
  const itemsByName = new Map<string, ItemSeries>();
  const sitDurations: { date: string; durationMin: number }[] = [];

  for (const row of rows) {
    const m = { ...itemMetrics(row.log), ...canonicalMetrics(row.value) };
    if (m.distance_km && m.duration_min) {
      const pace = m.duration_min / m.distance_km;
      if (pace >= PACE_MIN && pace <= PACE_MAX) {
        const list = paceByTitle.get(row.title) ?? [];
        list.push({ date: row.date, pace });
        paceByTitle.set(row.title, list);
      }
    }
    if (isSitRow(row) && m.duration_min) {
      sitDurations.push({ date: row.date, durationMin: m.duration_min });
    }
    for (const item of row.log?.items ?? []) {
      if (item.done === false || !item.name?.trim()) continue;
      const key = item.name.trim().toLowerCase();
      const series = itemsByName.get(key) ?? { label: item.name.trim(), samples: [] };
      const sample: ItemSample = {
        date: row.date,
        hasDistance: typeof item.distance_km === 'number',
        mind: (row.category ?? '').trim().toLowerCase() === 'mind',
      };
      const load = parseLoad(item.load);
      if (load) sample.load = load;
      if (typeof item.duration_min === 'number' && item.duration_min > 0) sample.durationMin = item.duration_min;
      if (typeof item.reps === 'number' && item.reps > 0) sample.reps = item.reps;
      series.samples.push(sample);
      itemsByName.set(key, series);
    }
  }
  return { paceByTitle, itemsByName, sitDurations };
}

/* ── Pair construction (each returns null rather than approximating) ────────────────────────── */

interface DatedPair extends ThenNowPair {
  thenDate: string;
}

function pacePair(title: string, samples: PaceSample[], recentFrom: string): DatedPair | null {
  if (samples.length < MIN_PACE_SESSIONS) return null;
  const earliest = samples[0]!;
  if (earliest.date >= recentFrom) return null;
  const recent = samples.filter((s) => s.date >= recentFrom);
  if (recent.length === 0) return null;
  const best = Math.min(...recent.map((s) => s.pace));
  const thenStr = fmtPace(earliest.pace);
  const nowStr = fmtPace(best);
  if (thenStr === nowStr) return null;
  return { label: `${title} pace`, then: thenStr, now: nowStr, area: 'movement', thenDate: earliest.date };
}

/** First recorded value vs the last-4-weeks max, over one numeric picker. */
function firstVsRecentMax(
  samples: ItemSample[],
  pick: (s: ItemSample) => number | undefined,
  recentFrom: string,
): { thenV: number; nowV: number; thenDate: string } | null {
  const dated = samples.filter((s) => pick(s) !== undefined);
  if (dated.length === 0) return null;
  const firstDate = dated[0]!.date;
  if (firstDate >= recentFrom) return null;
  const thenV = Math.max(...dated.filter((s) => s.date === firstDate).map((s) => pick(s)!));
  const recent = dated.filter((s) => s.date >= recentFrom);
  if (recent.length === 0) return null;
  const nowV = Math.max(...recent.map((s) => pick(s)!));
  return { thenV, nowV, thenDate: firstDate };
}

function itemPair(series: ItemSeries, recentFrom: string): DatedPair | null {
  // The family dot: an item practiced only inside mind sessions (a breath hold) wears mind;
  // anything else is movement work. Honest because it reads the parent sessions, never the name.
  const area: GoalArea = series.samples.every((s) => s.mind) ? 'mind' : 'movement';
  const loaded = series.samples.filter((s) => s.load);
  if (loaded.length > 0) {
    // Loads compare within ONE unit — the first-recorded one. A later switch of units is a fact
    // we cannot honestly line up against the start without converting their own words, so those
    // samples simply don't participate.
    const unit = loaded[0]!.load!.unit;
    const ends = firstVsRecentMax(series.samples, (s) => (s.load?.unit === unit ? s.load.v : undefined), recentFrom);
    if (!ends) return null;
    const thenStr = `${fmtNumber(ends.thenV)} ${unit}`;
    const nowStr = `${fmtNumber(ends.nowV)} ${unit}`;
    if (thenStr === nowStr) return null;
    return { label: series.label, then: thenStr, now: nowStr, area, thenDate: ends.thenDate };
  }
  // Never-loaded exercises: a timed hold (no distance — a distanced item is the run itself,
  // already covered by pace), else a bodyweight movement where reps are the measure.
  if (series.samples.some((s) => s.durationMin !== undefined && !s.hasDistance)) {
    const ends = firstVsRecentMax(series.samples, (s) => (s.hasDistance ? undefined : s.durationMin), recentFrom);
    if (!ends) return null;
    const { then, now } = fmtDurationPair(ends.thenV, ends.nowV);
    if (then === now) return null;
    return { label: series.label, then, now, area, thenDate: ends.thenDate };
  }
  const ends = firstVsRecentMax(series.samples, (s) => s.reps, recentFrom);
  if (!ends) return null;
  const thenStr = `${fmtNumber(ends.thenV)} reps`;
  const nowStr = `${fmtNumber(ends.nowV)} reps`;
  if (thenStr === nowStr) return null;
  return { label: series.label, then: thenStr, now: nowStr, area, thenDate: ends.thenDate };
}

function sitPair(sits: { date: string; durationMin: number }[], recentFrom: string): DatedPair | null {
  if (sits.length === 0) return null;
  const firstDate = sits[0]!.date;
  const earlyEnd = addDaysIso(firstDate, RECENT_DAYS);
  // The early window must close before the recent one opens — overlapping windows would compare
  // a period with itself.
  if (earlyEnd > recentFrom) return null;
  const early = sits.filter((s) => s.date < earlyEnd);
  const recent = sits.filter((s) => s.date >= recentFrom);
  if (early.length === 0 || recent.length === 0) return null;
  const thenV = Math.max(...early.map((s) => s.durationMin));
  const nowV = Math.max(...recent.map((s) => s.durationMin));
  const { then, now } = fmtDurationPair(thenV, nowV);
  if (then === now) return null;
  return { label: 'Longest sit', then, now, area: 'mind', thenDate: firstDate };
}

/* ── The pure resolver ──────────────────────────────────────────────────────────────────────── */

const byLabel = (a: DatedPair, b: DatedPair) => a.label.localeCompare(b.label);

/** Pure: fold already-fetched logged rows (date-ascending) into the card shape. */
export function resolveThenNow(rows: ThenNowSessionRow[], now: Date = new Date()): ThenNowPayload | WidgetOmission {
  const recentFrom = iso(now.getTime() - RECENT_DAYS * 86_400_000);
  const mined = mineRows(rows);

  const loadPairs: DatedPair[] = [];
  const timedPairs: DatedPair[] = [];
  for (const series of mined.itemsByName.values()) {
    const pair = itemPair(series, recentFrom);
    if (!pair) continue;
    (series.samples.some((s) => s.load) ? loadPairs : timedPairs).push(pair);
  }
  const pacePairs = [...mined.paceByTitle.entries()]
    .map(([title, samples]) => pacePair(title, samples, recentFrom))
    .filter((p): p is DatedPair => p !== null);
  const sit = sitPair(mined.sitDurations, recentFrom);

  const pairs = [
    ...loadPairs.sort(byLabel),
    ...pacePairs.sort(byLabel),
    ...timedPairs.sort(byLabel),
    ...(sit ? [sit] : []),
  ].slice(0, MAX_PAIRS);

  if (pairs.length < 2) {
    return omit('then_now', 'then_now', `fewer than two honest before/after pairs in the logs (found ${pairs.length})`);
  }

  const since = pairs.map((p) => p.thenDate).sort()[0]!;
  return {
    since,
    pairs: pairs.map(({ label, then, now: nowStr, area }) => ({
      label,
      then,
      now: nowStr,
      ...(area ? { area: area as GoalArea } : {}),
    })),
  };
}

/** Fetch + resolve for one user — the whole done-session feed, since "then" means the start. */
export async function getThenNow(userId: string, now: Date = new Date()): Promise<ThenNowPayload | WidgetOmission> {
  const rows = await listLoggedForProgress(userId, EPOCH_DATE);
  return resolveThenNow(rows, now);
}
