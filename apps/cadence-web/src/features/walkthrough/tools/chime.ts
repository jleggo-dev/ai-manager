/**
 * A short two-note WebAudio chime for a completed timer (REQ8) — no bundled asset, and gracefully
 * silent when audio isn't available (autoplay policy before a gesture, SSR, jsdom in tests). The
 * visual "done" state is always the real signal; the sound is a nicety.
 */
export function playChime(): void {
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
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
