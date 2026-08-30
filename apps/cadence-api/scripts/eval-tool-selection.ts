/**
 * TOOL-SELECTION EVAL — given this turn, did she reach for the right tool?
 *
 * MANUAL GATE, NOT CI. It talks to prod, it costs real money per run, and the thing it measures is
 * stochastic. Run it before and after a harness change (HARNESS-V2.md workstream 4) and compare the
 * two numbers; never wire it to a commit hook. There is no pass threshold baked in on purpose —
 * a single number would harden into a target, and the only honest use of this script is a
 * before/after pair on the same day against the same deployment.
 *
 * WHAT IT IS FOR. We have a static description audit (`description-audit.test.ts`, seven checks on
 * the words) and plumbing probes (`probe-tool-loop.ts`, which proves a function_call can survive
 * the wire). Neither asks the only question that has actually cost us anything: given a turn in a
 * real person's voice, does she CALL the tool. Every failure of the week of 2026-08-16 was that
 * question answered wrong, and most often answered by calling nothing at all — she described
 * `propose_plan_change` instead of using it, four turns running, while the owner asked her to
 * change his plan. Scale AI's MCP-Atlas puts 63.3% of tool failures in the cognitive bucket rather
 * than the call-mechanics bucket, dominated by no-tool-use; that is our bug, and this is the only
 * thing in the repo that can see it.
 *
 * HOW IT MEASURES. 33 cases (`eval-tool-selection-cases.ts`), each sourced from something that
 * actually happened, balanced between turns that must fire a tool and turns that must not — the
 * design both Anthropic's `skill-creator` and OpenAI's `eval-skills` land on independently,
 * because a set of only positive cases measures recall and silently ignores false triggering.
 * Scored as micro-averaged precision and recall over tool SELECTIONS, plus the two rates that name
 * the failure modes directly: silence on should-fire turns, and false triggers on should-not.
 * Prompt tokens per turn come off the wire.
 *
 * THE PATH IS THE APP'S PATH. Throwaway Supabase user → real JWT → deployed cadence-api →
 * `POST /coach/sessions/:id/messages` → prod AI Admin → Devs.ai, with the same session-open
 * dossier, the same capability manifest, the same per-turn Broker prefetch and the same
 * `coachToolDefinitions()` the phone gets. Nothing is stubbed and nothing is mocked, which also
 * means: **this measures the DEPLOYED harness, not your working tree.** Merge, wait for Vercel,
 * then run it.
 *
 * WHAT IT CANNOT TELL YOU, and these matter:
 *   1. Every case is a FIRST turn in a fresh conversation. The headline failure of 2026-08-16
 *      needed a history — "can you change the plan? like in the app?" was only wrong because he
 *      had named the change two turns earlier — and nothing here can reproduce it.
 *   2. A read she did not call may have been prefetched. `turn-context` runs `context-select`
 *      before every turn and injects what it chooses, so "she already had it" and "she failed to
 *      fetch it" look identical from outside. The run reads `/coach/trace` after each turn and
 *      CREDITS a prefetched read rather than scoring it as a miss — which is only attributable
 *      one turn at a time, and is why concurrency defaults to 1.
 *   3. Selection is not effect. She can call the right tool with the wrong arguments, or call it
 *      and then describe the result wrongly. A few cases assert arguments; nothing here reads the
 *      card the user would see.
 *   4. It cannot pin the model. The coach profile's primary moved from Sonnet 4.5 to Sonnet 5 on
 *      2026-08-16 mid-incident; the run reports whatever answered, and two runs a week apart may
 *      not be comparable. Read the model line before comparing scores.
 *
 * THE GRADER IS ON TRIAL FIRST. A bad score is a suspect grader until proven otherwise —
 * CORE-Bench went 42% → 95% on grader fixes alone. Two things defend against that here. The
 * observation reuses the app's OWN accumulator (`coach-stream.ts`), so a call this script cannot
 * see is a call the server's tool loop could not have fulfilled either. And the run halts on the
 * instrument signature — NO function call anywhere while several cases expected one — rather than
 * on any single case, which is a rule two rejected canaries paid for (see the case file).
 *
 * FIRST RUNS (2026-08-16, 17 turns across three passes, serial, against the deployment at 7ca5a88,
 * answered by `claude-sonnet-5`). Five findings, THREE OF THEM MINE, which is the entire argument
 * for running a canary before believing a number:
 *   ✗ `suggested_actions` was scored as an invented tool on four of five action cases. It is a
 *     Devs.ai v2 BUILT-IN — a UI affordance emitted on most responses, nothing to do with our
 *     tools. `backend/test/e2e-devs-ai-v2-tools.test.ts` had learned this already. Now filtered as
 *     provider noise and reported separately, so a new built-in still surfaces.
 *   ✗ Two canaries in a row were wrong, and the second was the useful one: a turn that orders her
 *     by tool name ("use your update_goal tool to…") does not fire, even for an action she cannot
 *     satisfy any other way. The persona is why — to the user there is only the coach, never the
 *     machinery — so the most explicit instruction available is the least reliable one. The canary
 *     is now an ordinary, fully-decided plan change, and the gate no longer rests on it alone.
 *   ✗ A read the Broker prefetched was being scored as a miss. On "how much protein is in 100g of
 *     halloumi" the Broker fetched `lookup_food` and she never called it — correctly, the answer
 *     was already in front of her. Reads now count either way and the report says which.
 *   ○ Not a bug, and the most interesting thing here: that prefetch pass is already doing LONG-TAIL
 *     retrieval, not just the dossier. HARNESS-V2's Layer 2 may have less to do than the spec
 *     assumes, because `context-select` is quietly doing much of it a turn early.
 *   ○ Prompt tokens: ~22,150 per turn, against ~4,600 of tool definitions. Definitions are about a
 *     fifth of what the coach pays for; the dossier, persona, capability manifest and pick
 *     protocol are the rest. Worth knowing before "5,000 → 2,500" is called a win.
 *   ✓ A1 — "let's start by changing the farmer carries to dead hangs", the verbatim turn she
 *     answered with advice and no tool on 2026-08-16 — now calls `propose_plan_change`. And C7,
 *     "the 10k feels way too hard right now", read `get_goal_progress` and `get_objectives` and
 *     did NOT touch `update_goal`: the "never on your own read" gate holding, measured.
 *
 * WHAT A FULL RUN COSTS, measured rather than guessed: ~34-45s per case serial, so 33 cases is
 * roughly 20-25 minutes; ~22,150 prompt and ~1,300 completion tokens per turn, so about 730k in
 * and 43k out, which on Sonnet-class pricing is ~$3 a run before the Broker's own per-turn
 * `context-select` call. Cheap enough to run on both sides of a harness change, expensive enough
 * that `--only` exists.
 *
 * Run:
 *   npm run eval:tools -- --dry                    # the case table + token estimate, no network, free
 *   npm run eval:tools -- --only CAN,A1            # a handful — the cheap trial run
 *   npm run eval:tools                             # all 33, one at a time
 *   npm run eval:tools -- --concurrency 3          # faster, and blind to what the Broker prefetched
 *
 * Cost and clock are printed at the end of every run. It cleans up after itself: the auth user and
 * every cadence row it created are deleted on exit, success or failure.
 */
