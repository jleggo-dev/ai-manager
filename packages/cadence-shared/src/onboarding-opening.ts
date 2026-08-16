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
 *
 * **They are deliberately broad, and that is a trade.** An earlier draft used specifics ("Run a
 * first 10k", "The daily pages") because they read warmer — but a stranger's first screen is the
 * wrong place for them: someone who wants to swim sees four things that aren't theirs and concludes
 * the app isn't either, and "the daily pages" means nothing unless you already know the phrase.
 * Broad options are recognisable to everyone at the cost of being unplannable on their own, so the
 * coach's FIRST job after this answer is to make it concrete — see `renderPickProtocol`, which is
 * where that obligation is written down.
 */
export const OPENING_QUESTION = 'So — what would you like to work on? Pick as many as you like, or just tell me.';

/**
 * What the composer says under the opening question — and the other half of the specifics problem.
 *
 * The four options have to stay broad, because a pick composes words into the user's mouth and
 * sends them as theirs: a tappable "I have a half-marathon in July" is a lie for everyone who
 * taps it without one. But that leaves nobody shown what a genuinely useful answer looks like,
 * and "improve my fitness" is the least useful thing they could say.
 *
 * A placeholder carries the specific without asserting it. It models the standard for anyone who
 * would rather type, and costs nothing to anyone who taps instead. Only on the opening turn —
 * afterwards the coach is asking real questions and the generic prompt is right again.
 */
export const OPENING_PLACEHOLDER = 'e.g. “I have a half-marathon in July”';

export const OPENING_PICKS: CoachPicks = {
  multi: true,
  lead: "I'd like to",
  progress: 0.1,
  options: [
    { label: 'Improve my fitness', say: 'improve my fitness', area: 'movement' },
    { label: 'Eat better', say: 'eat better', area: 'nourishment' },
    { label: 'A steadier mind', say: 'build a steadier mind', area: 'mind' },
    { label: 'Build my creative muscle', say: 'build my creative muscle', area: 'practice' },
  ],
};
