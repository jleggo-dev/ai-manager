import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { executeCalls } from './retrieval/select-and-run.ts';
import { COACH_ACTION_TOOLS, coachActionDefinitions } from './coach-actions.ts';
import { alwaysOnToolNames, allHarnessToolNames, FIND_TOOLS_NAME } from './coach-tool-tiers.ts';
import { COACH_META_TOOLS, metaToolDefinitions, searchTools } from './coach-meta-tools.ts';
import { boundToolResponse, toolEmptyText, toolFaultText } from './tool-response.ts';
import { logAi } from './ai-log.ts';

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
  /**
   * Both optional, and both exist for one reason: the context block caps the finished group at the
   * 12 most recent and states the total (owner ruling 2026-09-03), so she needs a way to ask for
   * the rest of a several-hundred-item record without it riding every turn. Omit both and the tool
   * behaves exactly as it did before they existed.
   */
  get_repertoire: {
    properties: {
      standing: {
        type: 'string',
        enum: ['queued', 'working', 'known', 'retired'],
        description: 'Read one group only. Omit to read every group.',
      },
      all: {
        type: 'boolean',
        description:
          'Set true with standing "retired" for the whole finished list. Omit and finished is the 12 most recent.',
      },
    },
  },
  get_journal: {
    properties: { limit: { type: 'integer', description: 'How many entries to return (default 8, up to 20).' } },
  },
  /**
   * The nutrition facade's own parameters — MISSING until 2026-08-29, which is why she called it
   * bare and got the wrong answer.
   *
   * `nutrition-facade.ts` collapsed four reads into one with a `view`, and hid the originals so she
   * could never call them. But their TOOL_PARAMS rows stayed and no row was written for the facade,
   * so the one tool she can actually reach declared NO parameters at all — `view` existed only in
   * the description's prose. The 2026-08-29 eval caught it as "right tool, wrong arguments":
   * asked what recipes used chicken thighs, she called `get_nutrition` with `view: undefined`,
   * which the facade defaults to "log". The right tool, answering a different question.
   *
   * `view` is REQUIRED on purpose. It has a default in code so an omission is never a crash, but a
   * default is not an intention — leaving it optional here is what let a bare call look complete
   * while silently choosing for her.
   */
  get_nutrition: {
    properties: {
      view: {
        type: 'string',
        enum: ['log', 'targets', 'recipes', 'lookup'],
        description:
          'Which view: "log" is what they actually ate, "targets" their daily goals and how today ' +
          'is tracking, "recipes" the dishes they have saved, "lookup" nutrition facts for one ' +
          'named food (that one needs q).',
      },
      q: {
        type: 'string',
        description: 'For view "lookup" only — the food to look up, e.g. "halloumi". Ignored otherwise.',
      },
      query: { type: 'string', description: 'For view "recipes" only — search their book by dish name.' },
      limit: { type: 'integer', description: 'For view "lookup" — how many matches (default 5, up to 10).' },
    },
    required: ['view'],
  },
  // MP21/MP40 (FOOD-ENGINE.md §7 §8) — the Coach's write surface. `preview_meal` and `research_food`
  // are reads (no side effects); `log_meal`, the commit half, is an action and declares its own
  // parameters directly on its CoachActionTool entry in coach-actions.ts, so it needs no row here.
  preview_meal: {
    properties: {
      text: {
        type: 'string',
        description: 'Their own words about the food — not your summary of it, e.g. "two eggs, toast and coffee".',
      },
      meal: {
        type: 'string',
        enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'],
        description: 'Which meal, when they said one. Omit and the parse guesses from context.',
      },
    },
    required: ['text'],
  },
  research_food: {
    properties: {
      name: { type: 'string', description: 'What the product is, e.g. "mixed dried mushrooms".' },
      brand: {
        type: 'string',
        description: 'Who makes it, when they named it, e.g. "the wild mushroom co". Omit only if nobody did.',
      },
    },
    required: ['name'],
  },

  read_label: {
    properties: {
      photo_ref: { type: 'string', description: "The photo_ref from this turn's attached photo." },
      mode: {
        type: 'string',
        enum: ['nutrition_label', 'identify'],
        description:
          'Which read to run: the nutrition panel numbers, or a front-of-package name and brand. ' +
          'Default "nutrition_label" when omitted.',
      },
      hint: {
        type: 'string',
        description:
          'Short context to help a hard-to-read photo, such as a product name you already know. ' +
          'Omit if there is nothing to add.',
      },
    },
    required: ['photo_ref'],
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
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A real, callable definition for any registry read — the same shape the always-on ones get. */
function readDefinition(n: string): ToolDefinition | null {
  const fn = RETRIEVAL_FUNCTIONS[n];
  if (!fn) return null;
  return {
    type: 'function' as const,
    function: {
      name: n,
      description: fn.description,
      parameters: {
        type: 'object',
        properties: TOOL_PARAMS[n]?.properties ?? {},
        ...(TOOL_PARAMS[n]?.required ? { required: TOOL_PARAMS[n]!.required } : {}),
      },
    },
  };
}

/**
 * The definitions `find_tools` just revealed, so the NEXT round can declare them and she can call
 * the real tool BY NAME.
 *
 * This is what ToolSearch actually does, and what we were failing to do. We returned prose about a
 * tool and asked her to call a generic `use_tool(name, arguments)` proxy — stringly-typed
 * indirection that bypasses everything a model's tool-calling is trained on. Measured 2026-08-17,
 * with the continuation carrying tools at last: she called `find_tools` on round after round and
 * never once called `use_tool`. Owner, a day earlier: *"progressive disclosure … surely is working
 * for Anthropic's Claude for actions. The problem is something in our design."*
 *
 * Only possible now that `submitV2ToolOutputs` accepts the caller's tools; before that a revealed
 * definition had nowhere to live.
 */
export function revealedDefinitions(calls: CoachToolCall[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const c of calls) {
    if (c.name !== FIND_TOOLS_NAME) continue;
    let query = '';
    try {
      query = String((JSON.parse(c.arguments ?? '{}') as { query?: unknown }).query ?? '');
    } catch {
      /* malformed args → an empty query, which reveals everything rather than nothing */
    }
    for (const name of searchTools(query).names) {
      const def = readDefinition(name) ?? coachActionDefinitions().find((d) => d.function.name === name) ?? null;
      if (def && !out.some((d) => d.function.name === def.function.name)) out.push(def);
    }
  }
  return out;
}

export function coachToolDefinitions(): ToolDefinition[] {
  const reads = COACH_TOOL_NAMES.map((n) => readDefinition(n)!).filter(Boolean);
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

/**
 * Every tool call she makes, written down.
 *
 * Until now nothing recorded WHICH tool ran or what it said back, so diagnosing a bad turn meant
 * inferring tool use from token counts — a continuation reports `promptTokens: 0`, so a zero meant
 * "a tool probably ran". That is archaeology, not evidence, and it left two real failures
 * unresolved on 2026-08-16: she said a run was marked done (no tool ran at all) and said a
 * constraint was removed (a tool ran; the constraint did not move). One of those two questions was
 * answerable and one was not, purely because of what we happened to log.
 *
 * Fire-and-forget: a diagnostic that can delay or fail a turn is worse than no diagnostic.
 */
function recordToolCalls(userId: string, outputs: CoachToolOutput[], calls: CoachToolCall[]): void {
  if (!outputs.length) return;
  const byId = new Map(calls.map((c) => [c.toolCallId, c]));
  void logAi(userId, {
    kind: 'coach_tool',
    input: { calls: calls.map((c) => ({ name: c.name, arguments: c.arguments ?? null })) },
    output: {
      results: outputs.map((o) => ({
        name: byId.get(o.toolCallId)?.name ?? 'unknown',
        // Enough to tell "it worked", "nothing on file" and "it broke" apart at a glance.
        output: o.output.slice(0, 400),
      })),
    },
    meta: { count: outputs.length, names: outputs.map((o) => byId.get(o.toolCallId)?.name ?? 'unknown') },
  }).catch(() => {});
}

export async function executeCoachToolCalls(userId: string, calls: CoachToolCall[]): Promise<CoachToolOutput[]> {
  const known = coachToolNames();
  const wanted = calls.filter((c) => known.has(c.name));
  /**
   * A call we do not recognise is still worth recording — a near-miss name is invisible otherwise,
   * and it ends her turn mid-thought (coach-tool-loop drops unfulfilled calls).
   */
  const unknown = calls.filter((c) => !known.has(c.name));
  if (unknown.length) {
    void logAi(userId, {
      kind: 'coach_tool',
      input: { calls: unknown.map((c) => ({ name: c.name, arguments: c.arguments ?? null })) },
      output: { results: [] },
      meta: { count: 0, names: unknown.map((c) => c.name), unknownName: true },
    }).catch(() => {});
  }
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
  if (!reads.length) {
    recordToolCalls(userId, actionOutputs, wanted);
    return actionOutputs;
  }
  /**
   * `perCall`, not `results` — kept apart by POSITION instead of by function name (MP0e,
   * 2026-08-28). `results[fn] = result` collided when the model called the same read twice in one
   * round with different arguments (`get_nutrition` with two different `view`s is the shape most
   * likely to hit this): both toolCallIds rendered off whichever call happened to run LAST, so one
   * of the two answers was silently wrong — attributed to the wrong question. `perCall` lines up
   * with `reads` one-for-one (same array, same order, passed straight in below), so each call
   * keeps its own result regardless of what any other call in the round was named.
   */
  const { perCall } = await executeCalls(
    userId,
    reads.map((c) => ({ fn: c.name, params: parseArgs(c.arguments) })),
    { logLabel: 'coach-tool' },
  );
  const all = [
    ...actionOutputs,
    ...reads.map((c, i) => {
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
       * which the user can push back on. `perCall[i]?.result` (not `results[c.name]`, see above)
       * is `undefined` on the exact same fault this render is already guarding against, so that
       * distinction (`check_food_sources` tells `undefined` = fault apart from `null` = bad args)
       * survives the swap unchanged.
       */
      try {
        const output = fn.render(perCall[i]?.result);
        return { toolCallId: c.toolCallId, output: boundToolResponse(output || toolEmptyText()) };
      } catch (e) {
        console.error('[coach-tool] render failed:', c.name, e);
        return { toolCallId: c.toolCallId, output: toolFaultText('That') };
      }
    }),
  ];
  recordToolCalls(userId, all, wanted);
  return all;
}
