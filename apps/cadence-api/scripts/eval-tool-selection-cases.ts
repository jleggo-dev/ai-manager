/**
 * The golden set for the tool-selection eval — 44 turns, every one of them sourced from something
 * that actually happened. See `eval-tool-selection.ts` for how they are run and scored.
 *
 * THE VOICE IS THE POINT. Every turn here is lowercase, hedged, half-punctuated and often about
 * two things at once, because that is how the owner writes to her and spec-shaped prompts test a
 * user who does not exist. Several are verbatim from PLAN.md; the rest are the same shape with the
 * details changed to fit the seeded world.
 *
 * THREE LABELS PER CASE, and the distinction between them is the whole design:
 *   - `expect`  must be called. An absence is a miss (recall).
 *   - `allow`   may be called without penalty — the tool descriptions themselves tell her to read
 *               get_active_plan before proposing a change, so counting that as a false positive
 *               would be scoring her for following instructions.
 *   - `forbid`  must NOT be called even when `expect` is satisfied. This is where the tiebreak
 *               pairs live (`lookup_food` vs `get_recipes`) and where the rulings live
 *               ("never on your own read that a goal looks too hard").
 *
 * WHY SO FEW READS ARE `expect`ED. Eight of the eighteen reads describe how to fetch facts the
 * dossier already injected as text, and `turn-context` prefetches more per turn. When she does not
 * call `get_constraints` it is usually because she already has them — correct behaviour that a
 * naive golden set would score as a miss. So the dossier reads are `allow`, and only the long-tail
 * reads nothing injects (`get_journal`, `get_recipes`, `lookup_food`, `get_food_log`,
 * `get_practice_totals`, `get_workout_history`) carry a hard expectation. HARNESS-V2.md calls
 * these Layer 0 and Layer 2; this file is the first thing that measures the difference.
 *
 * WHAT A CASE CANNOT SAY. Each case is a FIRST turn in a fresh conversation, so nothing here can
 * reproduce the failures that need a history — "can you change the plan? like in the app?" was
 * only wrong because he had named the change two turns earlier. Those are real and they are not
 * in this set; see the runner's header.
 */

/** A silence case declares no expectation; `expect: []` is the whole assertion. */
export interface EvalCase {
  id: string;
  /** How to read a failure: an action miss is the headline bug; a read miss may be a prefetch. */
  kind: 'action' | 'read' | 'silence' | 'canary';
  /** The user's words, exactly as they would be typed into the composer. */
  turn: string;
  expect: string[];
  allow?: string[];
  forbid?: string[];
  /** Optional argument assertion, run only if the named tool was called. Returns a problem or null. */
  args?: { tool: string; check: (a: Record<string, unknown>) => string | null };
  /** Where this came from. A case with no provenance does not belong in this file. */
  from: string;
}

/** Reads the dossier already carries — never penalised as a false trigger anywhere. */
import { alwaysOnToolNames, onDemandToolNames } from '../src/services/coach-tool-tiers.ts';

const DOSSIER_READS = [
  'get_identity',
  'get_objectives',
  'get_active_plan',
  'get_consistency',
  'get_constraints',
  'get_weight',
  'get_equipment',
  'get_dietary_profile',
  'get_health_history',
];

const str = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

/* ══ A · ACTIONS — the half that cannot be prefetched, and the half that keeps failing ═══════ */

