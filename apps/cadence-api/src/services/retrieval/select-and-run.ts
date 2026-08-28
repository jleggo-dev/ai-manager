/**
 * Shared select-and-run helpers for the retrieval semantic layer
 * (MEMORY-ARCHITECTURE.md §4.1 / §4.3).
 *
 * Both the standing context pack (`context-pack.ts`) and per-turn just-in-time retrieval
 * (`turn-context.ts`) ask a Broker job for function names, then validate + execute app-side.
 * The model never reaches an unknown function and never runs queries.
 */
import { RETRIEVAL_FUNCTIONS } from './registry.ts';
import type { ProvenanceEntry } from '../../repos/context-pack.ts';

export interface FnCall {
  fn: string;
  params: Record<string, unknown>;
}

export interface ExecuteCallsResult {
  results: Record<string, unknown>;
  provenance: ProvenanceEntry[];
  /**
   * The same calls, kept apart. `results` is keyed by function NAME, so two calls to the same
   * read in one round collide — `results[fn] = result` lets the second silently overwrite the
   * first (MP0e, found by the 2026-08-23 gap-map audit). It is a live path: `coach-tools.ts`
   * batches a whole round of parallel model tool calls through one `executeCalls`, and the model
   * is free to call `check_food_sources` twice with two different queries in that round — today
   * both toolCallIds would be answered with whichever query ran last.
   *
   * `perCall` is positional instead of keyed: one entry per INPUT call, same order, same length —
   * including a call that named an unknown function or whose `run` threw, both recorded as
   * `result: undefined` so the array never shifts out of alignment with `calls`. A caller can
   * therefore zip `calls[i]` with `perCall[i]` and never re-derive an answer by name.
   *
   * `result: undefined` on failure is not a new contract — it is `results[fn]`'s existing
   * "unset means fault" meaning (`check_food_sources` tells that apart from a legitimate `null`;
   * see the loop below), carried onto this field so adopting it does not require re-learning what
   * absence means. `results`/`provenance` are UNCHANGED by this addition — every current caller
   * keeps today's behaviour exactly; only a caller that switches to `perCall` gets the fix.
   */
  perCall: PerCallResult[];
}

/** One call's own result, positional rather than name-keyed. See `ExecuteCallsResult.perCall`. */
export interface PerCallResult {
  fn: string;
  params: Record<string, unknown>;
  result: unknown;
}

/**
 * Drop unknown / malformed model-chosen calls. Only registry-known names survive, and
 * non-object params become `{}`.
 */
export function validateCalls(raw: unknown): FnCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is { fn: string; params?: unknown } =>
        !!c && typeof (c as { fn?: unknown }).fn === 'string' && !!RETRIEVAL_FUNCTIONS[(c as { fn: string }).fn],
    )
    .map((c) => ({
      fn: c.fn,
      params: c.params && typeof c.params === 'object' ? (c.params as Record<string, unknown>) : {},
    }));
}

/**
 * Execute validated registry calls. Per-function failures are logged and skipped so one
 * broken retrieval never aborts the pack/turn.
 */
export async function executeCalls(
  userId: string,
  calls: FnCall[],
  opts: { at?: string; logLabel?: string } = {},
): Promise<ExecuteCallsResult> {
  const at = opts.at ?? new Date().toISOString();
  const logLabel = opts.logLabel ?? 'select-and-run';
  const results: Record<string, unknown> = {};
  const provenance: ProvenanceEntry[] = [];
  const perCall: PerCallResult[] = [];

  for (const { fn, params } of calls) {
    const f = RETRIEVAL_FUNCTIONS[fn];
    if (!f) {
      // Unknown function — today's callers pre-filter with `validateCalls`/`coachToolNames()`, so
      // this should not happen live, but a skipped entry here would still shift `perCall` out of
      // step with `calls`. Record it as a fault rather than dropping it.
      perCall.push({ fn, params, result: undefined });
      continue;
    }
    try {
      const result = await f.run(userId, params);
      results[fn] = result;
      provenance.push({ fn, params, rows: f.rows(result), at });
      perCall.push({ fn, params, result });
    } catch (e) {
      console.error(`[${logLabel}] ${fn} failed:`, e);
      perCall.push({ fn, params, result: undefined });
    }
  }

  return { results, provenance, perCall };
}
