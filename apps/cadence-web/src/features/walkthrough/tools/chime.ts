/**
 * A short two-note WebAudio chime for a completed timer (REQ8) — no bundled asset, and gracefully
 * silent when audio isn't available (autoplay policy before a gesture, SSR, jsdom in tests). The
 * visual "done" state is always the real signal; the sound is a nicety.
 *
 * ONE context for the life of the page, opened on the first tap that wants sound. A context
 * created outside a user gesture starts suspended on Safari and stays that way, and a context
 * created a minute later — when the stretch ends and nobody is touching the phone — is exactly
 * that case: the calf stretch's end chime never sounded (2026-09-06). So `unlockAudio()` runs on
 * Start, inside the gesture, and every chime after it plays through the same, already-running
 * context. Browsers also cap how many contexts a page may hold (~6), which opening one per chime
 * would have hit on any long session.
 */
export function playChime(): void {
  playTones([660, 880]);
}

/**
 * The same two-note voice, given a direction. Intervals need the ear to carry the whole message —
 * phone on the floor, three metres away — so **the chime says which way the phase went**: rising
 * for work, falling for recover, a three-note flourish for the end of the run. Same envelope and
 * same timing as the plain chime, so it is recognisably the app rather than a new sound.
 */
export const CHIME_WORK = [660, 880];
export const CHIME_RECOVER = [660, 520];
export const CHIME_DONE = [660, 880, 990];
/** Halfway through a two-sided hold: a down-and-up "turn over", unlike anything that means stop. */
export const CHIME_SWITCH = [880, 660, 880];

let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (shared) return shared;
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    shared = new Ctor();
    return shared;
  } catch {
    return null;
  }
}

/**
 * Open (or wake) the audio context from inside a user gesture, so chimes scheduled later — by a
 * timer, with no tap anywhere near them — are allowed to sound. Safe to call on every Start.
 */
export function unlockAudio(): void {
  const ctx = context();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

export function playTones(notes: readonly number[]): void {
  try {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    });
  } catch {
    /* audio unavailable — the visual completion state carries the signal */
  }
}
