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
import { injectCoachContext } from '../ai/aim.ts';
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
export async function injectTurnContext(userId: string, sessionId: string, message: string): Promise<void> {
  const sel = await turnSelect(userId, message);

  // Nothing to do — but STILL record it, so the X-ray shows the turn was assessed (empty or failed).
  if (!sel || sel.calls.length === 0) {
    updateTrace(userId, {
      turnSelect: {
        calls: sel?.calls ?? [],
        reason:
          sel?.reason || (sel === null ? '(select failed — skipped)' : '(standing pack already covers this turn)'),
        injected: false,
        provenance: [],
        fallback: sel === null,
      },
    });
    void logAi(userId, {
      kind: 'context_select',
      sessionId,
      input: { turn: message },
      output: sel ?? { fallback: true },
      meta: { fns: [], injected: false },
    });
    return;
  }

  // Step 2 — EXECUTE the chosen functions app-side (the semantic layer; model never runs queries).
  const at = new Date().toISOString();
  const { results, provenance } = await executeCalls(userId, sel.calls, {
    at,
    logLabel: 'turn-context',
  });
  const parts: string[] = [];
  for (const { fn } of provenance) {
    const f = RETRIEVAL_FUNCTIONS[fn];
    const rendered = f?.render(results[fn]);
    if (rendered) parts.push(rendered);
  }

  const fns = provenance.map((p) => p.fn);
  const injected = parts.length > 0;

  // Record BY NAME (trace + durable log) whether or not anything rendered.
  updateTrace(userId, { turnSelect: { calls: sel.calls, reason: sel.reason, injected, provenance } });
  void logAi(userId, {
    kind: 'context_select',
    sessionId,
    input: { turn: message },
    output: { calls: sel.calls, reason: sel.reason },
    meta: { fns, injected },
  });

  // Step 3 — inject as a non-triggering context turn right before the user's message.
  if (!injected) return;
  const block = [
    `Fetched for this turn (${fns.join(', ')})${sel.reason ? ` — ${sel.reason}` : ''}:`,
    parts.join('\n'),
  ].join('\n');
  await injectCoachContext(userId, sessionId, block, { source: 'turn-context', version: 1 }).catch((e) =>
    console.error('[turn-context inject]', e),
  );
}
