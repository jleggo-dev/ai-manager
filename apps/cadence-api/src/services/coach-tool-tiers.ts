import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { NUTRITION_FACADE_COVERS } from './retrieval/nutrition-facade.ts';
import { COACH_ACTION_TOOLS, coachActionNames } from './coach-actions.ts';

/**
 * WHICH tools she is holding when she reads a message, and which she has to go and find.
 *
 * The problem this solves, measured: 24 tools were sent on every single turn — 18,380 characters,
 * about 5,000 tokens, before she did any work. Linear in the toolset, and the owner intends to
 * grow it: *"I'm concerned that if we scale to 100 tools, we eat our context window just finding
 * the tool."* At 100 that is ~20,000 tokens a message. Anthropic's published finding is that tool
 * choice degrades past 30–50 available tools; we were at 24 and climbing.
 *
 * The thing that reframed it was smaller and more embarrassing: **eight of the eighteen read tools
 * described how to fetch facts she already had.** `buildContextPack` injects the dossier at session
 * open and `turn-context` re-injects per turn, so identity, goals, plan, constraints, consistency,
 * weight, diet and health history are ALREADY in front of her as text — and we were spending ~2,200
 * characters a turn teaching her to go and get them again. A context-engineering problem wearing a
 * tool-selection problem's clothes.
 *
 * So, three layers (docs/cadence/HARNESS-V2.md):
 *
 *  - **Layer 0 — the dossier.** Injected text, not tools. Nothing here; it is the pack's job. The
 *    owner put it best: the plan is built out of the objectives and around the constraints, so they
 *    are one thing, and the answer is not to group them as tools but to stop making them tools.
 *  - **Layer 1 — ALWAYS.** Every action, plus `find_tools`. Actions cannot be prefetched — being
 *    chosen is what an action IS — and every failure this week was an under-triggered action
 *    (she described `propose_plan_change` instead of calling it). Owner ruling, after weighing them
 *    by frequency: all six stay, because they are core capabilities and she should never be caught
 *    not knowing she can do them.
 *  - **Layer 2 — ON DEMAND.** The long-tail reads. Zero tokens until `find_tools` asks for them.
 *
 * Reads therefore become free to add, which is the property we actually wanted. Actions stay
 * expensive on purpose: if we ever have twenty, that is a consolidation problem worth being forced
 * to confront rather than allowed to avoid.
 */

/** The two meta tools. Named here, beside the tiers, because "what is always on" is this module's
 *  question — and because coach-meta-tools.ts imports the tiers, so naming them there would cycle. */
export const FIND_TOOLS_NAME = 'find_tools';
export const USE_TOOL_NAME = 'use_tool';
export const META_TOOL_NAMES = [FIND_TOOLS_NAME, USE_TOOL_NAME] as const;

/**
 * Layer 0 — carried by the context pack, so exposing them as tools is a second path to a fact she
 * is already holding, and one more decision on a turn that usually needs none. They remain in the
 * registry (the pack runs them); they are simply not offered as callable tools.
 *
 * Kept as an explicit list rather than derived from the pack's intent selections: those lists are
 * tuned per conversation shape and change often, and a tool quietly appearing or vanishing because
 * someone re-tuned an intent would be a horrible way to find out.
 */
/**
 * The dossier facts re-sent on EVERY turn (turn-context.ts's floor).
 *
 * Lives here rather than in turn-context because two different files need to agree on it: the one
 * that injects it, and the one that tells her she already has it. When they disagreed, `use_tool`
 * told her `get_weight` was "already in your context every turn" while the floor did not re-send
 * it — a confident refusal pointing at nothing. Keep this list and TURN_FLOOR identical.
 */