import {
  ACTION_TOOLS,
  CASES,
  KNOWN_TOOLS,
  META_TOOLS,
  PROVIDER_BUILTINS,
  type EvalCase,
} from './eval-tool-selection-cases.ts';
import { dryRun, graderVerdict, header, line, summarize, type Outcome } from './eval-tool-selection-report.ts';
import {
  API,
  missingEnv,
  openSession,
  parseArgs,
  prefetchedFns,
  readTurn,
  setUp,
  tearDown,
  type Observed,
  type World,
} from './eval-tool-selection-world.ts';
import { GET_NUTRITION, NUTRITION_FACADE_COVERS } from '../src/services/retrieval/nutrition-facade.ts';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : (argv[argv.indexOf(hit) + 1] ?? '');
};
const has = (name: string): boolean => argv.includes(`--${name}`) || argv.some((a) => a.startsWith(`--${name}=`));

const DRY = has('dry');
/**
 * ONE AT A TIME BY DEFAULT, and that is a measurement decision rather than politeness. The X-ray
 * (`/coach/trace`) is keyed by user and held in memory on whichever serverless instance answered,
 * so it is only attributable to a turn when exactly one turn is in flight — and without it a read
 * she did not call cannot be told apart from a read the Broker had already handed her. Paying ~40s
 * a case buys the difference between "she missed it" and "she did not need it".
 */
