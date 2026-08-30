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
  TURN_FLOOR_FUNCTIONS,
  DRAWER_HOOKS,
  TOOL_CATEGORIES,
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

/**
 * The drawer's label (owner ruling 2026-08-30 — coach-tool-tiers.ts, above DRAWER_HOOKS): the
 * carried find_tools description IS the index of what she could go looking for — the categories
 * she already knows, each member with its hook — generated, never hand-written. The old
 * hand-written version listed READ topics only, so a tail ACTION was invisible by the drawer's
 * own signage; the label she now reads in the same generation that decides is the cheap
 * experiment against the measured follow-through failure (see the tiers doc — kept distinct
 * there, honestly). Bounded by coach-drawer-index.test.ts so it stays cheap as the tail grows.
 */
function drawerLabel(): string {
  const sections = TOOL_CATEGORIES.map(
    ({ label, members }) =>
      `${label}: ` +
      members
        .map((name) => `${name} (${DRAWER_HOOKS[name] ?? ''})${isActionName(name) ? ' [changes their data]' : ''}`)
        .join('; ') +
      '.',
  );
  return [
    'The rest of your toolkit, by area — none of it is loaded until you ask. Use this whenever the turn touches one of these areas and you are not already holding the tool for it: pass {"query": "..."} to search, or omit it to list everything, then call use_tool with what you find. Looking does NOT change anything; tools marked [changes their data] follow their own contracts when run.',
    ...sections,
  ].join('\n');
}

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
  /**
   * Dossier facts the query was reaching for — she already has these, they are not tools she can
   * call, and saying so is the whole point. See `dossierMatches`.
   */
  alreadyHave: string[];
}

/**
 * Dossier facts a search is reaching for.
 *
 * Dossier functions are deliberately absent from `onDemandToolNames()`, so a search for one used to
 * return the nearest unrelated tools under the heading "These are now LOADED and callable by name".
 * That is not a near-miss, it is a wrong answer with a confident heading — and it cost two days.
 *
 * Measured 2026-08-22: asked to set nutrition targets, she needed a weight. `find_tools("weight,
 * height, age, body stats")` answered with `get_practice_totals` and `get_goal_progress`; she tried
 * them, learned nothing, searched again, and across 12 turns never once reached
 * `set_macro_targets`. Every call succeeded and none of them could have worked. The fact was in the
 * database the whole time.
 *
 * So a query that reaches for a dossier fact now gets told it already has it, by name. Matching is
 * the same generous term-overlap the tool search uses, over the fact's own description.
 */
function dossierMatches(query: string): string[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return [];
  return (DOSSIER_FUNCTIONS as readonly string[]).filter((name) => {
    const f = RETRIEVAL_FUNCTIONS[name];
    const hay = `${name} ${f?.description ?? ''} ${(f?.domains ?? []).join(' ')}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
}

export function searchTools(query: string): ToolSearchResult {
  const names = onDemandToolNames();
  const alreadyHave = dossierMatches(query);
  const q = query.trim().toLowerCase();
  if (!q) return { names, noMatch: false, alreadyHave };

  // A category name is the fast path — the manifest teaches those, so she will use them.
  const byCategory = categoryMembers(q);
  if (byCategory.length) return { names: byCategory, noMatch: false, alreadyHave };

  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return { names, noMatch: false, alreadyHave };
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
  return scored.length
    ? { names: scored.map((s) => s.name), noMatch: false, alreadyHave }
    : { names, noMatch: true, alreadyHave };
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
    description: drawerLabel(),
    parameters: {
      properties: {
        query: {
          type: 'string',
          description: 'What you are looking for, in plain words, e.g. "workouts". Omit to list everything.',
        },
      },
    },
    async run(_userId, params) {
      const { names, noMatch, alreadyHave } = searchTools(String(params.query ?? ''));
      const lines = names.map(catalogLine).filter(Boolean);

      /**
       * What she already has comes FIRST, and when it answers the question the tool list is not
       * shown at all.
       *
       * Body facts, constraints, identity and the rest ride her context — they are not tools, so
       * this search cannot return them, and it used to answer a query about them with the nearest
       * unrelated tools under the heading "These are now LOADED and callable by name". She would
       * call those, learn nothing, and search again. Across 12 turns on 2026-08-22 that loop kept
       * her from ever calling `set_macro_targets`, with the weight sitting in the database.
       *
       * Listing them ahead of a tool list she does not need is the difference between an answer
       * and a detour.
       */
      const have = alreadyHave.length
        ? [
            'You ALREADY HAVE these — they are in the context you were given for this turn, above. ' +
              'Read them there; they are facts, not tools, and there is nothing to call:',
            ...alreadyHave.map((n) => `- ${n}: ${RETRIEVAL_FUNCTIONS[n]?.description ?? ''}`.trimEnd()),
          ]
        : [];

      if (have.length && !lines.length) return boundToolResponse(have.join('\n'));
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
      return boundToolResponse([...have, ...(have.length ? [''] : []), head, ...lines, tail].join('\n'));
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
        /**
         * Only say "you already have it" when she DOES.
         *
         * The old text said the dossier block "carries it every turn" for all seven dossier facts,
         * and the per-turn floor re-sent three. So for `get_weight`, `get_dietary_profile`,
         * `get_objectives`, `get_consistency` and `get_health_history` this was a confident refusal
         * pointing at nothing: the session-open pack had them, AI Admin's compaction eventually did
         * not, and by then no route reached them at all.
         *
         * `get_weight` is now in the floor, so the claim is true for it. For the rest the honest
         * move is not a better sentence — it is to RUN THE THING. A fact she cannot see and cannot
         * fetch is worse than a redundant read, and `get_dietary_profile` carries allergies.
         */
        if ((TURN_FLOOR_FUNCTIONS as readonly string[]).includes(name)) {
          return (
            `"${name}" is not a tool because its answer is ALREADY IN YOUR CONTEXT — the dossier ` +
            'block injected above carries it every turn. Do not call anything for it: read it from ' +
            'your context and answer the user now.'
          );
        }
        if ((DOSSIER_FUNCTIONS as readonly string[]).includes(name)) {
          const fact = RETRIEVAL_FUNCTIONS[name];
          if (fact) {
            try {
              const out = await fact.run(userId, {});
              const rendered = fact.render ? fact.render(out) : String(out ?? '');
              return boundToolResponse(
                rendered.trim()
                  ? rendered
                  : `Nothing is on file for ${name}. Ask the user rather than estimating, and write down what they tell you.`,
              );
            } catch (e) {
              console.error('[use_tool] dossier read failed:', name, e);
              return `Could not read ${name} just now. Say so plainly rather than guessing at it.`;
            }
          }
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
