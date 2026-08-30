import { isDownbeat, secondsPerBeat } from '@cadence/shared';

/**
 * The click, scheduled on the audio clock rather than the JavaScript one.
 *
 * Every other timer in this folder ticks on `setInterval(…, 1000)` and that is completely fine for
 * them: a countdown that fires 12 ms late is a countdown that fires 12 ms late, and nobody can see
 * it. A metronome is the one thing here where that jitter is the whole product — `setInterval` is
 * throttled by layout, by a busy main thread, by the tab losing focus, and at 120 bpm a handful of
 * milliseconds of drift per beat is audible as a wobble within a few bars. You cannot practise to
 * it.
 *
 * So this uses the standard two-clock arrangement. A cheap `setInterval` **scheduler** wakes up
 * every 25 ms and does no sound work of its own; it just looks 120 ms into the future and hands any
 * beat falling inside that window to WebAudio with an exact `ctx.currentTime` start. The audio
 * thread — sample-accurate, unaffected by anything happening in JavaScript — plays them. Late
 * wake-ups are harmless because each one only has to arrive before the window closes, not on the
 * beat.
 *
 * That leaves the *visual* beat, which must not be scheduled the same way: a dot that lights up
 * 120 ms before its click is worse than no dot. Scheduled beats go onto a queue and a separate
 * animation-frame loop pops them only once the audio clock has actually reached them, so the dot
 * and the sound land together.
 *
 * When there is no WebAudio at all (SSR, jsdom, an autoplay policy that never lets go) the clock
 * degrades to a plain interval that fires the visual beat and stays silent — the dots keep the
 * pulse, in the same spirit as `chime.ts`, where the visual state is always the real signal.
 */

/** How often the scheduler wakes. Cheap: it usually finds nothing to do. */
const TICK_MS = 25;
/** How far ahead beats are handed to the audio thread. Long enough to absorb a stalled main
 *  thread, short enough that a tempo change is heard within a beat. */
const LOOKAHEAD_SEC = 0.12;

/** The click itself — a short pitched blip. The accent is higher and louder; same timbre, so a bar
 *  reads as one instrument rather than two. */
const ACCENT_HZ = 1600;
const BEAT_HZ = 1000;
const ACCENT_GAIN = 0.5;
const BEAT_GAIN = 0.28;
const CLICK_SEC = 0.035;

export interface MetronomeClock {
  /** Begin from beat 0. Safe to call while already running (a no-op). */
  start(): void;
  /** Stop and release the audio hardware. The next `start()` begins from the downbeat again. */
  stop(): void;
  /** Change tempo or meter mid-run — takes effect on the next scheduled beat (≤ ~120 ms). */
  setSpec(bpm: number, meter: number): void;
  /** Tear down for good. Always call on unmount. */
  dispose(): void;
}

/** One shared context for the life of the page. Browsers cap how many you may hold (~6), and this
 *  one is opened and closed as often as someone taps Start — so it is opened once and merely
 *  suspended when idle, which also parks it off the audio hardware between practices. */
let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (shared) return shared;
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    shared = new Ctor();
    return shared;
  } catch {
    return null; // no audio — the caller falls back to a silent, visual-only pulse
  }
}

function click(ctx: AudioContext, at: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
  // Instant attack, fast decay — a tick, not a note. Exponential ramps cannot reach zero, hence
  // the 0.0001 floor (the same shape `chime.ts` uses).
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(accent ? ACCENT_GAIN : BEAT_GAIN, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_SEC);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + CLICK_SEC + 0.01);
}

/**
 * Build a clock that reports each beat to `onBeat` as a 0-based index from the start of the run
 * (so the caller derives the position in the bar itself, and a meter change never renumbers
 * history).
 */
export function createMetronomeClock(onBeat: (beatIndex: number) => void): MetronomeClock {
  let bpm = 90;
  let meter = 4;
  let running = false;
  let scheduler: ReturnType<typeof setInterval> | null = null;
  let frame: number | null = null;
  let silent: ReturnType<typeof setInterval> | null = null;

  /** Beats handed to the audio thread but not yet reached — drained by the animation frame. */
  let queue: { beat: number; at: number }[] = [];
  let nextBeat = 0;
  let nextAt = 0;

  function schedule(ctx: AudioContext): void {
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;
    // Bounded by the horizon, and `secondsPerBeat` is clamped well above zero, so this cannot spin.
    while (nextAt < horizon) {
      click(ctx, nextAt, isDownbeat(nextBeat, meter));
      queue.push({ beat: nextBeat, at: nextAt });
      nextAt += secondsPerBeat(bpm);
      nextBeat += 1;
    }
  }

  /** Light the dot when the audio clock actually reaches the beat, never when it was scheduled. */
  function drain(ctx: AudioContext): void {
    frame = requestAnimationFrame(() => {
      if (!running) return;
      const now = ctx.currentTime;
      let due = -1;
      while (queue.length > 0 && (queue[0] as { at: number }).at <= now) {
        due = (queue.shift() as { beat: number }).beat;
      }
      if (due >= 0) onBeat(due);
      drain(ctx);
    });
  }

  /** No audio available: keep the visual pulse honest and say nothing. The count lives outside so
   *  rebuilding the interval for a new tempo continues the bar instead of restarting it. */
  let silentBeat = 0;
  function startSilent(): void {
    silent = setInterval(() => onBeat(++silentBeat), secondsPerBeat(bpm) * 1000);
  }

  function clearTimers(): void {
    if (scheduler) clearInterval(scheduler);
    if (silent) clearInterval(silent);
    if (frame !== null) cancelAnimationFrame(frame);
    scheduler = silent = null;
    frame = null;
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      queue = [];
      nextBeat = 0;
      const ctx = context();
      if (!ctx) {
        silentBeat = 0;
        onBeat(0);
        startSilent();
        return;
      }
      // A context created before any gesture starts suspended; Start IS the gesture.
      void ctx.resume().catch(() => undefined);
      nextAt = ctx.currentTime + 0.06; // a beat's grace so the first click is scheduled, not rushed
      schedule(ctx);
      scheduler = setInterval(() => {
        if (running) schedule(ctx);
      }, TICK_MS);
      drain(ctx);
    },

    stop(): void {
      if (!running) return;
      running = false;
      clearTimers();
      queue = [];
      // Suspend rather than close: closing would forfeit the shared context for the whole page.
      void shared?.suspend().catch(() => undefined);
    },

    setSpec(nextBpm: number, nextMeter: number): void {
      bpm = nextBpm;
      meter = nextMeter;
      // The silent fallback's interval carries the tempo in it, so it has to be rebuilt.
      if (running && silent) {
        clearInterval(silent);
        startSilent();
      }
    },

    dispose(): void {
      running = false;
      clearTimers();
      queue = [];
      void shared?.suspend().catch(() => undefined);
    },
  };
}
