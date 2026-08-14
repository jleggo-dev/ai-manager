import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { executeCalls } from './retrieval/select-and-run.ts';

/**
 * The coach's READ TOOLS — the retrieval registry, offered to the model as callable functions
 * (PLAN.md, "the coach as a governed tool-user"). Until now only the APP called these functions,
 * on a guess at session-open (the context pack); now the coach pulls what the turn actually
 * needs, and "let me check your file" is literal.
 *
 * Governance is unchanged by design: the registry stays the ONLY data surface (the model still
 * never touches the DB), execution runs through the same `executeCalls` the pack uses (same
 * logging, same provenance discipline), and what the model receives is each function's own
 * `render()` — the exact text the pack would have injected, so a fact reads identically whether
 * it arrived by pack or by call.
 *
 * READ-ONLY on purpose. Act tools (propose_plan_change) come behind this with their own
 * suggest-never-auto-apply contract; nothing here mutates anything.
 */

/** Registry functions the coach may call. All zero-argument in v1 — each returns the user's
 *  current state; parameterized retrieval (date ranges, specific goals) is a later increment. */
const COACH_TOOL_NAMES = [
  'get_identity',
  'get_objectives',
  'get_active_plan',
  'get_consistency',
  'get_constraints',
  'get_weight',
  'get_equipment',
  'get_dietary_profile',
  'get_health_history',
  'get_goal_progress',
] as const;

export interface CoachToolCall {
  toolCallId: string;
  name: string;
}

export interface CoachToolOutput {
  toolCallId: string;
  output: string;
}

/** The names the relay treats as ours — anything else in a function_call is not our problem. */
export const coachToolNames = (): Set<string> => new Set(COACH_TOOL_NAMES.filter((n) => RETRIEVAL_FUNCTIONS[n]));

/**
 * Devs.ai-shaped tool definitions, built from the registry's own names and LLM-facing
 * descriptions. Empty parameter schemas: these read "the user's current X", nothing to fill in
 * (the tool-jobs probe taught us an undeclared schema reads as parameterless — here that is the
 * truth, not an accident).
 */
export function coachToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return COACH_TOOL_NAMES.filter((n) => RETRIEVAL_FUNCTIONS[n]).map((n) => ({
    type: 'function',
    function: {
      name: n,
      description: RETRIEVAL_FUNCTIONS[n]!.description,
      parameters: { type: 'object', properties: {} },
    },
  }));
}

/**
 * Fulfill the coach's calls: run each named registry function for THIS user and hand back its
 * rendered section. Unknown names are skipped (the relay filtered already; this is the second
 * lock). A function that returns nothing renderable answers plainly — an empty string would read
 * upstream as a tool that silently failed, and the model should instead SAY "nothing on file".
 */
export async function executeCoachToolCalls(userId: string, calls: CoachToolCall[]): Promise<CoachToolOutput[]> {
  const known = coachToolNames();
  const wanted = calls.filter((c) => known.has(c.name));
  if (!wanted.length) return [];
  const { results } = await executeCalls(
    userId,
    wanted.map((c) => ({ fn: c.name, params: {} })),
    { logLabel: 'coach-tool' },
  );
  return wanted.map((c) => {
    const fn = RETRIEVAL_FUNCTIONS[c.name]!;
    let output = '';
    try {
      output = fn.render(results[c.name]);
    } catch {
      /* a render that throws is a tool that found nothing usable */
    }
    return { toolCallId: c.toolCallId, output: output || '(nothing on file for this yet)' };
  });
}
