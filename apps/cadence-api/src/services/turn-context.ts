/**
 * Per-turn just-in-time retrieval (MEMORY-ARCHITECTURE.md §4.3) — the interim step toward the
 * agentic retrieval loop (PLAN.md "Final step"). The standing context pack is a single guess
 * curated at session-open; between turns it goes stale. This runs a cheap Broker pass on THIS
 * turn (`context-select`), decides which registry functions to call, executes them app-side
 * (governed — the model never runs queries), and injects the result as a NON-triggering
 * `<context source="turn-context">` turn just before the user's message — so fresh, turn-relevant
 * data sits next to what the user just asked, without the coach having to re-fetch the whole pack.
 *
 * Injected as a separate `<context>` turn (NOT prepended to the user message) so the user's turn
 * stays clean: `/coach/current` and the capture window both drop `<context`-prefixed turns, so a
 * prepend would leak the block into the restored chat and pollute capture.
 *
 * Best-effort: any failure (or an empty selection) leaves the turn untouched. Every path records
 * the chosen functions BY NAME into the X-ray trace + durable ai_log, so a turn that fetched
 * nothing is still visibly assessed.
 */
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { validateCalls, executeCalls, type FnCall } from './retrieval/select-and-run.ts';
import { renderCatalogDoc } from './retrieval/catalog.ts';
import { runJobBySlug } from '../ai/aim.ts';
import { getCoachHistory, injectCoachContext } from '../ai/aim.ts';
import { classifyFreshness, renderContextBlock, type RenderedPart } from './turn-context-memory.ts';
import { updateTrace } from './dev-trace.ts';
import { logAi } from './ai-log.ts';

/**
 * Step 1 — Broker turn-select: given THIS turn + the function catalog, choose which registry
 * functions (if any) to fetch just-in-time. Returns null on any failure (caller skips retrieval),
 * or `{ calls: [], reason }` when the standing pack already covers the turn. Validates every
 * chosen name against the registry (the model never reaches an unknown function).
 */