const ACTIONS: EvalCase[] = [
  {
    id: 'A1',
    kind: 'action',
    turn: "let's start by changing the farmer carries to dead hangs",
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'get_workout_history'],
    from: 'PLAN.md:5994 (2026-08-16, #216) — verbatim. She gave coaching advice and no tool call.',
  },
  {
    id: 'A2',
    kind: 'action',
    turn: 'can you move the easy run off thursday, thursdays are dead for me now. friday would work',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS, 'get_recent_logs'],
    from: 'PLAN.md:5385 (2026-08-14, #201) — the "articulate and powerless" seam, move edit.',
  },
  {
    id: 'A3',
    kind: 'action',
    turn: 'the long run has to be shorter. an hour max, my sundays are not what they were',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS, 'get_recent_logs'],
    from: 'PLAN.md:5385 (2026-08-14, #201) — resize edit, in the voice of someone apologising for it.',
  },
  {
    id: 'A4',
    kind: 'action',
    turn: "drop the grip finisher. i'm never going to do it and it just sits there mocking me",
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS],
    from: 'PLAN.md:5385 (2026-08-14, #201) — remove edit.',
  },
  {
    id: 'A5',
    kind: 'action',
    turn: 'the 100 books thing is not happening this year lol. can we make it 50',
    expect: ['update_goal'],
    allow: [...DOSSIER_READS, 'get_goal_progress'],
    args: {
      tool: 'update_goal',
      check: (a) => (str(a.action) === 'retarget' ? null : `action was "${String(a.action)}", expected retarget`),
    },
    from: 'PLAN.md:5417 (2026-08-14, #202) — the goal seam; retarget is its worked example.',
  },
  {
    id: 'A6',
    kind: 'action',
    turn: "push the 10k out to november please. october was always optimistic and i'm behind",
    expect: ['update_goal'],
    allow: [...DOSSIER_READS, 'get_goal_progress'],
    args: {
      tool: 'update_goal',
      check: (a) => (str(a.action) === 'redate' ? null : `action was "${String(a.action)}", expected redate`),
    },
    from: 'PLAN.md:5417 (2026-08-14, #202) — redate.',
  },
  {
    id: 'A7',
    kind: 'action',
    turn: 'that last run was good but i had a really hard time keeping my hr in zone 2. 77 minutes in the end',
    expect: ['log_session'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'get_workout_history'],
    // The whole SUBJECT is wrong here, not the view — so the facade is forbidden outright rather
    // than by argument. `log_meal`/`preview_meal` join it (MP21/MP40, 2026-08-28): the classifier
    // that priced this run as a meal is gone, and this is the turn that proves its replacement
    // does not repeat it.
    forbid: ['get_nutrition', 'log_meal', 'preview_meal'],
    from: 'PLAN.md:5771 (2026-08-15, #212) — verbatim. The food classifier priced this run as a meal; and PLAN.md:5849 (#214), talking about a session IS logging it.',
  },
  {
    id: 'A8',
    kind: 'action',
    turn: "i didn't actually run sunday. don't know why it says i did",
    expect: ['correct_log'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'get_workout_history'],
    args: {
      tool: 'correct_log',
      check: (a) => (a.not_done === true ? null : 'not_done was not set on a session that did not happen'),
    },
    from: 'PLAN.md:5511 (2026-08-14, #202) — the not-done branch, which must not invent a missed session.',
  },
  {
    id: 'A9',
    kind: 'action',
    turn: 'the easy run on tuesday was 7k not 5, i misread the watch',
    expect: ['correct_log'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'get_workout_history'],
    from: 'PLAN.md:5417 (2026-08-14, #202) — "fixing a log", the metrics branch.',
  },
  {
    id: 'A10',
    kind: 'action',
    turn: "my knee's honestly fine now. hasn't bothered me in months, i'm good for hills again",
    expect: ['update_constraint'],
    allow: [...DOSSIER_READS],
    args: {
      tool: 'update_constraint',
      check: (a) =>
        str(a.action) === 'lift'
          ? null
          : `action was "${String(a.action)}" — recovering is a lift, never a remove (owner ruling)`,
    },
    from: 'PLAN.md:5495 (2026-08-14, #204) — "an injury can be latent or recovered from"; only an explicit mis-capture deletes.',
  },
  {
    id: 'A11',
    kind: 'action',
    turn: "hang on, i've never had a knee injury. i don't know where you got that from",
    expect: ['update_constraint'],
    allow: [...DOSSIER_READS],
    args: {
      tool: 'update_constraint',
      check: (a) =>
        str(a.action) === 'remove' ? null : `action was "${String(a.action)}" — a mis-capture is erased, not lifted`,
    },
    from: 'PLAN.md:5497 (2026-08-14, #204) — the other side of the same ruling, and the reason they are two actions.',
  },
  {
    id: 'A12',
    kind: 'action',
    turn: "i've dropped 1.1kg this week on the 2200 and that feels like too much too fast. can we go up a bit",
    expect: ['set_macro_targets'],
    allow: [...DOSSIER_READS, 'get_nutrition'],
    from: 'PLAN.md:5730 (2026-08-15, #215) — adjusting the numbers when the evidence says they are not working IS the coaching.',
  },
  {
    id: 'A13',
    kind: 'action',
    turn: "starting monday i'm on nights for six weeks. mornings are gone",
    expect: ['update_constraint'],
    allow: [...DOSSIER_READS, 'propose_plan_change'],
    args: {
      tool: 'update_constraint',
      check: (a) => (str(a.action) === 'add' ? null : `action was "${String(a.action)}", expected add`),
    },
    from: 'PLAN.md:5495 (2026-08-14, #204) — a life constraint, which the description names alongside the physical ones.',
  },
  {
    /**
     * The refusal-by-reassurance (owner, 2026-08-19) — the failure this whole eval exists for, and
     * the one a "did she pick the right tool?" score cannot see, because she picked NO tool and
     * sounded lovely doing it.
     *
     * He asked twice. "Okay but I need you to adjust the plan" got "sure, what would you like
     * changed?"; naming it got *"That's an easy one, and actually nothing needs editing — today's
     * sessions just don't happen... No penalty, no plan change needed for a single rough day."*
     * Every word of that is on-brand (a missed day is information, not failure) and it is still a
     * wall: he asked her to move something, and she decided on his behalf that the answer was no.
     */
    id: 'A16',
    kind: 'action',
    turn: "this week's been a write-off honestly. cut the grip finisher and the long run — keep the morning sit",
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS, 'get_recent_logs'],
    from: 'Owner transcript 2026-08-19 12:12, adapted to the seeded world. His words were "cut out everything expcept piano and meal tracking"; pasted verbatim the case tested nothing, because this world has no piano and no overloaded day, and she correctly asked what he meant ("today\'s actually a pretty light day already"). What survives is the shape that produced the failure: a rough stretch named as the reason, specific commitments named for removal, and a coach whose brand voice tempts her to reassure instead of act.',
  },
  /**
   * A14 and A15 lived in SILENCE, both `expect: []`, from MP34 (2026-08-28) until now. `log_nutrition`
   * had been withdrawn 2026-08-19 and nothing had replaced it, so calling nothing was briefly the
   * correct answer and a hallucinated logging call still failed the case. MP21/MP40 (2026-08-28,
   * this parcel) is the tool that was missing — moved back here, `expect` flipped to name it, exactly
   * as the note left on both said to do.
   */
  {
    id: 'A14',
    kind: 'action',
    turn: 'just got back from the easy run, downed a big bottle of water, maybe 750ml. felt good out there',
    expect: ['log_session'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'log_meal'],
    args: {
      tool: 'log_session',
      check: (a) =>
        /run/i.test(str(a.session)) ? null : `session "${String(a.session)}" is not the run she was told about`,
    },
    /**
     * RETARGETED 2026-08-29, after failing twice and being wrong on BOTH counts.
     *
     * It expected `log_meal` for 750 ml of water. But water has its own path
     * (`POST /nutrition/water` — "one pour, ml") that no coach tool reaches, and the owner ruled the
     * same day that it should stay that way: *"I don't think water needs its own tool… logging water
     * is a sub-tool of logging nutrition; it probably shouldn't be separate,"* and *"logging water is
     * really not so important."* The case was asking her to put a zero-calorie "meal" in the food
     * diary instead of a pour in the water row; declining was the better judgement, scored as a miss.
     *
     * The turn ALSO said "the ride" — and this account's plan has no ride (see `ACTIVITIES`: Easy
     * run, Long run, Grip finisher, Morning sit). `log_session` resolves the named session against
     * the plan and answers "No session clearly matches" for anything else, so even the session read
     * of this turn could not have passed. Retargeting without changing the turn would have rebuilt
     * the same defect one tool over.
     *
     * So the turn now names a session that exists, and the case tests something A7 does not: A7 is a
     * data-rich report ("77 minutes", HR detail) where the session is the whole turn. Here the most
     * concrete number in the sentence — 750ml — points at nutrition, and the session is the vaguer
     * half. It asks whether a nutrition distractor pulls her off the thing worth logging. `log_meal`
     * stays in `allow`: folding the water in is defensible, just not required.
     *
     * NOTE for anyone editing a case: a turn that names a session must name one the fixture seeds.
     * That coupling is invisible from this file and has now cost this case two runs.
     */
    from:
      'Owner directive 2026-08-19 — nutrition as a callable tool; water is the case the confirm sheet never ' +
      'caught. Reopened 2026-08-28 (MP34) as silence when log_nutrition turned out to be gone; reopened again ' +
      'when log_meal shipped. Retargeted to log_session 2026-08-29 (owner: water is not its own tool and not ' +
      'important). Turn edited to name a seeded session — "the ride" was never in this plan, so the case ' +
      'could not have passed either way. Now tests session-vs-nutrition pull; A7 covers the data-rich report.',
  },
  {
    id: 'A15',
    kind: 'action',
    turn: 'oh and i never logged lunch — had leftover chili around noon, decent bowl of it',
    expect: ['log_meal'],
    allow: [...DOSSIER_READS, 'get_nutrition'],
    args: {
      tool: 'log_meal',
      check: (a) => (/chili/i.test(str(a.text)) ? null : `text "${String(a.text)}" did not carry "chili"`),
    },
    from:
      'Owner directive 2026-08-19 — the remembered-meal case: food arriving sideways, hours after the fact, ' +
      'exactly what "just tell Cadence in chat that they ate it and it gets logged" (PLAN.md, "Meal prep, end ' +
      'to end") describes. Reopened 2026-08-28 (MP34) as silence when log_nutrition turned out to be gone; ' +
      'reopened again now that log_meal exists to call. No explicit date: "around noon" today means omit it.',
  },
  /**
   * A17 and A18 are the two halves of `update_repertoire` (owner ruling 2026-08-30): handed a
   * list of known material she must STORE it, and a piece finished in front of her is a milestone
   * she records. Both are adapted from the 2026-08-29 piano session (ai-admin chat 773f61a1) to
   * guitar, because this seeded world has no piano goal (the A16 lesson) and the tool records
   * goal-free by design — what someone knows outlives any one goal.
   */
  {
    id: 'A17',
    kind: 'action',
    turn: "oh and for my guitar practice — i've got wonderwall, blackbird and horse with no name down solid, those are good ones to rotate through",
    expect: ['update_repertoire'],
    allow: [...DOSSIER_READS, 'get_repertoire', 'propose_plan_change'],
    args: {
      tool: 'update_repertoire',
      check: (a) => {
        const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : [];
        if (items.length < 3) return `only ${items.length} items recorded of the three named`;
        // "down solid" is backfill, not news — 'learned' here would invent three accomplishments
        // dated today and inflate the recap, the exact cheer the brand bans.
        const learned = items.filter((i) => str(i.status) === 'learned');
        return learned.length ? `backfilled pieces marked "learned": ${learned.length}` : null;
      },
    },
    from:
      'Session 773f61a1 (2026-08-29): "Can you select from the pieces I already know?" forced the user to ' +
      'type nine pieces, and the list froze into one how_to sentence — nothing stored, nothing to read back. ' +
      'Owner ruling 2026-08-30: "in the conversation i gave it, she should know she has to store it."',
  },
  {
    id: 'A18',
    kind: 'action',
    turn: "finally played blackbird start to finish clean today. that one's officially in the bag",
    expect: ['update_repertoire'],
    allow: [...DOSSIER_READS, 'log_session', 'get_repertoire'],
    args: {
      tool: 'update_repertoire',
      check: (a) => {
        const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : [];
        const hit = items.find((i) => /blackbird/i.test(str(i.label)));
        if (!hit) return 'no item named blackbird';
        return str(hit.status) === 'learned'
          ? null
          : `status was "${String(hit.status)}", wanted learned — it crossed the line just now`;
      },
    },
    from:
      'Owner ruling 2026-08-30: "Coach should record and remember as I complete milestones (of course!)" — ' +
      "the crossing is the moment worth an accomplishment in the goal history, unlike A17's quiet backfill.",
  },
];

