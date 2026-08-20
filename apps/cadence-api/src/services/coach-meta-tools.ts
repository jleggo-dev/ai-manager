import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { boundToolResponse, toolEmptyText, toolFaultText } from './tool-response.ts';
import { COACH_ACTION_TOOLS } from './coach-actions.ts';
import { executeCalls } from './retrieval/select-and-run.ts';
import {
  onDemandToolNames,
  categoryMembers,
  isActionName,
  FIND_TOOLS_NAME,
  USE_TOOL_NAME,
  DOSSIER_FUNCTIONS,
  ALWAYS_ACTIONS,
} from './coach-tool-tiers.ts';

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

/** One line per tool, cheap enough that she can scan the whole tail. Actions are marked, because
 *  the difference between reading something and changing it is the one she must never blur. */
function catalogLine(name: string): string {
  const f = RETRIEVAL_FUNCTIONS[name] ?? COACH_ACTION_TOOLS[name];
  if (!f) return '';
  return `- ${name}${isActionName(name) ? ' [changes their data]' : ''}: ${f.description}`;
}

/**
 * Match on the words that are actually there — name, description, and the domain tags each
 * function already carries. Deliberately generous: an empty query returns everything, because a
 * coach who cannot remember what to search for should get the list rather than a shrug.
 */
export interface ToolSearchResult {
  names: string[];
  /** True when nothing actually matched and `names` is the whole list shown as a fallback. */
  noMatch: boolean;
}

export function searchTools(query: string): ToolSearchResult {
  const names = onDemandToolNames();
  const q = query.trim().toLowerCase();
  if (!q) return { names, noMatch: false };

  // A category name is the fast path — the manifest teaches those, so she will use them.
  const byCategory = categoryMembers(q);
  if (byCategory.length) return { names: byCategory, noMatch: false };

  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return { names, noMatch: false };
  const scored = names
    .map((name) => {
      const f = RETRIEVAL_FUNCTIONS[name] ?? COACH_ACTION_TOOLS[name];
      const domains = RETRIEVAL_FUNCTIONS[name]?.domains ?? [];
      const hay = `${name} ${f?.description ?? ''} ${domains.join(' ')}`.toLowerCase();
      return { name, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  /**
   * Nothing matched still shows the list, but SAYS it did not match — and the difference matters.
   *
   * Owner: *"it would be better for her to look and tell the user 'I don't actually have a tool for
   * that today' than to not look; to not report; to pretend she's doing something she's not."* A
   * silent fallback to the full list invites exactly that pretence: she asked for sleep tracking,
   * got ten unrelated tools, and picks the nearest one. The flag is what lets the answer be honest.
   */
  return scored.length ? { names: scored.map((s) => s.name), noMatch: false } : { names, noMatch: true };
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
      const { names, noMatch } = searchTools(String(params.query ?? ''));
      const lines = names.map(catalogLine).filter(Boolean);
      if (!lines.length) {
        return 'There is nothing else available. Tell the user plainly that you cannot do that today.';
      }
      const head = noMatch
        ? 'NOTHING matches that. Here is everything there is — if none of it is what they asked for, say so ' +
          'plainly ("I do not have a way to do that today") rather than using the nearest thing and calling it ' +
          'an answer:'
        : 'These are now LOADED and callable by name, right now, in your next step:';
      const tail =
        'Call the one you need directly, by its own name, now — they are real tools this turn, not a menu. ' +
        'Do not describe them to the user instead of using them.';
      return boundToolResponse([head, ...lines, tail].join('\n'));
    },
  },

  [USE_TOOL_NAME]: {
    name: USE_TOOL_NAME,
    description:
      'Run one of the things find_tools listed, and get its answer back. Use immediately after find_tools rather than telling the user what you could look up. Most only read; the ones marked [changes their data] take effect immediately and each says so in its own description — read it and honour it before calling. Name the tool exactly as find_tools spelled it: {"name": "get_workout_history", "arguments": {"days": 7}}. Omit "arguments" when it takes none.',
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
      // Only the on-demand TAIL is reachable here. A dossier fact is already in front of her, and
      // an always-on action is declared directly so its own contract sits in her context — routing
      // either through this door would be a second path to something she already has.
      if (!onDemandToolNames().includes(name)) {
        /**
         * Name the REASON, never just the absence. "Call find_tools to see the real names" was a
         * deterministic misdirection when the name was a DOSSIER function: get_weight exists — it
         * is hidden because the fact rides her context every turn — and the old text sent her
         * hunting the catalog for something she was holding. Measured on the owner's session
         * (2026-08-20, three turns in a row): use_tool("get_weight") → "call find_tools" →
         * find_tools → round cap → the turn ended with a promise instead of his numbers.
         */
        if ((DOSSIER_FUNCTIONS as readonly string[]).includes(name)) {
          return (
            `"${name}" is not a tool because its answer is ALREADY IN YOUR CONTEXT — the dossier ` +
            'block injected above carries it every turn. Do not call anything for it: read it from ' +
            'your context and answer the user now.'
          );
        }
        if ((ALWAYS_ACTIONS as readonly string[]).includes(name)) {
          return (
            `"${name}" is already declared directly in your tool list — call it by name as a ` +
            'normal tool, not through this door.'
          );
        }
        return `There is no readable tool called "${name}". Call ${FIND_TOOLS_NAME} to see the real names.`;
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      // A demoted ACTION runs its own `run()`, so its contract — propose-then-tap, or immediate —
      // is enforced by the tool itself exactly as it would be if it had been called directly.
      // Being reached through a door does not soften what it does.
      const action = COACH_ACTION_TOOLS[name];
      if (action) {
        try {
          return await action.run(userId, args);
        } catch (e) {
          console.error('[use_tool] action failed:', name, e);
          return 'That could not be done just now — tell the user plainly and offer to try again.';
        }
      }

      const fn = RETRIEVAL_FUNCTIONS[name]!;
      const { results } = await executeCalls(userId, [{ fn: name, params: args }], { logLabel: 'use-tool' });
      try {
        const out = fn.render(results[name]);
        return boundToolResponse(out || toolEmptyText(name));
      } catch (e) {
        // Same rule as the direct read path: a fault must never read as an empty record.
        console.error('[use_tool] render failed:', name, e);
        return toolFaultText(name);
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
