/**
 * A short two-note WebAudio chime for a completed timer (REQ8) — no bundled asset, and gracefully
 * silent when audio isn't available (autoplay policy before a gesture, SSR, jsdom in tests). The
 * visual "done" state is always the real signal; the sound is a nicety.
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

export function playTones(notes: readonly number[]): void {
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
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
    setTimeout(() => void ctx.close(), 1000); // let the notes ring out, then release the context
  } catch {
    /* audio unavailable — the visual completion state carries the signal */
  }
}