const CONCURRENCY = Math.max(1, Number(flag('concurrency') ?? 1) || 1);
const SERIAL = CONCURRENCY === 1;
const ONLY = (flag('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = Number(flag('limit') ?? 0) || 0;
/** A turn plus its continuation can run past three minutes when the loop fetches twice. */
const TURN_TIMEOUT_MS = 300_000;

/**
 * `--only` takes exact ids ("A1") or a whole group ("A", "CAN"). A prefix only matches a group
 * when what follows it is not a digit, because "--only A1" silently pulling in A10–A13 turns a
 * one-case trial into a five-case bill.
 */
const picked = (id: string, p: string): boolean => id === p || (id.startsWith(p) && !/\d/.test(id[p.length] ?? ''));

function selected(): EvalCase[] {
  let out = CASES;
  if (ONLY.length) out = out.filter((c) => ONLY.some((p) => picked(c.id, p)));
  if (LIMIT) out = out.slice(0, LIMIT);
  return out;
}

/* ══ observing one turn ══════════════════════════════════════════════════════════════════════
 * `readTurn` / `openSession` / `prefetchedFns` / `parseArgs` moved to eval-tool-selection-world.ts
 * (2026-08-30) so this runner and eval-conversation-replay.ts read the stream with ONE copy of
 * the accumulator contract — two hand-kept copies is how one grader keeps passing after a
 * coach-stream change breaks the other. The X-ray gate stays here: the trace is only
 * attributable to a turn when exactly one is in flight, and SERIAL is this runner's knowledge. */

const tracedFns = async (token: string): Promise<string[] | null> => (SERIAL ? prefetchedFns(token) : null);

/* ══ scoring ═════════════════════════════════════════════════════════════════════════════════ */

function score(c: EvalCase, obs: Observed, ms: number, prefetched: string[] | null): Outcome {
  const seen = [...new Set(obs.calls.map((x) => x.name))];
  const builtins = seen.filter((t) => PROVIDER_BUILTINS.has(t));
  const called = seen.filter((t) => !PROVIDER_BUILTINS.has(t));
  /**
   * `find_tools` and `use_tool` are PLUMBING, not choices, so they never count against a case.
   *
   * Most tools are on-demand: they are not in the always-on list, and the only way she can reach
   * one is to look it up with `find_tools` and invoke it. Scoring that required step as an
   * unasked-for call meant correct behaviour on any on-demand tool was penalised for working —
   * B1 ("what have i been writing about lately?") called `find_tools` then `get_journal`, which is
   * exactly the designed path, and failed on precision for it. A case that genuinely wants to
   * assert she did NOT go looking can still say so explicitly via `forbid`, which is checked first.
   */
  const permitted = new Set([...c.expect, ...(c.allow ?? []), ...META_TOOLS]);

  /**
   * A READ she did not call still counts if the Broker fetched it for this turn — the fact
   * reached her either way, which is the thing that matters and the thing HARNESS-V2 calls
   * Layer 0. An ACTION never counts this way: prefetch cannot change anybody's data.
   */
  /**
   * A facade is credited by what it COVERS, not only by its own name (fixed 2026-08-29).
   *
   * The Broker prefetches the underlying reads — `get_food_log`, `get_recipes` — while a case now
   * expects the facade `get_nutrition`, so an exact-name match credited neither. B4 ("what did I
   * actually eat yesterday") was scored as calling nothing at all when the transcript shows her
   * answering correctly from a prefetched food log: *"I've got your food log for the last few days
   * pulled up already."* That is the design working — reads are context, actions are hers — and the
   * scorer was calling it a miss because I mapped the case expectations onto the facade and forgot
   * to map this.
   *
   * Derived from `NUTRITION_FACADE_COVERS` rather than restated here, for the same reason
   * `KNOWN_TOOLS` is derived: a hand-kept copy is what drifted in the first place.
   */
  const covers = (t: string): readonly string[] => (t === GET_NUTRITION.name ? NUTRITION_FACADE_COVERS : []);
  const gotByPrefetch = (t: string): boolean => {
    if (ACTION_TOOLS.has(t)) return false;
    const pre = prefetched ?? [];
    return pre.includes(t) || covers(t).some((u) => pre.includes(u));
  };
  const unmet = c.expect.filter((t) => !called.includes(t));
  const viaPrefetch = unmet.filter(gotByPrefetch);
  const missing = unmet.filter((t) => !gotByPrefetch(t));

  // Every call outside `permitted` is a false positive. `violations` is the named subset the case
  // called out in advance; `extra` is the rest, so each unwanted call is reported exactly once.
  const unwanted = called.filter((t) => !permitted.has(t));
  const violations = unwanted.filter((t) => (c.forbid ?? []).includes(t));
  const extra = unwanted.filter((t) => !violations.includes(t));
  const invented = called.filter((t) => !KNOWN_TOOLS.has(t));

  const argProblems: string[] = [];
  if (c.args && called.includes(c.args.tool)) {
    for (const call of obs.calls.filter((x) => x.name === c.args!.tool)) {
      const problem = c.args.check(parseArgs(call.arguments));
      if (problem) argProblems.push(problem);
    }
  }

  return {
    c,
    called,
    builtins,
    invented,
    missing,
    viaPrefetch,
    extra,
    violations,
    argProblems,
    pass: !missing.length && !extra.length && !violations.length,
    promptTokens: obs.rounds[0]?.prompt ?? null,
    totalCompletion: obs.rounds.reduce((n, r) => n + (r.completion ?? 0), 0),
    ms,
    reply: obs.reply.trim(),
    model: obs.model,
    prefetched,
  };
}

async function runCase(world: World, c: EvalCase): Promise<Outcome> {
  const t0 = Date.now();
  try {
    const sessionId = await openSession(world.token);
    const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${world.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message: c.turn }),
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) throw new Error(`turn failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const obs = await readTurn(res.body);
    return score(c, obs, Date.now() - t0, await tracedFns(world.token));
  } catch (e) {
    return {
      c,
      called: [],
      builtins: [],
      invented: [],
      missing: c.expect,
      viaPrefetch: [],
      extra: [],
      violations: [],
      argProblems: [],
      pass: false,
      promptTokens: null,
      totalCompletion: 0,
      ms: Date.now() - t0,
      reply: '',
      model: null,
      prefetched: null,
      error: String((e as Error)?.message ?? e),
    };
  }
}

/* ══ run ═════════════════════════════════════════════════════════════════════════════════════ */

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const cases = selected();
if (!cases.length) {
  console.error('No cases selected. --only takes ids or id prefixes, e.g. --only A,CAN-POS');
  process.exit(1);
}
if (DRY) {
  await dryRun(cases, KNOWN_TOOLS);
  process.exit(0);
}

const envProblem = missingEnv();
if (envProblem) {
  console.error(envProblem);
  process.exit(1);
}

let world: World | null = null;
try {
  console.log(`── tool-selection eval · ${cases.length} case(s) · ${API} ──\n`);
  world = await setUp();
  header();
  const t0 = Date.now();
  const outcomes = await pool(cases, CONCURRENCY, async (c) => {
    const o = await runCase(world!, c);
    line(o);
    return o;
  });
  const ok = graderVerdict(outcomes);
  if (ok) summarize(outcomes, Date.now() - t0, CONCURRENCY);
  if (!ok || outcomes.some((o) => o.error)) process.exitCode = 1;
} catch (e) {
  console.error('\neval failed:', e);
  process.exitCode = 1;
} finally {
  await tearDown(world);
}