/* ══ B · LONG-TAIL READS — the ones nothing injects, so a miss is genuinely a miss ═══════════ */

const READS: EvalCase[] = [
  {
    id: 'B1',
    kind: 'read',
    turn: "what have i been writing about lately? i genuinely can't remember what i put down last week",
    expect: ['get_journal'],
    allow: [...DOSSIER_READS, 'get_practice_totals'],
    from: 'PLAN.md:5301 (2026-08-14, #198) — get_journal existed in the registry and was never wired in.',
  },
  {
    id: 'B2',
    kind: 'read',
    turn: "what have i got saved that uses chicken thighs, i've got a pack to use up",
    expect: ['get_nutrition'],
    allow: [...DOSSIER_READS],
    args: {
      tool: 'get_nutrition',
      check: (a) => (a.view === 'recipes' ? null : `view was ${JSON.stringify(a.view)}, wanted "recipes"`),
    },
    from: 'PLAN.md:5347 (2026-08-14, #199) — the food quartet tiebreak: their dishes, not facts about one food. Rewritten 2026-08-29: the facade collapsed the quartet into get_nutrition, so the tiebreak this case exists to test now lives in the `view` argument, not the tool name.',
  },
  {
    id: 'B3',
    kind: 'read',
    turn: 'how much protein is in 100g of halloumi',
    expect: ['get_nutrition'],
    allow: [...DOSSIER_READS],
    args: {
      tool: 'get_nutrition',
      check: (a) =>
        a.view !== 'lookup'
          ? `view was ${JSON.stringify(a.view)}, wanted "lookup"`
          : typeof a.q === 'string' && a.q.trim()
            ? null
            : 'lookup without a q is nothing — the food was never named',
    },
    from: 'PLAN.md:5312 (2026-08-14, #198) — lookup_food is nothing without its query; the other side of the quartet. Rewritten 2026-08-29: the facade collapsed the quartet into get_nutrition, so the tiebreak this case exists to test now lives in the `view` argument, not the tool name.',
  },
  {
    id: 'B4',
    kind: 'read',
    turn: 'what did i actually eat yesterday, i completely lost track by the evening',
    expect: ['get_nutrition'],
    allow: [...DOSSIER_READS],
    args: {
      tool: 'get_nutrition',
      check: (a) => (a.view === 'log' ? null : `view was ${JSON.stringify(a.view)}, wanted "log"`),
    },
    from: 'PLAN.md:5301 (2026-08-14, #198) — she could be asked about your eating and had no way to look at it.',
  },
  {
    id: 'B5',
    kind: 'read',
    turn: 'how many words have i actually written this month? feels like nothing',
    expect: ['get_practice_totals'],
    allow: [...DOSSIER_READS, 'get_goal_progress', 'get_recent_logs'],
    from: 'PLAN.md:5296 (2026-08-14, #198) — the mind-pillar totals the owner asked for by name.',
  },
  {
    id: 'B6',
    kind: 'read',
    turn: "what's my longest run in the last month? not the average, the actual longest",
    expect: ['get_workout_history'],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'get_goal_progress'],
    /**
     * MADE ANSWERABLE 2026-08-29. It failed twice, and both times she was right.
     *
     * `cadence.workout_history` was never seeded, so `get_workout_history` could only return an
     * empty list — the tool this case demands had nothing in it. Meanwhile the Broker prefetched
     * `get_recent_logs`, which held the answer, and she used it: *"Your longest run in the last
     * month was that long run on August 23 — 11.4 km in 77 minutes. Nothing since has topped it."*
     * Correct, specific, and explicitly not an average, which is the exact failure this case was
     * written for. It was scored a miss anyway.
     *
     * The fixture now seeds device runs (`eval-tool-selection-world.ts`), and the longest — 13.2 km
     * — was never logged by hand. So the prefetched reports top out at 11.4 km and answering from
     * them is wrong BY A NUMBER, while `get_workout_history` has the real one. The case tests the
     * line the tool descriptions draw ("device records vs their own words", pinned by
     * `description-audit.test.ts`) instead of asking for a tool that returns nothing.
     */
    from:
      'PLAN.md:871 (2026-08-11) — "where did that number come from?" She quoted a 90-day mean as current form. ' +
      'Made answerable 2026-08-29: the device table was empty, so the expected tool could not answer and she ' +
      'correctly used the prefetched reports instead; the fixture now carries an unlogged 13.2 km run.',
  },
  {
    id: 'B7',
    kind: 'read',
    turn: "remind me how last week's long run went — what i said about it, not the numbers",
    expect: ['get_recent_logs'],
    allow: [...DOSSIER_READS, 'get_workout_history'],
    from: 'PLAN.md:5347 (2026-08-14, #199) — the history trio tiebreak: their own words, not the device record.',
  },
  {
    id: 'B8',
    kind: 'read',
    turn: 'how many of my sessions did i actually make in the last two weeks',
    expect: ['get_consistency'],
    allow: [...DOSSIER_READS, 'get_goal_progress', 'get_recent_logs'],
    args: {
      tool: 'get_consistency',
      check: (a) =>
        Number(a.days) === 14 ? null : `days=${String(a.days ?? '(omitted)')} for a turn that said "two weeks"`,
    },
    from: 'PLAN.md:4022 (2026-07) — the standing nit: the window in the words does not reach the call.',
  },
  {
    id: 'B9',
    kind: 'read',
    turn: 'thinking about breakfast — roughly how many calories in two eggs, toast and half an avocado?',
    expect: ['preview_meal'],
    allow: [...DOSSIER_READS, 'get_nutrition', 'check_food_sources'],
    forbid: ['log_meal'],
    from:
      'MP21/MP40 (2026-08-28) — a hypothetical, not a meal yet: "thinking about" is the tell. preview_meal ' +
      'prices it without writing anything down; log_meal here would invent a meal nobody has eaten.',
  },
  {
    id: 'B10',
    kind: 'read',
    turn: 'can you look up the wild mushroom co mixed dried mushrooms — i cannot find their nutrition panel anywhere online and want the real numbers off it, not a guess',
    expect: ['research_food'],
    allow: [...DOSSIER_READS, 'get_nutrition', 'check_food_sources'],
    from:
      'MP27 (2026-08-28), PLAN.md "Meal prep, end to end" — the scenario\'s own line, verbatim in spirit. A ' +
      'named vendor, an explicit "I could not find it", worth the wait for the exact numbers.',
  },
  {
    id: 'B11',
    kind: 'read',
    turn: "what should i work on in tonight's practice — something i already know, or push the new stuff?",
    expect: ['get_repertoire'],
    allow: [...DOSSIER_READS, 'get_practice_totals', 'get_recent_logs'],
    // Asking what to practice changes nothing about what they know — writing here would be the
    // false-trigger half of update_repertoire's contract.
    forbid: ['update_repertoire'],
    from:
      'Session 773f61a1 (2026-08-29) — the read the whole conversation was missing: she had to ask the user ' +
      'to type what he knew because nothing could read it back. With the store live, "what do i know" turns ' +
      'are reads, and only new facts about what they know are writes.',
  },
];

