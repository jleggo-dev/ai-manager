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
export const TURN_FLOOR_FUNCTIONS = ['get_identity', 'get_constraints', 'get_active_plan', 'get_weight'] as const;

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
 * Run `npm run eval:tools` after changing this list.
 */
export const ALWAYS_ACTIONS = [
  'propose_plan_change',
  'log_session',
  'update_goal',
  'update_constraint',
  'correct_log',
  'set_macro_targets',
] as const;

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
 * for something she may not know exists; five named categories mean the manifest can say what KINDS
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
    members: ['get_recent_logs', 'get_goal_progress', 'get_practice_totals'],
  },
  { key: 'body', label: 'what their body and devices recorded', members: ['get_workout_history', 'get_equipment'] },
  {
    key: 'food',
    label: 'what they eat, their targets, their recipes, and nutrition facts',
    members: ['get_nutrition'],
  },
  { key: 'writing', label: 'what they have written', members: ['get_journal'] },
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
