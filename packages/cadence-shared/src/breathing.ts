/* ════════════════════════════════════════════════════════════════
   Breathwork — the pattern bank + cycle maths (REQ9 §4.1)
   ════════════════════════════════════════════════════════════════ */

/**
 * The Mind pillar's first tool. ONE deterministic model covers every technique we support: a
 * **pattern is an ordered list of phases** (`{label, seconds, cue?}`) played for N **cycles**. The
 * player animates any pattern without knowing its name — so adding a technique is adding data, not
 * code, and the coach configures the tool by naming a pattern and a count.
 *
 * Dependency-free on purpose (no clock, no DOM, no DB): `@cadence/api` normalizes coach output
 * with it and `@cadence/web` drives the animation with it. The clock lives in the renderer; every
 * function here is pure and total.
 *
 * **Safety caps are enforced here, not trusted to the coach** (mirrors how session-normalize caps
 * circuit rounds): holds are bounded, sessions are bounded, and the one energizing pattern is
 * bounded harder and carries seated copy. Deliberately absent from the bank: Wim-Hof-style
 * hyperventilation-plus-breath-hold rounds — a real fainting risk, out of scope for v1.
 */

export type BreathPatternId =
  | 'box'
  | 'wind_down'
  | 'coherent'
  | 'extended_exhale'
  | 'physiological_sigh'
  | 'triangle'
  | 'equal'
  | 'alternate_nostril'
  | 'up_shift';

/** One phase of a breath cycle. `cue` is a short per-phase instruction the quantities can't carry
 *  (which nostril, "and again" for the sigh's second inhale) — shown under the phase label. */
export interface BreathPhase {
  label: string;
  seconds: number;
  cue?: string;
}

export interface BreathPattern {
  id: BreathPatternId;
  /** User-facing name. Plain words — never clinical, never a technique's jargon. */
  name: string;
  /** What it's for, in the coach's register. One short line. */
  summary: string;
  phases: BreathPhase[];
  /** Extra copy the surface must show (seated warnings). Present only where it's needed. */
  caution?: string;
  /**
   * How the pattern works, in plain words — the written equivalent of the how-to video a barbell
   * movement gets. Written rather than filmed on purpose: a breath pattern is counts and
   * attention, not form, so a video would be 90% filler, and text can be read mid-practice with
   * the sound off. (A coach can still attach `video_query` to any step if it genuinely helps.)
   */
  how: string;
  /** Energizing patterns are capped harder and never auto-selected. */
  gated?: boolean;
}

/* ── Safety caps (the coach cannot exceed these; normalize clamps to them) ─────────────────── */

/** No single held phase may exceed this. 4-7-8's 7-second hold is the longest we ship. */
export const MAX_HOLD_SECONDS = 10;
/** A breathing step is a practice, not an endurance event. */
export const MAX_SESSION_SECONDS = 600;
/** The one in-biased pattern is strictly bounded — it is the only one that can leave you lightheaded. */
export const MAX_UP_SHIFT_SECONDS = 30;
/** Guardrail on the coach's cycle count; the real bound is the session cap. */
export const MAX_CYCLES = 60;
export const MIN_CYCLES = 1;

/* ── The bank ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Nine patterns. Order is intentional — it is the order the catalog renders for the coach and the
 * order a picker would show. `coherent` is the daily-practice default; `box` is the safe generic.
 */
