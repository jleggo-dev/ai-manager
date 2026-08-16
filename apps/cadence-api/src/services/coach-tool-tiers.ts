import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { coachActionNames } from './coach-actions.ts';

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

/** Tools offered on every turn: every action, the one always-read, and the way to find the rest. */
export function alwaysOnToolNames(): string[] {
  return [...ALWAYS_READS, ...coachActionNames(), ...META_TOOL_NAMES];
}

/** Layer 2 — everything else she CAN call, once she has asked for it. */
export function onDemandToolNames(): string[] {
  const always = new Set<string>(alwaysOnToolNames());
  const dossier = new Set<string>(DOSSIER_FUNCTIONS);
  return Object.keys(RETRIEVAL_FUNCTIONS).filter((n) => !always.has(n) && !dossier.has(n));
}

/** Every name the harness will honour, whichever layer it came from. */
export function allHarnessToolNames(): string[] {
  return [...alwaysOnToolNames(), ...onDemandToolNames()];
}