export const TURN_FLOOR_FUNCTIONS = [
  'get_identity',
  'get_constraints',
  'get_active_plan',
  'get_weight',
  // Added 2026-08-22 with get_weight, for the same reason and from the same report: asked to set
  // targets, she re-asked his weight-loss goal, which he had told her weeks earlier. Objectives are
  // the spine of a coaching conversation — what someone is working toward is not detail she should
  // have to go looking for, and a coach who forgets it is the brand promise inverted. One short
  // line per goal.
  'get_objectives',
] as const;

export const DOSSIER_FUNCTIONS = [
  'get_identity',
  'get_objectives',
  'get_constraints',
  'get_consistency',
  'get_weight',
  'get_dietary_profile',
  'get_health_history',
] as const;

/**
 * The one read that stays in Layer 1 despite riding the pack.
 *
 * `get_active_plan` is the only dossier fact that changes DURING a conversation, because she is the
 * one who changes it — and `propose_plan_change` requires naming commitments exactly as the plan
 * lists them. The turn floor injects it every turn (turn-context.ts), but a plan she has just
 * edited is the one case where being able to re-read beats being told.
 */
export const ALWAYS_READS = ['get_active_plan'] as const;

/**
 * The actions she carries. Not all of them — the two she needs most days.
 *
 * The first cut kept all six, on the owner's ruling that they are core capabilities she should
 * never be caught not knowing about. Measuring the result is what revised it: the six were 4,190
 * characters of the 5,405 spent on descriptions, and the schemas behind them another ~4,600. They
 * were the whole remaining cost.
 *
 * What the first cut conflated is knowing and carrying. The capability manifest already tells her
 * what she can do, one line each, at session open — that is the knowing, and it costs ~15
 * characters per capability instead of 750. A tool definition is only needed at the moment of
 * calling. Owner, once the distinction was on the table: *"she'll find update_goal if she knows
 * that she should look for it… The real risk is her not looking."* So the manifest's job is to make
 * her look, and that is where the fix went (coach-capabilities.ts).
 *
 * **All six are back, and the demotion is reverted — measured, not felt.** Four of them were moved
 * behind `find_tools` for ~1,400 tokens a turn, on the reasoning that a weekly act can afford a
 * round-trip. What a weekly act cannot afford is not happening. Same evening, same user, same
 * model (Sonnet 5):
 *
 * | tool | reached how | called |
 * |---|---|---|
 * | `log_session` | always-on | **4 of 4** |
 * | `update_constraint` | behind `find_tools` | **0 of 3** |
 *
 * She found `update_constraint` every single time — the hierarchy worked, first query — and never
 * called it, telling the owner it was done instead. Not a discovery problem: a follow-through one.
 * The likely mechanism is structural, so no wording fixes it: a continuation is a FRESH generation,
 * so the round that ignores "call use_tool now" is not the round that read it.
 *
 * The comment two paragraphs up already said *actions cannot be prefetched — being chosen IS what
 * an action is*. That was right, and then four were demoted anyway for tokens. This restores it.
 *
 * READS stay in the tail, which was always the bigger win: a new read still costs nothing per turn
 * forever, and the Broker prefetches the common ones before she has to ask. The cost of this revert
 * is ~1,500 tokens a turn, which buys actions that actually fire.
 *
 * `open_week_review` joined for the identical reason, not a new one: it happens weekly at most,
 * which is the shape `update_constraint` had when it was demoted and measured at 0 of 3. A
 * check-in's whole value is that it ends in a change (docs/cadence/DESIGN-check-in.md) — an act she
 * finds instead of calls is worse here than anywhere else in the harness, because the visible
 * failure is a warm conversation that never puts the card up at all. `build_next_week` rides
 * beside it for the identical trigger shape — the trust path's say-text arrives as a fresh
 * message, and a roll-forward that silently does not happen is a person who said "just build it"
 * and got nothing.
 *
 * `log_meal` joined 2026-08-28 (MP21/MP40) on the same evidence, not a guess: it is the shape
 * `update_constraint`'s 0-of-3 measurement warns against, TWICE OVER. Food gets mentioned in
 * conversation more often than any other loggable thing — most people eat three or more times a
 * day — so it is the LEAST affordable of all of them to leave behind a round-trip. And the
 * scenario this whole parcel exists for says it outright: "during the week the user should be
 * able to... just tell Cadence in chat that they ate it and it gets logged" (PLAN.md, "Meal prep,
 * end to end"). An always-on tool she does not call is invisible; a mid-tail one she has to go
 * find and then follow through on is the exact failure `update_constraint` measured. `preview_meal`
 * and `research_food` stay in the tail deliberately — they are reads, already free, and neither is
 * the everyday case this evidence is about.
 *
 * `propose_progress_layout` sat here for a day (2026-08-30) on a claimed owner ruling that was
 * never actually made — an agent-written comment asserted it. The ACTUAL owner ruling, same day:
 * selection accuracy comes from making the DRAWER work, not from promotion — mature harnesses
 * defer most tools behind a visible index, and very few tools are legitimately always-on. So the
 * tool moved to the tail, and DRAWER_HOOKS below — assembled into find_tools' carried
 * description — gives the drawer the label it never had (the old description hand-listed READ
 * topics only, so a tail action was invisible by the drawer's own signage).
 *
 * Two failure modes, kept honestly distinct: the update_constraint measurement above showed
 * DISCOVERY working and FOLLOW-THROUGH failing (found every time, called never — the
 * continuation seam). The label directly fixes the knowing-to-look half and is the cheap
 * experiment for the other half: hooks she reads in the SAME generation that decides may prime
 * the call where a fetched description in a fresh continuation did not. Eval cases A19/A20
 * measure exactly this, post-deploy. If follow-through still fails with the label in place,
 * that is evidence about the find→use seam itself — not a mandate to promote by default.
 * New tools DEFAULT to the tail plus a hook; promotion into this list requires an explicit
 * owner ruling recorded here, and over evidence this list should shrink, not grow.
 *
 * Run `npm run eval:tools` after changing this list (post-deploy — it drives the deployed api).
 */