export const BREATH_PATTERNS: readonly BreathPattern[] = [
  {
    id: 'box',
    how: 'Equal counts all the way round: in for four, hold for four, out for four, hold for four. The holds are the point — they stop you rushing into the next breath.',
    name: 'Box',
    summary: 'even four counts all the way round — in, hold, out, hold',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Hold', seconds: 4 },
      { label: 'Out', seconds: 4 },
      { label: 'Hold', seconds: 4 },
    ],
  },
  {
    id: 'wind_down',
    how: 'In for four, hold for seven, out for eight. The long hold and the longer exhale are what do the work: a slow out-breath is how the body is told the day is finished.',
    name: 'Wind-down',
    summary: 'a long hold and a longer exhale — in for four, hold seven, out eight',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Hold', seconds: 7 },
      { label: 'Out', seconds: 8 },
    ],
  },
  {
    id: 'coherent',
    how: 'In and out for about five and a half seconds each, with no holds. Slower than you would breathe on your own, and even. This is the one worth building a daily practice on.',
    name: 'Coherent',
    summary: 'equal in and out, about five and a half seconds each, no holds',
    phases: [
      { label: 'In', seconds: 5.5 },
      { label: 'Out', seconds: 5.5 },
    ],
  },
  {
    id: 'extended_exhale',
    how: 'In for four, out for six — only the out-breath is stretched. The fastest way to settle when you do not want a pattern to remember.',
    name: 'Longer out',
    summary: 'in for four, out for six — only the out-breath is stretched',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Out', seconds: 6 },
    ],
  },
  {
    id: 'physiological_sigh',
    how: 'Two breaths in — a full one, then a short top-up on top of it — then one long release. The second inhale reopens the bottom of the lungs. Three or four rounds is usually plenty.',
    name: 'Double breath',
    summary: 'two breaths in — a full one, then a short top-up — then one long release',
    phases: [
      { label: 'In', seconds: 3 },
      { label: 'In again', seconds: 1, cue: 'a short top-up, on top of the first' },
      { label: 'Out', seconds: 6, cue: 'let it all go' },
    ],
  },
  {
    id: 'triangle',
    how: 'In, hold, out, all for four. Box without the second hold, which makes it easier to follow when your attention is short.',
    name: 'Triangle',
    summary: 'box without the second hold — simpler to follow',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Hold', seconds: 4 },
      { label: 'Out', seconds: 4 },
    ],
  },
  {
    id: 'equal',
    how: 'In for four, out for four. Nothing to remember and nothing to hold. Start here if none of this is familiar.',
    name: 'Even',
    summary: 'in and out, same count, no holds',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Out', seconds: 4 },
    ],
  },
  {
    id: 'alternate_nostril',
    how: 'Breathe in through one side, out through the other, then swap. Right thumb closes the right nostril, ring finger closes the left. Giving your hands a job is half of why it settles.',
    name: 'Side to side',
    summary: 'one side at a time — settling, and it gives the hands something to do',
    phases: [
      { label: 'In', seconds: 4, cue: 'left side — right thumb closes the right' },
      { label: 'Hold', seconds: 2 },
      { label: 'Out', seconds: 4, cue: 'right side — ring finger closes the left' },
      { label: 'In', seconds: 4, cue: 'right side' },
      { label: 'Hold', seconds: 2 },
      { label: 'Out', seconds: 4, cue: 'left side' },
    ],
  },
  {
    id: 'up_shift',
    how: 'Quick breaths with the weight on the in-breath. This one wakes you up rather than settling you, so it is deliberately short.',
    name: 'Sharpen',
    summary: 'quick and in-biased, before something that needs you awake — short by design',
    phases: [
      { label: 'In', seconds: 2 },
      { label: 'Out', seconds: 1 },
    ],
    caution: 'Sit down for this one, and stop if you feel lightheaded.',
    gated: true,
  },
];

/** The pattern used when the coach names none. Coherent is the daily-practice baseline. */
export const DEFAULT_PATTERN_ID: BreathPatternId = 'coherent';
/** Cycles used when the coach names a pattern but no count. */
export const DEFAULT_CYCLES = 6;

const BY_ID = new Map<string, BreathPattern>(BREATH_PATTERNS.map((p) => [p.id, p]));

/** Look up a pattern by id. Unknown/absent ids fall back to the default — never throws, so bad
 *  coach output degrades to a safe pattern instead of a broken step. */
