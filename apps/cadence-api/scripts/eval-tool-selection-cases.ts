/**
 * The golden set for the tool-selection eval — 35 turns, every one of them sourced from something
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
    forbid: ['lookup_food', 'get_food_log'],
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
    allow: [...DOSSIER_READS, 'get_macro_targets', 'get_food_log'],
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
    id: 'A14',
    kind: 'action',
    turn: 'just got back from the ride, downed a big bottle of water, maybe 750ml. felt good out there',
    expect: ['log_nutrition'],
    allow: [...DOSSIER_READS, 'log_session', 'get_recent_logs'],
    args: {
      tool: 'log_nutrition',
      check: (a) => {
        const ml = Number(a.water_ml);
        if (!Number.isFinite(ml) || ml <= 0) return `water_ml was "${String(a.water_ml)}", expected a positive number`;
        return ml >= 500 && ml <= 1000 ? null : `water_ml was ${ml}, expected ~750 (they said the amount)`;
      },
    },
    from: 'Owner directive 2026-08-19 — nutrition as a callable tool; water is the case the confirm sheet never catches.',
  },
  {
    id: 'A15',
    kind: 'action',
    turn: 'oh and i never logged lunch — had leftover chili around noon, decent bowl of it',
    expect: ['log_nutrition'],
    allow: [...DOSSIER_READS, 'get_food_log'],
    args: {
      tool: 'log_nutrition',
      check: (a) => (String(a.text ?? '').trim() ? null : 'text was empty — the meal goes down in their words'),
    },
    from: 'Owner directive 2026-08-19 — the remembered-meal case: food arriving sideways, hours after the fact.',
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
    expect: ['get_recipes'],
    allow: [...DOSSIER_READS, 'get_food_log'],
    forbid: ['lookup_food'],
    from: 'PLAN.md:5347 (2026-08-14, #199) — the food quartet tiebreak: their dishes, not facts about one food.',
  },
  {
    id: 'B3',
    kind: 'read',
    turn: 'how much protein is in 100g of halloumi',
    expect: ['lookup_food'],
    allow: [...DOSSIER_READS],
    forbid: ['get_recipes', 'get_food_log'],
    from: 'PLAN.md:5312 (2026-08-14, #198) — lookup_food is nothing without its query; the other side of the quartet.',
  },
  {
    id: 'B4',
    kind: 'read',
    turn: 'what did i actually eat yesterday, i completely lost track by the evening',
    expect: ['get_food_log'],
    allow: [...DOSSIER_READS, 'get_macro_targets'],
    forbid: ['lookup_food', 'get_recipes'],
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
    from: 'PLAN.md:871 (2026-08-11) — "where did that number come from?" She quoted a 90-day mean as current form.',
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
    forbid: ['lookup_food', 'get_food_log', 'log_nutrition'],
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
    forbid: ['propose_plan_change', 'update_goal', 'update_constraint', 'log_session', 'log_nutrition'],
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
 * The six that change the user's data. Load-bearing for scoring, not decoration: a READ she did
 * not call may have been handed to her by the Broker's prefetch and the run credits that, whereas
 * an action has no second path — nothing but the call can satisfy it.
 */
export const ACTION_TOOLS = new Set([
  'propose_plan_change',
  'update_goal',
  'update_constraint',
  'log_session',
  'correct_log',
  'set_macro_targets',
]);

/** The set a call must belong to; anything else the model emits is an invented tool. */
export const KNOWN_TOOLS = new Set([
  ...DOSSIER_READS,
  ...ACTION_TOOLS,
  'get_workout_history',
  'get_recent_logs',
  'get_goal_progress',
  'get_practice_totals',
  'get_food_log',
  'get_journal',
  'get_recipes',
  'get_macro_targets',
  'lookup_food',
]);

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