export const ALWAYS_ACTIONS = [
  'propose_plan_change',
  'log_session',
  'update_goal',
  'update_constraint',
  'correct_log',
  'set_macro_targets',
  'open_week_review',
  'build_next_week',
  'log_meal',
  /**
   * `update_repertoire` joined 2026-08-30 on the owner's ruling from the piano conversation the
   * night before: when the user hands over what they know ("assume I know the earlier songs from
   * Suzuki book 2", then nine typed pieces), *she must know she has to store it* — and the trigger
   * arrives mid-plan-editing with `propose_plan_change` filling her attention, which is exactly
   * the shape `update_constraint` measured at 0-of-3 from the tail. Definition measured at
   * ~348 tokens/turn (1,392 chars serialized ÷ 4, the TOOL-HARNESS.md method), inside the
   * 305–375 band it budgets for an ordinarily-shaped action.
   */
  'update_repertoire',
] as const;

/**
 * The drawer's label (owner ruling 2026-08-30, above): one hook line per on-demand tool, grouped
 * by area, assembled into find_tools' carried description so she always SEES what she could go
 * looking for — "knowing when to pull on the thread is the trick." Hooks are read by a MODEL:
 * follow the six style rules in tool-catalog.ts ("HOW TO WRITE THE STRINGS IN THIS FILE", owner
 * ruling 2026-08-30) — name categories, state rules not sentiments, no metaphor for mechanism.
 * Plain and literal, ≤90 chars; the house voice is for the user, never for her.
 * coach-drawer-index.test.ts gates exact coverage of onDemandToolNames() — a tail tool without a
 * hook line here fails CI by name.
 */
