import type { CoachPicks } from './coach-picks.ts';

/**
 * The first turn of onboarding — written here, not generated.
 *
 * **Why this one turn is deterministic when the rest of the conversation isn't.** Every other
 * question depends on what you just said, which is the whole reason the coach owns them. The
 * first one can't: nobody has said anything yet, so it is always the same question with the same
 * options. Asking a model to produce a constant costs a network round-trip before the user has
 * done anything, a spinner on the very first screen, a failure mode on the most fragile moment in
 * the product (a cold start, possibly a cold anonymous session), and wording that drifts from the
 * design every time it runs. None of that buys anything back.
 *
 * So the client paints this instantly and the user's answer is the first thing the model ever
 * sees. `renderPickProtocol` quotes the question below so the coach knows exactly what was asked
 * and doesn't ask it again — which is why this lives in shared rather than in the web app.
 *
 * **The four options are one per `area`, in a deliberate order.** Fitness first, then nourishment,
 * mind, practice — BRAND.md's "fitness-first via example order, not taxonomy". They are examples,
 * not a taxonomy the user has to fit into, which is what "or just tell me" is doing in the copy.
 */
export const OPENING_QUESTION = 'So — what would you like to work on? Pick as many as you like, or just tell me.';

export const OPENING_PICKS: CoachPicks = {
  layout: 'list',
  multi: true,
  lead: "I'd like to",
  progress: 0.1,
  options: [
    { label: 'Run a first 10k', say: 'run a first 10k', area: 'movement' },
    { label: 'Eat better', say: 'eat better', area: 'nourishment' },
    { label: 'A steadier mind', say: 'build a steadier mind', area: 'mind' },
    { label: 'The daily pages', say: 'keep up the daily pages', area: 'practice' },
  ],
};
