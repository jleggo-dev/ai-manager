/**
 * Shared select-and-run helpers for the retrieval semantic layer
 * (MEMORY-ARCHITECTURE.md §4.1 / §4.3).
 *
 * Both the standing context pack (`context-pack.ts`) and per-turn just-in-time retrieval
 * (`turn-context.ts`) ask a Scribe job for function names, then validate + execute app-side.
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

  for (const { fn, params } of calls) {
    const f = RETRIEVAL_FUNCTIONS[fn];
    if (!f) continue;
    try {
      const result = await f.run(userId, params);
      results[fn] = result;
      provenance.push({ fn, params, rows: f.rows(result), at });
    } catch (e) {
      console.error(`[${logLabel}] ${fn} failed:`, e);
    }
  }

  return { results, provenance };
}
