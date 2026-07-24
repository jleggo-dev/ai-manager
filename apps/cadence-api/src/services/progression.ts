/**
 * Deterministic progression engine — the first entry in the "tool library" (plan §deterministic
 * fitness). For a `plan_mode='deterministic'` goal, this REPLACES the per-session `prescribe-session`
 * AI call: it carries the eval session forward, progressing ONLY the scheme's quantity per elapsed
 * week (+increment/wk, deload every Nth week), so a workout renders instantly and predictably.
 *
 * Pure & dependency-free (no DB, no engine, no clock) so it's unit-testable and its output is a
 * deterministic function of its inputs — same (evalSession, scheme, ctx, generatedAt) → identical
 * OccurrenceSession. session-generate.ts supplies the inputs and caches the result like any session.
 */
import type { OccurrenceSession, ProgressionScheme, SessionBlock, SessionItem } from '@cadence/shared';

/** Parse a user-facing load ("55 lb", "60kg", "bodyweight", "zone 2") into number + unit suffix.
 *  null when there's no leading number — "bodyweight"/"zone 2" don't progress and are carried as-is. */
export function parseLoad(load?: string | null): { n: number; unit: string } | null {
  if (!load) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(load);
  if (!m) return null;
  return { n: Number(m[1]), unit: (m[2] ?? '').trim() };
}

const roundQuantity: Record<ProgressionScheme['quantity'], (n: number) => number> = {
  load: (n) => Math.max(0, Math.round(n / 5) * 5), // nearest 5 (plates)
  reps: (n) => Math.max(1, Math.round(n)),
  distance_km: (n) => Math.max(0, Math.round(n * 10) / 10), // 0.1 km
  duration_min: (n) => Math.max(1, Math.round(n)),
};

/** Deload weeks are those w where (w+1) % every === 0 (the every-th, 2·every-th, …). */
function isDeloadWeek(weekIndex: number, every?: number): boolean {
  return !!every && every > 0 && (weekIndex + 1) % every === 0;
}
/** Progression steps taken by `weekIndex` = weeks elapsed minus the deload weeks among them. */
function progressionSteps(weekIndex: number, every?: number): number {
  const deloads = every && every > 0 ? Math.floor(weekIndex / every) : 0;
  return Math.max(0, weekIndex - deloads);
}
function applyProgression(base: number, steps: number, scheme: ProgressionScheme): number {
  if (steps <= 0) return base;
  return scheme.kind === 'percent'
    ? base * Math.pow(1 + scheme.increment / 100, steps)
    : base + scheme.increment * steps;
}

export interface ProgressionContext {
  weekIndex: number; // whole weeks since the plan started (0 = baseline/eval week)
  lastMissed?: boolean; // the most recent logged session wasn't completed → hold at last week's level
}

/** Scale one item's progressing quantity; other fields (name, detail, other quantities) pass through. */
function scaleItem(item: SessionItem, scheme: ProgressionScheme, scale: (base: number) => number): SessionItem {
  const q = scheme.quantity;
  if (q === 'load') {
    const parsed = parseLoad(item.load);
    if (!parsed) return item; // bodyweight / zone-based — nothing numeric to progress
    const n = roundQuantity.load(scale(parsed.n));
    return { ...item, load: parsed.unit ? `${n} ${parsed.unit}` : String(n) };
  }
  const cur = item[q];
  if (typeof cur !== 'number') return item; // this item doesn't carry the progressing quantity
  return { ...item, [q]: roundQuantity[q](scale(cur)) };
}

/**
 * Carry `evalSession` forward to `ctx.weekIndex`, progressing only `scheme.quantity`. The eval
 * session (week 0, coach-programmed) is the template: exercise names/structure/other fields are
 * preserved; only the progressing number moves. A miss last time holds at the previous week's level.
 */
export function computeSession(
  evalSession: OccurrenceSession,
  scheme: ProgressionScheme,
  ctx: ProgressionContext,
  generatedAt: string,
): OccurrenceSession {
  if (!evalSession.blocks?.length) return { ...evalSession, generated_at: generatedAt };

  const effWeek = ctx.lastMissed ? Math.max(0, ctx.weekIndex - 1) : ctx.weekIndex;
  const deload = isDeloadWeek(effWeek, scheme.deload_every);
  const steps = progressionSteps(effWeek, scheme.deload_every);
  const deloadFactor = (scheme.deload_pct ?? 90) / 100;
  const scale = (base: number): number => {
    const progressed = applyProgression(base, steps, scheme);
    return deload ? progressed * deloadFactor : progressed;
  };

  const blocks: SessionBlock[] = evalSession.blocks.map((b) => ({
    label: b.label,
    items: b.items.map((it) => scaleItem(it, scheme, scale)),
  }));

  const note = deload
    ? `Recovery week — ease back to about ${Math.round(deloadFactor * 100)}% and let the work sink in.`
    : steps === 0
      ? 'Baseline week — settle into the movements at your starting numbers.'
      : `Week ${ctx.weekIndex + 1} — a small step up. Same movements, a touch more than last week.`;

  return { blocks, note, generated_at: generatedAt, version: (evalSession.version ?? 0) + 1 };
}
