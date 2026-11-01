/**
 * What to say while the photo is being read.
 *
 * Two-stage photo logging costs 40–70s, and the owner's ruling is that the answer is not to hide
 * that but to narrate it (2026-08-21): *"we can provide information back to the user step by step
 * to show progress… This gives the user the perception of movement and change. Any LLM message
 * takes time; the boredom is alleviated usually by seeing the stream of reasoning."*
 *
 * So the wait has three parts, and the middle one is the real payload:
 *
 *   stage 1  rotating copy   →  THE READING ITSELF  →  stage 2 rotating copy
 *
 * Showing the model's actual words in the middle is what separates this from a spinner with better
 * manners. The user sees "assume a 250ml latte: roughly 200ml milk, 50ml espresso" and knows both
 * that something happened AND what it concluded — early enough to correct it.
 *
 * BE SPECIFIC. The owner's other ruling the same day, about the coach's tool line: *"we just say
 * something like 'looking into it'. We should say 'calling the build plan tool', 'pulling your
 * health data'."* Vague progress copy is barely better than none — "working…" tells you nothing
 * that a spinner did not. Each line here names a distinct thing that is actually happening, in the
 * order it happens, so the sequence itself carries information.
 *
 * Behaviour, not machinery (BRAND.md): "Sizing the portions" rather than "calling the vision
 * model". Same specificity, and it survives us changing what runs underneath.
 *
 * Timings are DELIBERATELY not tied to real events. There are only two real milestones in 60s, and
 * a screen that sat still between them would read as hung. These advance on a timer; the honesty is
 * that every line describes work that is genuinely part of the stage it appears in.
 */
export interface ReadProgressStep {
  /** Milliseconds after the stage begins that this line appears. */
  at: number;
  text: string;
}

/** Stage 1 — the eyes. Measured 11–35s depending on the model, so the tail line must hold. */
export const READ_PHOTO_STEPS: ReadProgressStep[] = [
  { at: 0, text: 'Sending your photo…' },
  { at: 2200, text: 'Looking at what’s on the plate…' },
  { at: 7000, text: 'Picking out the separate parts…' },
  { at: 13000, text: 'Sizing the portions against the cup and plate…' },
  { at: 21000, text: 'Working out how it was prepared…' },
  { at: 30000, text: 'Writing up what it can and can’t tell…' },
];

/**
 * Stage 2 — the coach-led read of the confirmed list (FOOD-LOGGING-COACH-LED.md, since
 * 2026-11-01): every part looked up at once, one decision, the store prices. Measured 4–14s
 * typed; the tail line holds for a slow one. Each line is a thing that genuinely happens on this
 * path, in the order it happens — nothing is added to the day until the card is confirmed.
 */
export const NUTRITION_STEPS: ReadProgressStep[] = [
  { at: 0, text: 'Looking each line up in your foods and the food databases…' },
  { at: 4000, text: 'The coach is reading what the lookups found…' },
  { at: 9000, text: 'Choosing the closest record for each line…' },
  { at: 15000, text: 'Pricing the amounts from the records…' },
  { at: 22000, text: 'Noting what was assumed and what to ask you…' },
];

/**
 * The line to show `elapsed` ms into a stage. Pure, so the caller owns the clock and this stays
 * trivially testable — a progress indicator whose correctness depends on real timers is a
 * progress indicator nobody tests.
 */
export function readProgressLine(steps: ReadProgressStep[], elapsedMs: number): string {
  let current = steps[0]?.text ?? '';
  for (const s of steps) {
    if (elapsedMs >= s.at) current = s.text;
    else break;
  }
  return current;
}