/* ══ C · SILENCE — a set of only positive cases measures recall and ignores false triggering ══ */

const SILENCE: EvalCase[] = [
  {
    id: 'C1',
    kind: 'silence',
    turn: "thanks, that's helpful",
    expect: [],
    from: 'PLAN.md:4021 — the baseline no-retrieval turn.',
  },
  {
    id: 'C2',
    kind: 'silence',
    turn: 'i had to skip it',
    expect: [],
    allow: [...DOSSIER_READS, 'get_recent_logs', 'correct_log'],
    // log_meal (MP21/MP40, 2026-08-28) is the tool this turn used to be about: it read as food
    // ("skip it" → "a Spartan Beast, for breakfast") and there is nothing here to log — no food
    // word, no first-person "had", nothing eaten. A model reaching for log_meal or preview_meal on
    // a bare training-skip is the exact failure this case exists to catch.
    forbid: ['get_nutrition', 'log_meal', 'preview_meal'],
    from: 'PLAN.md:5783 (2026-08-15) — verbatim. This logged a ~2000 kcal Spartan Beast for breakfast.',
  },
  {
    id: 'C3',
    kind: 'silence',
    turn: "what's the actual point of zone 2? everyone bangs on about it and i don't get it",
    expect: [],
    allow: [...DOSSIER_READS],
    from: 'A general-knowledge question about training; her own file has no bearing on the answer.',
  },
  {
    id: 'C4',
    kind: 'silence',
    turn: "i'm just tired today honestly. not sure i want to talk about training",
    expect: [],
    allow: [...DOSSIER_READS],
    // log_meal (MP21/MP40, 2026-08-28) joins the forbid list for the same reason as C2 — see the
    // note there. Nothing here is food, tired is not a meal, and a data-entry reflex is precisely
    // the voice failure this case exists to catch.
    forbid: ['propose_plan_change', 'update_goal', 'update_constraint', 'log_session', 'log_meal'],
    from: 'PLAN.md:658 (2026-08-10) — the voice failure. A hard day is not a data-entry event.',
  },
  {
    id: 'C5',
    kind: 'silence',
    turn: 'yes',
    expect: [],
    allow: [...DOSSIER_READS],
    from: 'PLAN.md:4713 — a bare yes with nothing in front of it captures nothing, by design.',
  },
  {
    id: 'C6',
    kind: 'silence',
    turn: 'do you reckon i should be doing more strength stuff in general?',
    expect: [],
    allow: [...DOSSIER_READS, 'get_goal_progress', 'get_recent_logs', 'get_workout_history'],
    forbid: ['propose_plan_change'],
    from: 'PLAN.md:5408 (2026-08-14, #201) — a question about the plan is not an instruction to change it.',
  },
  {
    id: 'C7',
    kind: 'silence',
    turn: 'the 10k feels way too hard right now, i keep thinking about it',
    expect: [],
    allow: [...DOSSIER_READS, 'get_goal_progress'],
    forbid: ['update_goal'],
    from: 'coach-actions.ts:178 — "never on your own read that a goal looks too hard, and never to tidy up".',
  },
  {
    id: 'C8',
    kind: 'silence',
    turn: 'can you change something about my plan',
    expect: [],
    allow: [...DOSSIER_READS],
    forbid: ['propose_plan_change'],
    from: 'PLAN.md:5408 (2026-08-14, #201) — "ambiguity is a rejection, never a coin flip".',
  },
  {
    id: 'C9',
    kind: 'silence',
    turn: 'what can you actually do for me? like what are you for',
    expect: [],
    allow: [...DOSSIER_READS],
    forbid: ['propose_plan_change', 'update_goal', 'update_constraint', 'log_session', 'set_macro_targets'],
    from: 'PLAN.md:6022 (2026-08-16, #216) — the inverse of the headline bug. Here reciting the manifest is the right answer.',
  },
  {
    id: 'C10',
    kind: 'silence',
    turn: 'morning',
    expect: [],
    allow: [...DOSSIER_READS],
    from: 'The cheapest possible turn — and the one where a 5,000-token tool preamble buys nothing.',
  },
  /**
   * C11–C16 (MP21/MP40, 2026-08-28) — restraint cases for the food write surface, added alongside
   * A14/A15's restoration and deliberately outnumbering it. The deleted `NOT_FOOD_CONTEXT` veto and
   * the `log_food` regex were crude protection against exactly this failure shape: logging
   * something the person was only thinking about, asking about, or mentioning in passing. Removing
   * them puts the burden on her judgement, so these are what stand in for that protection now — the
   * failure that matters here is not a missed meal (she would be asked again) but an invented one.
   */
  {
    id: 'C11',
    kind: 'silence',
    turn: "i'm thinking about trying that mushroom sauce recipe this weekend, pork chops with a creamy sauce",
    expect: [],
    allow: [...DOSSIER_READS, 'get_nutrition'],
    forbid: ['log_meal', 'preview_meal'],
    from:
      'A recipe someone MIGHT cook, not one they made — no ingredients, no quantities, plainly future tense. ' +
      'log_meal here would invent a meal that has not happened; preview_meal has nothing to price either.',
  },
  {
    id: 'C12',
    kind: 'silence',
    turn: "what should i actually have for dinner tonight, i want something high protein but i'm bored of chicken",
    expect: [],
    allow: [...DOSSIER_READS, 'get_nutrition'],
    forbid: ['log_meal', 'preview_meal'],
    from:
      'Asking WHAT to eat, not reporting what she ate — advice-seeking with no food named yet to parse or ' +
      'price. The correct response is a suggestion, not a tool call that assumes the meal already happened.',
  },
  {
    id: 'C13',
    kind: 'silence',
    turn: "i've been so wiped this week, barely touching my lunch most days if i'm honest. is that something i should be worried about?",
    expect: [],
    allow: [...DOSSIER_READS, 'get_nutrition', 'get_recent_logs'],
    forbid: ['log_meal', 'preview_meal'],
    from:
      'A past meal mentioned in service of a wellness question, not a log request — "barely touching my ' +
      'lunch" has no amount, no day, and is not why she is talking. The question is about energy, and ' +
      'get_food_log (not a write) is the reasonable way to check the pattern behind it.',
  },
  {
    id: 'C14',
    kind: 'silence',
    turn: "what's the protein in a quest bar, the cookies and cream one",
    expect: [],
    allow: [...DOSSIER_READS, 'get_nutrition', 'check_food_sources'],
    forbid: ['research_food'],
    from:
      'MP27 restraint: a common, widely-sold product a shared database almost certainly already carries. ' +
      'research_food is slow and billed for exactly the cases the free sources cannot cover — reaching for ' +
      'it before trying lookup_food or check_food_sources is the failure its description exists to prevent.',
  },
  /**
   * C15/C16 (PR #289 review) — the "someone else had it" family, missing from the first pass of
   * restraint cases even though it is the single best-documented false positive in this file's
   * history. `SOMEONE_ELSE_HAD` (coach-food-classify.ts, deleted with the rest of the log_food
   * regex under MP21/MP40) existed for exactly this: "we" and "I" log, everyone else does not,
   * whatever the object turns out to be — which is why it was the one guard that caught the
   * sentence no noun list ever could. Removing the regex means these two are what test whether a
   * model really does read "had" correctly, which is the whole argument for deleting it.
   */
  {
    id: 'C15',
    kind: 'silence',
    turn: "my son's okay now, he just had a bead stuck in his ear earlier, gave us a bit of a scare",
    expect: [],
    allow: [...DOSSIER_READS],
    forbid: ['log_meal', 'preview_meal'],
    from:
      'Owner, 2026-08-19, verbatim in spirit — the exact sentence that broke the old noun-list guard: ' +
      '"My son is okay he just had a bead stuck in his ear. I can still log my meals." The prior system ' +
      'read it as a meal and injected FOOD_CONFIRM_CONTEXT on the very turn he asked to clean up his plan. ' +
      'Third person, "had" doing ordinary English work, no food anywhere in the sentence — the easier half ' +
      'of the family, since neither "bead" nor "ear" is food-shaped at all.',
  },
  {
    id: 'C16',
    kind: 'silence',
    turn: 'my wife had the salmon at that new place last night and said it was incredible, might have to go back',
    expect: [],
    allow: [...DOSSIER_READS, 'get_nutrition'],
    forbid: ['log_meal', 'preview_meal'],
    from:
      'The harder half of the same family (PR #289 review): real food this time, so the tell is entirely ' +
      '"my wife had", not the object. log_meal could price "salmon" correctly without any trouble and would ' +
      'still be wrong to write it to his day — a model that reads for whose meal this is, not just whether ' +
      'the sentence contains food, is what this case actually checks.',
  },
];