export function patternById(id: string | null | undefined): BreathPattern {
  const found = id ? BY_ID.get(id) : undefined;
  if (found) return found;
  const fallback = BY_ID.get(DEFAULT_PATTERN_ID);
  if (fallback) return fallback;
  // Unreachable while the bank is non-empty; keeps the function total without a non-null assertion.
  return {
    id: 'equal',
    name: 'Even',
    summary: 'in and out, same count',
    how: 'In for four, out for four. Nothing to remember and nothing to hold.',
    phases: [
      { label: 'In', seconds: 4 },
      { label: 'Out', seconds: 4 },
    ],
  };
}

export function isBreathPatternId(id: string | null | undefined): id is BreathPatternId {
  return typeof id === 'string' && BY_ID.has(id);
}

/* ── Cycle maths ──────────────────────────────────────────────────────────────────────────── */

/** Seconds in one full cycle of the pattern. */
export function cycleSeconds(pattern: BreathPattern): number {
  return pattern.phases.reduce((sum, p) => sum + Math.max(0, p.seconds), 0);
}

/**
 * The cycle count actually played, after safety clamping: at least one, never more than
 * `MAX_CYCLES`, and never enough to exceed the session cap (or, for a gated pattern, its own
 * tighter cap). Always returns ≥ 1 so a step can never be empty.
 */
export function clampCycles(pattern: BreathPattern, cycles: number | null | undefined): number {
  const per = cycleSeconds(pattern);
  const cap = pattern.gated ? MAX_UP_SHIFT_SECONDS : MAX_SESSION_SECONDS;
  const byTime = per > 0 ? Math.floor(cap / per) : MAX_CYCLES;
  const ceiling = Math.max(1, Math.min(MAX_CYCLES, byTime));
  const asked = typeof cycles === 'number' && Number.isFinite(cycles) ? Math.round(cycles) : DEFAULT_CYCLES;
  return Math.min(ceiling, Math.max(MIN_CYCLES, asked));
}

/** Total seconds for a clamped run of the pattern. */
export function totalSeconds(pattern: BreathPattern, cycles: number): number {
  return cycleSeconds(pattern) * clampCycles(pattern, cycles);
}

/** Whole minutes a breathing step occupies, floored at 1 so it never renders as "0 min". */
export function totalMinutes(pattern: BreathPattern, cycles: number): number {
  return Math.max(1, Math.round(totalSeconds(pattern, cycles) / 60));
}

/** Where the player is at `elapsed` seconds. */
export interface BreathPosition {
  /** 0-based cycle index; equals the clamped cycle count once finished. */
  cycle: number;
  phaseIndex: number;
  phase: BreathPhase;
  /** Seconds remaining in this phase (counts down, never below 0). */
  remaining: number;
  /** Fraction of this phase elapsed, 0→1 — what the animation follows. */
  progress: number;
  done: boolean;
}

/**
 * Resolve the player's position from elapsed seconds. Pure — the renderer owns the clock and calls
 * this each tick, so the animation is a function of time rather than accumulated state (a dropped
 * frame or a backgrounded tab can never desynchronize the pattern from the count).
 */
export function phaseAt(pattern: BreathPattern, cycles: number, elapsed: number): BreathPosition {
  const played = clampCycles(pattern, cycles);
  const per = cycleSeconds(pattern);
  const first = pattern.phases[0] ?? { label: 'In', seconds: 4 };
  const last = pattern.phases[pattern.phases.length - 1] ?? first;
  const t = Math.max(0, elapsed);

  if (per <= 0 || t >= per * played) {
    return { cycle: played, phaseIndex: pattern.phases.length - 1, phase: last, remaining: 0, progress: 1, done: true };
  }

  const cycle = Math.floor(t / per);
  let within = t - cycle * per;
  for (let i = 0; i < pattern.phases.length; i += 1) {
    const phase = pattern.phases[i];
    if (!phase) continue;
    const len = Math.max(0, phase.seconds);
    if (within < len || i === pattern.phases.length - 1) {
      const remaining = Math.max(0, len - within);
      return {
        cycle,
        phaseIndex: i,
        phase,
        remaining,
        progress: len > 0 ? Math.min(1, within / len) : 1,
        done: false,
      };
    }
    within -= len;
  }
  return { cycle, phaseIndex: 0, phase: first, remaining: first.seconds, progress: 0, done: false };
}