/**
 * What the generated drawer label may cost, in characters, on EVERY message.
 *
 * A FIXED total rather than a per-tool budget, and that is deliberate: the thing being protected
 * is the per-turn context bill, which is a property of the whole index and not of any one entry.
 * Deriving it from the tail size would make it arithmetic that always passes — the per-hook cap
 * (`HOOK_MAX`, 90) already handles "one entry got fat", and a bound that grows with whatever it
 * measures stops being a bound. This is the number the owner's own worry names: *"if we scale to
 * 100 tools, we eat our context window just finding the tool."*
 *
 * 3,000 chars is about 750 tokens a message, by the chars÷4 heuristic TOOL-HARNESS.md already uses
 * for the always-on definitions.
 *
 * RAISED FROM 2,600 ON 2026-09-01, and the reason matters more than the number. The tail reached
 * 20 tools and the label reached 2,598 — two characters of headroom — so #342 failed CI on a bound
 * it had not meaningfully moved, and it failed only after merge into main, because the tail had
 * grown in parallel branches. The tiering's whole promise is that a new read costs nothing until
 * she asks for it; a cap that turns tool 21 into someone else's red build is that promise leaking.
 *
 * Composition when this was set: preamble 382, seven category labels 305, 20 tools averaging ~111
 * each (name + hook + the action marker). So this buys roughly four more tools, not an era.
 *
 * WHEN IT IS HIT AGAIN, RAISING IT IS THE LAST ANSWER, NOT THE FIRST. Every 120 chars added here
 * is ~30 tokens on every message forever. Trim the longest hooks, or consolidate a category the
 * way `get_nutrition` already fronts the food reads — the index is meant to stay a label she can
 * scan, and a tail that cannot be indexed in 3,000 characters is a tail worth consolidating.
 */
export const DRAWER_LABEL_MAX = 3000;

export const DRAWER_HOOKS: Readonly<Record<string, string>> = {
  get_nutrition: 'everything about what they eat — log, recipes, targets, trends; name the view you need',
  preview_meal: 'parse-and-price a described meal WITHOUT logging it',
  check_food_sources: 'ask every food database at once about one food, disagreements included',
  resolve_portion: 'what a household measure of a saved food weighs in grams',
  read_label: 'read an attached photo: nutrition panel or front-of-pack',
  set_micro_target: "ACTION: a doctor's nutrient target, over the reference",
  research_food: 'web research on a NAMED product no database has — slow',
  get_workout_history: 'their recorded workouts from their devices, newest first',
  get_practice_totals: 'running totals of anything they count — words written, minutes sat, pages read',
  get_repertoire: 'what they are learning and already know — pieces, katas, poems — with standing',
  offer_repertoire_review: 'ACTION: show a named collection (music book, kata syllabus, reading list) as a checklist',
  get_user_built_activities: 'activities the user built themselves — steps, runs, and plan placement',
  get_journal: 'recent journal entries, verbatim; entries marked private are never included',
  get_goal_progress: 'per-goal progress numbers computed from what they logged',
  propose_progress_layout: 'propose a redesign of what their Progress page watches — they confirm a card first',
  get_recent_logs: 'their session notes from recent days: what they did and how it felt',
  get_equipment: 'training equipment they own, with usage wear for tracked items',
  update_equipment: 'ACTION: add, remove, or rename equipment on their file — corrections included',
  extend_horizon: 'ACTION: run the current week longer — "plan two weeks ahead" — check-in moves with it',
  revise_session: 'ACTION: rebuild one upcoming session\'s contents from their words — "add chest and abs"',
  start_replan: 'ACTION: rebuild the WHOLE week around their words — background, takes minutes',
  set_home_location: 'ACTION: record where they live, so weather and daylight can be read for outdoor sessions',
};

/**
 * What a blown budget should PRINT: the size, what is in it, and the two real options.
 *
 * The failure that prompted this said only "2630 > 2600", which does not tell the next person
 * whether their own hook is fat or the tail simply grew — and those have opposite fixes. Lives
 * here rather than in a test file because both gates assert it (coach-drawer-index and
 * retrieval/description-audit), and a helper imported ACROSS test files re-registers the exporting
 * file's suites in the importer, silently running them twice.
 */