/* ══ D · CANARIES — the grader on trial before the model is ══════════════════════════════════ */

/**
 * Anthropic's caution, made operational: a bad score is a suspect grader until proven otherwise
 * (CORE-Bench went 42% → 95% on grader fixes alone). These two cases are not about the coach.
 *
 * TWO REJECTED CANARIES, kept here because each one taught something and the next person will
 * reach for the same wrong idea:
 *
 *   1. `"use your get_identity tool right now"` — missed on the first live run and suppressed the
 *      whole report. Her name was already in the turn: the Broker's prefetch floor injects
 *      `get_identity, get_constraints, get_active_plan` on EVERY turn, so "you already have this"
 *      was the only sane reading. A canary a prefetch can satisfy cannot tell an instrument fault
 *      from correct behaviour, which is its one job.
 *   2. `"use your update_goal tool to mark 'Read 100 books this year' complete"` — an action, so
 *      prefetch-proof, and it missed too. Twice is a pattern, and the pattern is the persona: to
 *      the user there is only the coach, never the machinery (BRAND.md), so a turn that orders her
 *      by tool name is asking her to break the one rule she is most consistently held to. She also
 *      had every reason to doubt it — the seeded goal has nothing logged against it, and "I
 *      finished 100 books" from someone with zero on file deserves a question, not a write.
 *
 * SO A CANARY MUST NOT NAME A TOOL. It has to be the most ordinary, most decided, least
 * ambiguous thing a person can say — the shape that already fires in the wild. This one is A1's
 * shape with the doubt removed: a named commitment, a named day, nothing to interpret.
 *
 * And the gate no longer rests on this single case (see `graderVerdict`): one case missing is a
 * data point, whereas a run that observed NO function call anywhere while expecting several is an
 * instrument fault. That is the signature worth halting on.
 *
 * `CAN-NEG` is the reverse: nothing to look up and an explicit instruction to say one word. A tool
 * call here is a real (if strange) model behaviour rather than an instrument fault, so it is
 * reported loudly and does not suppress the run.
 */
