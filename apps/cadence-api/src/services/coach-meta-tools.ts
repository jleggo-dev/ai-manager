import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { executeCalls } from './retrieval/select-and-run.ts';
import { onDemandToolNames, FIND_TOOLS_NAME, USE_TOOL_NAME } from './coach-tool-tiers.ts';

/**
 * The two tools that make the long tail reachable without carrying it.
 *
 * `find_tools` hands back the instructions for whatever she asks about; `use_tool` runs one of
 * them. Two tools rather than one, deliberately: a function call can only name a tool that was
 * DECLARED for that request, so a `find_tools` that merely described a tool would leave her able
 * to read about something she still could not call. Re-declaring mid-turn would mean the
 * continuation accepting a changed tool list, which is provider behaviour we do not control (we
 * run through AI Admin → Devs.ai, not the Anthropic API). Sentry's shipped MCP server splits it
 * the same way, for what is probably the same reason.
 *
 * The cost of the pair is ~2 tool definitions carried always, against 12 reads no longer carried
 * at all. The shape is what matters more than the arithmetic: a new READ is now free forever,
 * which is the property the owner actually asked for.
 */

/** One line per tool, cheap enough that she can scan the whole tail. */
function catalogLine(name: string): string {
  const f = RETRIEVAL_FUNCTIONS[name];
  if (!f) return '';
  return `- ${name}: ${f.description}`;
}

/**
 * Match on the words that are actually there — name, description, and the domain tags each
 * function already carries. Deliberately generous: an empty query returns everything, because a
 * coach who cannot remember what to search for should get the list rather than a shrug.
 */
export function searchTools(query: string): string[] {
  const names = onDemandToolNames();
  const q = query.trim().toLowerCase();
  if (!q) return names;
  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return names;
  const scored = names
    .map((name) => {
      const f = RETRIEVAL_FUNCTIONS[name]!;
      const hay = `${name} ${f.description} ${(f.domains ?? []).join(' ')}`.toLowerCase();
      return { name, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  // Nothing matched is a real answer and a useful one — but the full list beats a dead end when
  // she has simply reached for an unfamiliar word.
  return scored.length ? scored.map((s) => s.name) : names;
}

export interface MetaTool {
  name: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  run(userId: string, params: Record<string, unknown>): Promise<string>;
}

export const COACH_META_TOOLS: Record<string, MetaTool> = {
  [FIND_TOOLS_NAME]: {
    name: FIND_TOOLS_NAME,
    description:
      'Look up the other things you can read about this user — recorded workouts, journal, recipes, saved foods, equipment, practice totals, food log and nutrition targets. None are loaded until you ask. Use whenever a question needs detail you were not already given, then call use_tool with what you find. This does NOT change anything; it only tells you what exists and how to call it. Pass {"query": "workouts"} to search by topic.',
    parameters: {
      properties: {
        query: {
          type: 'string',
          description: 'What you are looking for, in plain words, e.g. "workouts". Omit to list everything.',
        },
      },
    },
    async run(_userId, params) {
      const found = searchTools(String(params.query ?? ''));
      const lines = found.map(catalogLine).filter(Boolean);
      if (!lines.length) return 'Nothing else is available to read. Answer from what you already have.';
      return [
        'Available to read, with how to call each. Use use_tool with the name and its arguments:',
        ...lines,
        'Call use_tool now if one of these answers the question — do not describe them to the user.',
      ].join('\n');
    },
  },

  [USE_TOOL_NAME]: {
    name: USE_TOOL_NAME,
    description:
      'Run one of the things find_tools listed, and get its answer back. Use immediately after find_tools rather than telling the user what you could look up. This does NOT change anything — everything reachable here only reads. Name the tool exactly as find_tools spelled it and pass its arguments as an object: {"name": "get_workout_history", "arguments": {"days": 7}}. Omit "arguments" when the tool takes none.',
    parameters: {
      properties: {
        name: { type: 'string', description: 'The tool to run, spelled exactly as find_tools listed it.' },
        arguments: {
          type: 'object',
          description: 'That tool\'s own arguments, e.g. {"days": 7}. Omit when it takes none.',
        },
      },
      required: ['name'],
    },
    async run(userId, params) {
      const name = String(params.name ?? '').trim();
      const fn = RETRIEVAL_FUNCTIONS[name];
      // Only the on-demand tail is reachable here. Anything else is either already in front of her
      // (the dossier) or an action, which must be called directly so its own contract applies.
      if (!fn || !onDemandToolNames().includes(name)) {
        return `There is no readable tool called "${name}". Call ${FIND_TOOLS_NAME} to see the real names.`;
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const { results } = await executeCalls(userId, [{ fn: name, params: args }], { logLabel: 'use-tool' });
      try {
        const out = fn.render(results[name]);
        return out || `(${name}: nothing on file for this yet)`;
      } catch (e) {
        // Same rule as the direct read path: a fault must never read as an empty record.
        console.error('[use_tool] render failed:', name, e);
        return `${name} could not be read just now — a fault on our side, NOT an empty record. Say you could not check it.`;
      }
    },
  },
};

export const metaToolNames = (): string[] => Object.keys(COACH_META_TOOLS);

export function metaToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return Object.values(COACH_META_TOOLS).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters.properties,
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    },
  }));
}
