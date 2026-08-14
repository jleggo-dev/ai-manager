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

/** Registry functions the coach may call. Owner ruling 2026-08-14: everything she can look up,
 *  she should be able to look up — the food log, the journal, the recipe book and the practice
 *  totals joined the list that day, because a coach who can see your training but not your
 *  eating or your writing is only half a coach. */
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
  'get_workout_history',
  'get_recent_logs',
  'get_goal_progress',
  'get_practice_totals',
  'get_food_log',
  'get_journal',
  'get_recipes',
  'lookup_food',
] as const;

/**
 * Parameter schemas, for the functions that take one.
 *
 * v1 declared every tool parameterless, which quietly cost most of their value: "what did I do
 * THIS WEEK" and "how much have I written this month" both ran on a default window, and
 * `lookup_food` — which is nothing without its query — could not be called usefully at all. A
 * declared schema is also the only way arguments arrive filled (the tool-jobs probe, #189).
 */
const TOOL_PARAMS: Record<string, { properties: Record<string, unknown>; required?: string[] }> = {
  get_consistency: {
    properties: { days: { type: 'integer', description: 'How many days back to look (default 7, up to 90).' } },
  },
  get_recent_logs: {
    properties: { days: { type: 'integer', description: 'How many days back to look (default 14, up to 90).' } },
  },
  get_workout_history: {
    properties: { days: { type: 'integer', description: 'How many days back to look (default 30, up to 90).' } },
  },
  get_practice_totals: {
    properties: { days: { type: 'integer', description: 'How many days back to add up (default 30, up to 365).' } },
  },
  get_journal: {
    properties: { limit: { type: 'integer', description: 'How many entries to return (default 8, up to 20).' } },
  },
  get_recipes: {
    properties: {
      query: { type: 'string', description: 'Search their book by dish name; omit to get their saved recipes.' },
    },
  },
  lookup_food: {
    properties: {
      q: { type: 'string', description: 'The food to look up, by name.' },
      limit: { type: 'integer', description: 'How many matches to return (default 5, up to 10).' },
    },
    required: ['q'],
  },
};

export interface CoachToolCall {
  toolCallId: string;
  name: string;
  /** JSON from the model, when the tool declares parameters. */
  arguments?: string;
}

export interface CoachToolOutput {
  toolCallId: string;
  output: string;
}

/** The names the relay treats as ours — anything else in a function_call is not our problem. */
export const coachToolNames = (): Set<string> => new Set(COACH_TOOL_NAMES.filter((n) => RETRIEVAL_FUNCTIONS[n]));

/**
 * Devs.ai-shaped tool definitions, built from the registry's own names and LLM-facing
 * descriptions, plus a parameter schema for the functions that take one. A function absent from
 * TOOL_PARAMS genuinely reads "the user's current X" and has nothing to fill in.
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
      parameters: {
        type: 'object',
        properties: TOOL_PARAMS[n]?.properties ?? {},
        ...(TOOL_PARAMS[n]?.required ? { required: TOOL_PARAMS[n]!.required } : {}),
      },
    },
  }));
}

/**
 * Fulfill the coach's calls: run each named registry function for THIS user and hand back its
 * rendered section. Unknown names are skipped (the relay filtered already; this is the second
 * lock). A function that returns nothing renderable answers plainly — an empty string would read
 * upstream as a tool that silently failed, and the model should instead SAY "nothing on file".
 */
/** The model's arguments, defensively. Malformed JSON runs the function on its defaults rather
 *  than failing the turn — a slightly-wrong window beats "something went wrong". */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function executeCoachToolCalls(userId: string, calls: CoachToolCall[]): Promise<CoachToolOutput[]> {
  const known = coachToolNames();
  const wanted = calls.filter((c) => known.has(c.name));
  if (!wanted.length) return [];
  const { results } = await executeCalls(
    userId,
    wanted.map((c) => ({ fn: c.name, params: parseArgs(c.arguments) })),
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