const CANARIES: EvalCase[] = [
  {
    id: 'CAN-POS',
    kind: 'canary',
    turn: 'move my long run from sunday to saturday, sundays are gone for the next while',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER_READS, 'get_recent_logs'],
    from: 'Instrument check: the plainest possible action request, in the shape A1 already fires on.',
  },
  {
    id: 'CAN-NEG',
    kind: 'canary',
    turn: 'reply with the single word ok and nothing else',
    expect: [],
    from: 'Instrument check, the other way: nothing to look up and an explicit instruction not to elaborate.',
  },
];

export const CASES: EvalCase[] = [...CANARIES, ...ACTIONS, ...READS, ...SILENCE];

/**
 * The seven that change the user's data. Load-bearing for scoring, not decoration: a READ she did
 * not call may have been handed to her by the Broker's prefetch and the run credits that, whereas
 * an action has no second path — nothing but the call can satisfy it.
 *
 * `log_meal` joined 2026-08-28 (MP21/MP40) — the tool that used to not exist, which is why A14/A15
 * spent a stretch as silence cases. `preview_meal` and `research_food` are reads and belong in
 * `KNOWN_TOOLS` below, not here.
 */
export const ACTION_TOOLS = new Set([
  'propose_plan_change',
  'update_goal',
  'update_constraint',
  'log_session',
  'correct_log',
  'set_macro_targets',
  'log_meal',
  'update_repertoire',
]);