export function labelBudgetReport(label: string): string {
  const preamble = label.split('\n')[0]?.length ?? 0;
  const tools = onDemandToolNames().length;
  const perTool = tools ? Math.round((label.length - preamble) / tools) : 0;
  return (
    `find_tools label is ${label.length} chars against a ${DRAWER_LABEL_MAX} budget — ` +
    `${tools} tail tools at ~${perTool} each, plus a ${preamble}-char preamble. ` +
    `Trim the longest DRAWER_HOOKS or consolidate a category before raising DRAWER_LABEL_MAX: ` +
    `every 120 chars here is ~30 tokens on EVERY message, forever.`
  );
}

/** Tools offered on every turn: the daily actions, the one always-read, and the way to find the rest. */
export function alwaysOnToolNames(): string[] {
  return [...ALWAYS_READS, ...ALWAYS_ACTIONS, ...META_TOOL_NAMES];
}

/**
 * Layer 2 — everything else she CAN call once she has asked for it: the long-tail reads AND the
 * actions that did not earn a permanent slot. Actions reached this way keep their own contract
 * intact, because `use_tool` runs the tool's own `run()` and `find_tools` hands her the tool's own
 * description — including the sentence saying whether it applies immediately or waits for a tap.
 */
export function onDemandToolNames(): string[] {
  const always = new Set<string>(alwaysOnToolNames());
  const dossier = new Set<string>(DOSSIER_FUNCTIONS);
  // Covered by a facade: still in the registry so the Broker can prefetch them, never listed to
  // her, because choosing between them WAS the problem (nutrition-facade.ts).
  const covered = new Set<string>(NUTRITION_FACADE_COVERS);
  const reads = Object.keys(RETRIEVAL_FUNCTIONS).filter((n) => !always.has(n) && !dossier.has(n) && !covered.has(n));
  const actions = [...coachActionNames()].filter((n) => !always.has(n));
  return [...reads, ...actions];
}

/** Whether a name in the tail changes the user's data — `use_tool` must say so honestly. */
export const isActionName = (name: string): boolean => !!COACH_ACTION_TOOLS[name];

/**
 * The tail, grouped — because what she needs is a hierarchy to drill down, not a search box.
 *
 * Owner: *"it's about giving the coach the categories — this is about hierarchy and her having the
 * context to drill down."* That is the whole mechanism. A flat list makes her guess a search term
 * for something she may not know exists; a handful of named categories mean the manifest can say what KINDS
 * of thing are reachable, and she narrows from there. Knowing "there is a category for their food"
 * is enough to go looking, which is the behaviour the demotion depends on.
 *
 * Labels are hers to say out loud if she ever needs to, so they are plain words rather than domain
 * tags. Anything in the tail but in no category still surfaces — `find_tools` falls back to the
 * whole list, and a tool nobody filed is worse hidden than shown.
 */
