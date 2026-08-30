/* ════════════════════════════════════════════════════════════════
   The metronome — a pulse that rides along with a step
   ════════════════════════════════════════════════════════════════ */

/**
 * A metronome is **not a tool**. It captures nothing, it cannot be the thing you did, and no log
 * line ever mentions it — so it rides alongside whatever tool the step already has, exactly the way
 * `video_query` does ("a per-step field, not a tool — a how-to link can ride alongside any tool").
 * A scales step is a timer step that happens to have a pulse; the timer is still the tool.
 *
 * It is attached by the COACH and only by the coach. A pulse is furniture on a plank and a
 * distraction on a sit; it earns its place when someone is practising to a beat, and she is the one
 * who knows that. So there is no metronome on a step she didn't put one on — the same stance the
 * catalog takes everywhere else: she decides what a step is, the app renders it.
 *
 * Dependency-free and pure like `breathing.ts` and `interval.ts` (no clock, no DOM, no audio):
 * `@cadence/api` clamps coach output with it and `@cadence/web` drives the click with it. As in
 * `interval.ts`, position is a **function of elapsed time** rather than accumulated state, so a
 * dropped frame or a backgrounded tab can never leave the beat count out of step with the sound.
 *
 * Bounds are enforced here, not trusted to the coach — a "practise at 400" is clamped to something
 * a piano actually plays, silently and safely.
 */

/** The whole thing, as numbers. Two, because a metronome is genuinely this small. */
export interface MetronomeSpec {
  /** Quarter-note beats per minute. */
  bpm: number;
  /** Beats to a bar — the accent falls on the first. 1 = every click identical, no downbeat. */
  meter: number;
}

/* ── Bounds ──────────────────────────────────────────────────────────────────────────────────── */

/** Below this the gap between clicks is long enough that you are counting, not following. */
export const MIN_BPM = 30;
/** Past this the clicks fuse into a tone — a real metronome stops here too. */
export const MAX_BPM = 240;
/** A bar of one is the legitimate "no accent" case, not a degenerate one. */
export const MIN_METER = 1;
/** Twelve covers 12/8; past it the downbeat is too far away to orient by. */
export const MAX_METER = 12;

/** Walking pace — the tempo that is wrong for the least music when nobody has said. */
export const DEFAULT_BPM = 90;
export const DEFAULT_METER = 4;

/** The meters the dock offers as one tap. Any value in range is legal; these are the common ones. */
export const METERS: readonly number[] = [2, 3, 4, 6];

/** How far apart two taps can be and still belong to the same attempt. Longer = a new count-in. */
export const TAP_RESET_MS = 3000;
/** Intervals averaged for tap tempo. Enough to steady the estimate, few enough to follow a change. */
export const MAX_TAP_INTERVALS = 7;

/* ── Clamps ──────────────────────────────────────────────────────────────────────────────────── */

/** Round and bound a tempo. Non-finite input falls back to the default rather than throwing. */
export function clampBpm(bpm: number | null | undefined): number {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** Round and bound a meter. */
export function clampMeter(meter: number | null | undefined): number {
  if (typeof meter !== 'number' || !Number.isFinite(meter)) return DEFAULT_METER;
  return Math.min(MAX_METER, Math.max(MIN_METER, Math.round(meter)));
}

/**
 * Coach output → a safe spec, or `undefined` for "no metronome on this step". The absence of a
 * tempo is the signal: a step with no `metronome_bpm` gets no pulse and no dock, which is what
 * makes this coach-invoked rather than a control sitting on every screen in the app.
 */
export function normalizeMetronome(
  bpm: number | null | undefined,
  meter?: number | null | undefined,
): MetronomeSpec | undefined {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return undefined;
  return { bpm: clampBpm(bpm), meter: clampMeter(meter) };
}

/* ── The beat, as arithmetic ─────────────────────────────────────────────────────────────────── */

/** Seconds between clicks. */
export function secondsPerBeat(bpm: number): number {
  return 60 / clampBpm(bpm);
}

/**
 * Which beat you are on, `elapsedSec` after the first click — 0-based, so beat 0 is the first.
 * A function of elapsed time, never of a counter that ticks: see the module note.
 */
export function beatIndexAt(elapsedSec: number, bpm: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return 0;
  return Math.floor(elapsedSec / secondsPerBeat(bpm));
}

/** Where in the bar a beat falls — 0-based, so 0 is the downbeat. */
export function beatInBar(beatIndex: number, meter: number): number {
  const m = clampMeter(meter);
  if (!Number.isFinite(beatIndex) || beatIndex < 0) return 0;
  return Math.floor(beatIndex) % m;
}

/**
 * Does this beat get the accent? A bar of one has no downbeat to speak of — every click is the
 * same, which is the point of choosing it — so it accents nothing rather than accenting everything.
 */
export function isDownbeat(beatIndex: number, meter: number): boolean {
  return clampMeter(meter) > 1 && beatInBar(beatIndex, meter) === 0;
}

/* ── Tempo marking ───────────────────────────────────────────────────────────────────────────── */

/** Lower bound (inclusive) → the marking that starts there. Ordered fastest-first for the lookup. */
const MARKINGS: readonly (readonly [number, string])[] = [
  [200, 'Prestissimo'],
  [168, 'Presto'],
  [120, 'Allegro'],
  [108, 'Moderato'],
  [76, 'Andante'],
  [60, 'Adagio'],
  [40, 'Largo'],
  [0, 'Grave'],
];

/**
 * The Italian marking for a tempo. Not decoration: a pianist reads "Andante" at the top of the page
 * and this is the line that connects the number on screen to the word on the score. The boundaries
 * are the conventional ones; where sources disagree by a few bpm, nothing here depends on it.
 */
export function tempoMarking(bpm: number): string {
  const at = clampBpm(bpm);
  for (const [floor, name] of MARKINGS) if (at >= floor) return name;
  return 'Grave';
}

/* ── Tap tempo ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Derive a tempo from tap timestamps (ms, oldest → newest). Walks **backwards** from the last tap
 * and stops at the first gap longer than `TAP_RESET_MS`, so a series that was abandoned and
 * restarted resolves to the restart without the caller having to prune anything: pausing to find
 * the tempo again is the normal way this button gets used, not an error case.
 *
 * Returns `null` until there are two taps in one series — one tap is a moment, not an interval.
 */
export function tapTempo(taps: readonly number[]): number | null {
  const intervals: number[] = [];
  for (let i = taps.length - 1; i > 0 && intervals.length < MAX_TAP_INTERVALS; i--) {
    const gap = (taps[i] as number) - (taps[i - 1] as number);
    if (!Number.isFinite(gap) || gap <= 0 || gap > TAP_RESET_MS) break;
    intervals.push(gap);
  }
  if (intervals.length === 0) return null;
  const mean = intervals.reduce((sum, g) => sum + g, 0) / intervals.length;
  return clampBpm(60000 / mean);
}