/**
 * The set a call must belong to; anything else the model emits is an invented tool.
 *
 * DERIVED FROM THE LIVE HARNESS, not hand-listed — because a hand-listed copy rotted, and the rot
 * was invisible in a way that inverted the result. On 2026-08-29 this set still named four tools
 * the harness had HIDDEN behind the `get_nutrition` facade (`lookup_food`, `get_food_log`,
 * `get_recipes`, `get_macro_targets`) and knew nothing of nine it exposes — `get_nutrition`,
 * `find_tools` and `use_tool` among them. So the run reported "invented tool names: find_tools,
 * get_nutrition, use_tool", all three of which are real, live, correct tools, and scored a case
 * that expected `lookup_food` as BOTH a miss and a hallucination when the coach did the right
 * thing. A miscalibrated instrument does not just add noise; it points the wrong way, and anyone
 * tuning against it would have tuned toward tools that no longer exist.
 *
 * `DOSSIER_READS` stays explicit: those are Broker prefetches, carried in the pack rather than
 * declared to the model, so they are not in either harness list.
 */
export const KNOWN_TOOLS = new Set([...DOSSIER_READS, ...alwaysOnToolNames(), ...onDemandToolNames()]);

/**
 * Not ours, not the model's, and not a hallucination — Devs.ai v2 emits a `suggested_actions`
 * function_call of its own on most responses as a UI affordance (see the note in
 * `backend/test/e2e-devs-ai-v2-tools.test.ts`, which had to learn the same lesson). The coach's
 * tool loop already ignores it because it filters on `coachToolNames()`; this set is how the eval
 * ignores it too. The first live run counted it as an invented tool on four of five action cases
 * and scored the model down for the provider's UI hint.
 *
 * Kept as a named set rather than dropped silently: a NEW built-in appearing here should show up
 * in the report as provider noise, not vanish.
 */
export const PROVIDER_BUILTINS = new Set(['suggested_actions']);

/**
 * The discovery path, which is plumbing rather than a selection.
 *
 * Most tools are on-demand — absent from the always-on list, reachable only by looking them up
 * with `find_tools` and invoking them. Counting that step as an unasked-for call penalised correct
 * behaviour on every on-demand tool: B1 called `find_tools` then `get_journal` (precisely the
 * designed path) and was failed on precision for it. Never counted as `extra`; a case that really
 * does want to assert she did not go looking can name them in `forbid`, which is checked first.
 */
export const META_TOOLS = ['find_tools', 'use_tool'] as const;