export const TOOL_CATEGORIES: Array<{ key: string; label: string; members: string[] }> = [
  {
    key: 'training',
    label: 'their training and how it has gone',
    members: ['get_recent_logs', 'get_goal_progress'],
  },
  {
    key: 'practice',
    label: 'what they practice and already know',
    // `get_practice_totals` moved here from `training` when the category was born (2026-08-30):
    // piano minutes and prayer streaks were always a strained fit under "training".
    // `offer_repertoire_review` is this category's first ACTION (2026-09-02): the door for a whole
    // collection, when the person names a book she has no way to type out. It is filed beside the
    // read it feeds, so drilling in shows the pair — what they know, and how a book gets onto it.
    members: ['get_repertoire', 'get_practice_totals', 'offer_repertoire_review'],
  },
  {
    key: 'body',
    label: 'what their body and devices recorded',
    // `update_equipment` filed beside its read half: the drawer's second ACTION (2026-08-31 —
    // the coach searched this drawer seven times for an equipment write that did not exist).
    members: ['get_workout_history', 'get_equipment', 'update_equipment'],
  },
  {
    key: 'food',
    label: 'what they eat, their targets, their recipes, and nutrition facts',
    // `check_food_sources` is the deeper rung under get_nutrition's "lookup" view: same subject,
    // but it asks every database at once and hands back the disagreements instead of one answer.
    // `preview_meal` reads new words into a priced meal without logging it (log_meal, the write
    // half, is always-on and not filed here — see ALWAYS_ACTIONS). `research_food` is the
    // web-grounded rung for a named vendor nothing else has (MP21/MP40/MP27).
    // `read_label` (MP13/MP14) is only relevant on a turn carrying a photo, which is why it is a
    // read in this tail rather than an ALWAYS_ACTIONS entry — a permanent slot would cost
    // 305–375 tokens on every message forever for something most turns have no photo to use it on.
    // `set_micro_target` is the drawer's fourth ACTION (2026-09-01): the published reference
    // intakes apply to everyone automatically, and this is the only way a number they were given
    // outside the app — a doctor's, a prescription's — stands in for one.
    members: [
      'get_nutrition',
      'check_food_sources',
      'resolve_portion',
      'preview_meal',
      'research_food',
      'read_label',
      'set_micro_target',
    ],
  },
  { key: 'writing', label: 'what they have written', members: ['get_journal'] },
  {
    key: 'plan',
    label: 'their plan, what one session holds, and how far ahead it runs',
    // Born with `extend_horizon` (0050): the week-length grant fits no existing category — it is
    // not training content, not progress-page chrome. `build_next_week`/`propose_plan_change`
    // stay always-on and are deliberately not filed here (see ALWAYS_ACTIONS).
    // `revise_session` (PLAN-CHANGES.md rung 1, 2026-08-31): the drawer's third ACTION — rebuild
    // what is INSIDE one upcoming session from the user's words, one prescription instead of the
    // full re-synthesis the incident fell through to.
    // `start_replan` (PLAN-CHANGES.md rung 3, Phase 2): the whole-week rebuild as a background
    // run — the same plan_run spine as the Adjust sheet (replan-start.ts). Filed beside the other
    // plan surgery so drilling into "plan" shows the whole ladder: one session, the week's shape,
    // the week rebuilt.
    // `get_user_built_activities` (Activity Builder wave 3): the user's OWN routines — session-
    // shaped and schedulable, so they live beside the plan surgery. Rides the ongoing context
    // pack too (renders '' when none exist); this filing is for the turns where she goes looking.
    members: ['extend_horizon', 'revise_session', 'start_replan', 'get_user_built_activities'],
  },
  {
    key: 'progress',
    label: 'their Progress page and what it watches',
    // The drawer's first ACTION (owner ruling 2026-08-30, above ALWAYS_ACTIONS): filed like any
    // read, marked [changes their data] in the label, and its own contract still gates the write
    // behind the user's tap on the proposal card.
    members: ['propose_progress_layout'],
  },
  {
    key: 'home',
    label: 'their home location, for weather and daylight',
    // Born with `set_home_location`: a coarse place fact for weather/daylight, not training
    // content, not plan surgery, not Progress-page chrome — none of the existing categories fit,
    // so this is a new one rather than a strained fit into an old one.
    members: ['set_home_location'],
  },
];

/** The categories, one line each — what the manifest names so she knows a drill-down exists. */
export const categoryLines = (): string[] => TOOL_CATEGORIES.map((c) => `${c.key} (${c.label})`);

/** Members of a named category that are actually in the tail; empty for an unknown key. */
export function categoryMembers(key: string): string[] {
  const cat = TOOL_CATEGORIES.find((c) => c.key === key.trim().toLowerCase());
  if (!cat) return [];
  const tail = new Set(onDemandToolNames());
  return cat.members.filter((m) => tail.has(m));
}

/** Every name the harness will honour, whichever layer it came from. */
export function allHarnessToolNames(): string[] {
  return [...alwaysOnToolNames(), ...onDemandToolNames()];
}
