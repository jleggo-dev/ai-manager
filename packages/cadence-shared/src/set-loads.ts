/**
 * Load per set (walkthrough v3 Phase 5, owner's gym session 2026-11-02: a glute bridge "12 ×
 * bodyweight · 2 sets" with no way to add weight, so reps were logged against a load nobody lifted).
 * The few pure rules both sides need: how a list of per-set loads is written into the log line the
 * coach reads, and how a load string and a number turn into each other for the weight sheet. No
 * React, no clock.
 *
 * The log line shapes are the ones the design's Redlines board uses:
 *   "3×12 @ 15 lb (plan said bodyweight)"   — the sets were lifted at a load the plan did not say
 *   "2×12 @ 40 lb · swapped from glute bridge" — a swap is never a skip
 */

/** What was actually lifted, one entry per set in order. `null` is a set with no load. */
export type SetLoads = ReadonlyArray<string | null>;

/** The word for a set lifted with no load, in the log line and on the weight sheet's None chip. */
export const NO_LOAD = 'bodyweight';

export type LoadUnit = 'lb' | 'kg';

/** One dial step on the weight sheet, per unit (design A: 2.5 lb steps; a kilo in metric). */
export const LOAD_STEP: Record<LoadUnit, number> = { lb: 2.5, kg: 1 };

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);

/** True when any set was lifted at a load other than the plan's. An absent list means as planned. */
export function loadsDiffer(plan: string | undefined, loads: SetLoads | undefined): boolean {
  return !!loads && loads.some((l) => !same(l, plan));
}

/**
 * The " @ …" tail of a log line. As planned (or no per-set record): " @ 40 lb", or "" when the plan
 * had no load. Lifted at one other load: " @ 15 lb (plan said bodyweight)". Lifted at different
 * loads across the sets: " @ [15 lb, 15 lb, 20 lb] (plan said 15 lb)". The plan is always named
 * when it was not followed, so the coach reads what changed without looking the session up.
 */
export function loadTail(plan: string | undefined, loads?: SetLoads): string {
  if (!loadsDiffer(plan, loads) || !loads?.length) return plan ? ` @ ${plan}` : '';
  const said = ` (plan said ${plan ?? NO_LOAD})`;
  const [first] = loads;
  const uniform = loads.every((l) => same(l, first));
  if (uniform) return ` @ ${first ?? NO_LOAD}${said}`;
  return ` @ [${loads.map((l) => l ?? NO_LOAD).join(', ')}]${said}`;
}

/** " · swapped from glute bridge", or "" when the step was done as prescribed. */
export function swappedTail(from: string | undefined): string {
  return from ? ` · swapped from ${from}` : '';
}

/**
 * A load the weight sheet can put on its dial: "15 lb", "7.5 kg", "40lbs", "20 kilograms" and the
 * like. Anything else — "bodyweight", "2×40 lb", "zone 2", "light band" — is null, and the sheet
 * starts from the suggestion or from none. Never guesses a unit: a bare "15" is null too.
 */
export function parseLoad(load: string | undefined | null): { value: number; unit: LoadUnit } | null {
  if (!load) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(lbs?|pounds?|kgs?|kilos?|kilograms?)\s*$/i.exec(load);
  const [, number, unit] = m ?? [];
  if (!number || !unit) return null;
  const value = Number(number.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;
  return { value, unit: /^(lb|pound)/i.test(unit) ? 'lb' : 'kg' };
}

/** A load as the app writes it: "7.5 lb", "15 lb", "20 kg" — the unit spelled, no trailing zeros.
 *  Zero is no load at all and reads "bodyweight". */
export function formatLoad(value: number, unit: LoadUnit): string {
  if (!Number.isFinite(value) || value <= 0) return NO_LOAD;
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${unit}`;
}