async function turnSelect(userId: string, message: string): Promise<{ calls: FnCall[]; reason: string } | null> {
  try {
    const catalog = await renderCatalogDoc(userId);
    const res = await runJobBySlug(userId, 'context-select', { turn: message, catalog });
    const parsed = JSON.parse(res.formatted ?? res.raw ?? '{}') as { calls?: unknown; reason?: unknown };
    const calls = validateCalls(parsed.calls);
    return { calls, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (e) {
    console.error('[context-select] failed, skipping just-in-time retrieval:', e);
    return null;
  }
}

/**
 * Run the just-in-time retrieval for one coach turn. Side effects only: injects a `<context>` turn
 * into the AI Admin session (when something is fetched) and records the tool calls by name into the
 * X-ray trace + ai_log. Never throws; the caller sends the user's message unchanged regardless.
 */
/**
 * Every context block this session has already been given, as one searchable string. Only the
 * app-authored `<context` turns — the user's own words are not a record of what she was handed.
 */
async function priorInjectedContext(userId: string, sessionId: string): Promise<string> {
  try {
    const hist = (await getCoachHistory(userId, sessionId)) as { messages?: unknown; data?: unknown };
    const msgs = (hist.messages ?? hist.data ?? []) as Array<{ content?: string }>;
    return msgs
      .map((m) => m.content ?? '')
      .filter((c) => c.startsWith('<context'))
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * The FLOOR — retrieved every turn, whatever the Broker decides.
 *
 * `context-select` is the cheapest model in the stack making an unreviewable judgment about what
 * the strongest one needs, and until now it had a veto: return `calls: []` and the turn ran on
 * whatever the session-open pack happened to hold. Worse, a select that FAILED outright took the
 * identical code path as a considered "nothing needed" — a silent breakage and a confident
 * decision were indistinguishable in the logs and in the outcome.
 *
 * It fired on 2026-08-16. The owner said "let's start by changing the farmer carries to dead
 * hangs"; the selector returned nothing ("a straightforward exercise substitution"), on the exact
 * turn where naming the commitment correctly is the whole job — `propose_plan_change` matches
 * activities by their title as the plan lists them. It worked because the session-open snapshot
 * was still good. That is luck, not design.
 *
 * So the Broker can now only ever ADD. These three are the ones whose absence is a product
 * failure rather than an inconvenience:
 *  - `get_identity` — she must not have to ask a returning user their name.
 *  - `get_constraints` — safety. Nothing about training is safe to say without it.
 *  - `get_active_plan` — every plan edit names commitments exactly as the plan lists them, and the
 *    plan is the one dossier fact that changes DURING a conversation (she changes it herself).
 *
 * Cheap, and cheaper than it looks: re-injecting identical content is marked `unchanged` by the
 * freshness classifier, so it reads as a reminder she already has rather than as news — the fix
 * that stopped her re-reading the same numbers back three times (turn-context-memory.ts). We do
 * not skip re-sending it: surviving AI Admin's session compaction is the entire reason this
 * mechanism exists.
 */
const TURN_FLOOR = ['get_identity', 'get_constraints', 'get_active_plan'] as const;

/** Floor first, then whatever the Broker chose, minus duplicates. Order matters only for reading. */
function withFloor(chosen: FnCall[]): FnCall[] {
  const seen = new Set<string>();
  const out: FnCall[] = [];
  for (const fn of TURN_FLOOR) {
    if (RETRIEVAL_FUNCTIONS[fn] && !seen.has(fn)) {
      seen.add(fn);
      out.push({ fn, params: {} });
    }
  }
  for (const c of chosen) {
    if (!seen.has(c.fn)) {
      seen.add(c.fn);
      out.push(c);
    }
  }
  return out;
}

export async function injectTurnContext(userId: string, sessionId: string, message: string): Promise<void> {
  const sel = await turnSelect(userId, message);
  /**
   * A failed select and a considered "nothing needed" are DIFFERENT and no longer share a path.
   * Both still get the floor; only one of them is a fault worth seeing in the trace.
   */
  const selectFailed = sel === null;
  const calls = withFloor(sel?.calls ?? []);
  const reason = selectFailed
    ? '(select failed — floor only)'
    : sel!.reason || '(standing pack covers this turn — floor only)';

  // Step 2 — EXECUTE the chosen functions app-side (the semantic layer; model never runs queries).
  const at = new Date().toISOString();
  const { results, provenance } = await executeCalls(userId, calls, {
    at,
    logLabel: 'turn-context',
  });
  // What she has already been handed in this session, so identical data can be framed as a
  // reminder rather than as news (turn-context-memory.ts). Best-effort: an unreadable history
  // means everything reads as new, which is precisely the old behaviour.
  const priorContext = await priorInjectedContext(userId, sessionId);
  const parts: RenderedPart[] = [];
  for (const { fn } of provenance) {
    const f = RETRIEVAL_FUNCTIONS[fn];
    const rendered = f?.render(results[fn]);
    if (rendered) parts.push({ fn, rendered, freshness: classifyFreshness(priorContext, fn, rendered) });
  }

  const fns = provenance.map((p) => p.fn);
  const injected = parts.length > 0;

  // Record BY NAME (trace + durable log) whether or not anything rendered.
  updateTrace(userId, { turnSelect: { calls, reason, injected, provenance, fallback: selectFailed } });
  void logAi(userId, {
    kind: 'context_select',
    sessionId,
    input: { turn: message },
    output: { calls, reason, chose: sel?.calls ?? [] },
    meta: { fns, injected, floor: [...TURN_FLOOR], selectFailed },
  });

  // Step 3 — inject as a non-triggering context turn right before the user's message.
  if (!injected) return;
  const block = renderContextBlock(parts, reason);
  await injectCoachContext(userId, sessionId, block, { source: 'turn-context', version: 1 }).catch((e) =>
    console.error('[turn-context inject]', e),
  );
}