type PhaseKind = 'in' | 'out' | 'hold';

/** Classify a phase from its label. Labels are authored in the bank, so this stays a simple prefix
 *  test — "In", "In again" → in; "Out" → out; "Hold" and anything else → hold. */
function phaseKind(label: string): PhaseKind {
  const l = label.toLowerCase();
  if (l.startsWith('in')) return 'in';
  if (l.startsWith('out')) return 'out';
  return 'hold';
}

/**
 * How full the lungs are, 0→1, at a given phase and progress — what the animated form follows.
 *
 * This is NOT per-phase, and that distinction is the whole point: **consecutive same-direction
 * phases share one continuous run.** The double breath is "In 3 · In again 1 · Out 6", and the
 * second inhale is a *top-up on top of the first* — so at the start of "In again" the form is
 * already ¾ full and tops up to full, rather than collapsing and re-expanding. A hold holds
 * whatever the last real movement reached.
 */
export function breathFullness(pattern: BreathPattern, phaseIndex: number, progress: number): number {
  const phases = pattern.phases;
  const current = phases[phaseIndex];
  if (!current) return 0;
  const kind = phaseKind(current.label);

  if (kind === 'hold') return heldAt(phases, phaseIndex);

  // Widen to the contiguous run of same-direction phases containing this one.
  let start = phaseIndex;
  while (start > 0 && phaseKind(phases[start - 1]?.label ?? '') === kind) start -= 1;
  let end = phaseIndex;
  while (end < phases.length - 1 && phaseKind(phases[end + 1]?.label ?? '') === kind) end += 1;

  let total = 0;
  let before = 0;
  for (let i = start; i <= end; i += 1) {
    const secs = Math.max(0, phases[i]?.seconds ?? 0);
    if (i < phaseIndex) before += secs;
    total += secs;
  }
  const withinRun = before + Math.max(0, current.seconds) * Math.min(1, Math.max(0, progress));
  const fraction = total > 0 ? Math.min(1, withinRun / total) : 1;
  return kind === 'in' ? fraction : 1 - fraction;
}

/** A hold keeps the fullness the last in/out reached — searching backwards, then wrapping. */
function heldAt(phases: readonly BreathPhase[], phaseIndex: number): number {
  for (let i = phaseIndex - 1; i >= 0; i -= 1) {
    const k = phaseKind(phases[i]?.label ?? '');
    if (k === 'in') return 1;
    if (k === 'out') return 0;
  }
  for (let i = phases.length - 1; i > phaseIndex; i -= 1) {
    const k = phaseKind(phases[i]?.label ?? '');
    if (k === 'in') return 1;
    if (k === 'out') return 0;
  }
  return 0;
}

/** A short human summary of a pattern's counts — "4 · 7 · 8". Used on pickers and in logs. */
export function patternCounts(pattern: BreathPattern): string {
  return pattern.phases
    .map((p) => (Number.isInteger(p.seconds) ? String(p.seconds) : p.seconds.toFixed(1)))
    .join(' · ');
}

/** The one-line summary a completed breathing step contributes to the occurrence log. */
export function breathLogLine(pattern: BreathPattern, completedCycles: number, playedCycles: number): string {
  const done = Math.max(0, Math.min(completedCycles, playedCycles));
  if (done >= playedCycles) return `${pattern.name} · ${playedCycles} rounds`;
  return `${pattern.name} · ${done} of ${playedCycles} rounds · that counts`;
}
