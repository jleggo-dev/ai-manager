/**
 * What to say while a session is being prescribed.
 *
 * Tapping a workout can take **34 seconds** on a first open (measured 2026-08-20; PERF-08). It is
 * not slow by accident — it genuinely writes the session through the coach — and after PERF-01…05
 * took `GET /plan` from 3.8s to ~0.2s, this became the longest wait in the app by two orders of
 * magnitude, sitting on the core loop.
 *
 * The sheet showed one static line for the whole 34s: *"Chatting with your coach about this
 * session…"* — true, and after ten seconds indistinguishable from a hang. Same ruling as the photo
 * read (owner, 2026-08-21): don't hide the wait, narrate it, and be SPECIFIC, because vague copy is
 * barely better than none.
 *
 * The lines follow what is genuinely happening in order — the coach reads the plan and recent work
 * before it writes anything — so the sequence carries information rather than just motion.
 *
 * Behaviour, never the entity (BRAND.md). And the coach speaks as "I", so this is her working, not
 * a system reporting on itself.
 *
 * Reuses `readProgressLine` from the meal read. If a third of these appears, move the shared type
 * and function out to a module of their own rather than growing this pair sideways.
 */
import type { ReadProgressStep } from './meal-read-progress.ts';

/**
 * Measured at ~34s for a true first open, faster when the prefetch has partly warmed things. The
 * tail line HOLDS however long it runs — a screen that goes blank at 40s has undone the point.
 */
export const SESSION_PREP_STEPS: ReadProgressStep[] = [
  { at: 0, text: 'Opening this session…' },
  { at: 2500, text: 'Looking at where this sits in your week…' },
  { at: 8000, text: 'Reading back how the last few went…' },
  { at: 15000, text: 'Checking what you’re working with and around…' },
  { at: 23000, text: 'Writing it out for you…' },
  { at: 32000, text: 'Nearly there — putting the pieces in order…' },
];
