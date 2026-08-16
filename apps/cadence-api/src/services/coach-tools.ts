import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { executeCalls } from './retrieval/select-and-run.ts';
import { COACH_ACTION_TOOLS, coachActionDefinitions } from './coach-actions.ts';
import { alwaysOnToolNames, allHarnessToolNames } from './coach-tool-tiers.ts';
import { COACH_META_TOOLS, metaToolDefinitions } from './coach-meta-tools.ts';
import { boundToolResponse, toolEmptyText, toolFaultText } from './tool-response.ts';

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
/**
 * The reads offered on EVERY turn. Everything else she can reach lives behind `find_tools`
 * (coach-tool-tiers.ts) and costs nothing until she asks.
 *
 * This list used to be all eighteen, which is how 24 definitions and ~5,000 tokens rode every
 * message — and eight of them described how to fetch facts the context pack had already injected
 * as text. `get_active_plan` is the one read that earns its slot: it is the only dossier fact that
 * changes DURING a conversation, because she is the one who changes it.
 */
const COACH_TOOL_NAMES = alwaysOnToolNames().filter((n) => RETRIEVAL_FUNCTIONS[n]);

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

/** The names the relay treats as ours — anything else in a function_call is not our problem.
 *  Both halves of the harness: what she can look up, and what she can propose changing. */
export const coachToolNames = (): Set<string> => new Set(allHarnessToolNames());

/**
 * Devs.ai-shaped tool definitions, built from the registry's own names and LLM-facing
 * descriptions, plus a parameter schema for the functions that take one. A function absent from
 * TOOL_PARAMS genuinely reads "the user's current X" and has nothing to fill in.
 */
export function coachToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  const reads = COACH_TOOL_NAMES.map((n) => ({
    type: 'function' as const,
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
  // Only the DAILY actions ride every turn. The rest are declared nowhere and reached through
  // find_tools — they were 5,300 characters between them, and they happen weekly at most.
  const always = new Set(alwaysOnToolNames());
  const actions = coachActionDefinitions().filter((d) => always.has(d.function.name));
  return [...reads, ...actions, ...metaToolDefinitions()];
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

  // Action and meta tools run one at a time and own their own output — actions write a PROPOSAL,
  // never a change; meta tools search or delegate. Neither goes through the read path below.
  const single = wanted.filter((c) => COACH_ACTION_TOOLS[c.name] || COACH_META_TOOLS[c.name]);
  const actionOutputs: CoachToolOutput[] = [];
  for (const c of single) {
    const tool = COACH_ACTION_TOOLS[c.name] ?? COACH_META_TOOLS[c.name]!;
    let output: string;
    try {
      output = await tool.run(userId, parseArgs(c.arguments));
    } catch (e) {
      console.error('[coach-tool]', c.name, e);
      output = 'That could not be done just now — tell the user plainly and offer to try again.';
    }
    actionOutputs.push({ toolCallId: c.toolCallId, output });
  }

  const reads = wanted.filter((c) => !COACH_ACTION_TOOLS[c.name] && !COACH_META_TOOLS[c.name]);
  if (!reads.length) return actionOutputs;
  const { results } = await executeCalls(
    userId,
    reads.map((c) => ({ fn: c.name, params: parseArgs(c.arguments) })),
    { logLabel: 'coach-tool' },
  );
  return [
    ...actionOutputs,
    ...reads.map((c) => {
      const fn = RETRIEVAL_FUNCTIONS[c.name]!;
      /**
       * "Found nothing" and "broke" are different answers and must never share a sentence.
       *
       * This used to swallow a throwing render as "(nothing on file for this yet)" — reasoning
       * that a render which crashes found nothing usable. It does not follow, and the cost was
       * exact: on 2026-08-16 both Apple Health reads threw on a Date the row type called a string
       * (iso-day.ts), and the coach told a user with a full workout log that nothing was recorded.
       * A lie in her voice, from a bug, with no trace anywhere that a tool had failed.
       *
       * So an error now says it is an error, tells her what to do about it, and gets logged where
       * someone can find it. She can say "I couldn't read that just now" — which is true, and
       * which the user can push back on.
       */
      try {
        const output = fn.render(results[c.name]);
        return { toolCallId: c.toolCallId, output: boundToolResponse(output || toolEmptyText()) };
      } catch (e) {
        console.error('[coach-tool] render failed:', c.name, e);
        return { toolCallId: c.toolCallId, output: toolFaultText('That') };
      }
    }),
  ];
}
