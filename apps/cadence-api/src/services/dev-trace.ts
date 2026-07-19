/**
 * Dev "X-ray" trace — an in-memory, per-user snapshot of the last behind-the-scenes AI
 * activity, surfaced by GET /coach/trace for the developer panel. NOT durable (cleared on
 * restart) and dev-only; it never affects the coaching path. v1.5 can enrich entries with
 * exact AI Admin diagnostics.
 */
export interface DevTrace {
  updatedAt: string;
  /** The context pack: what data was pulled + how it was curated. */
  context?: {
    mode: string;
    selectReason: string;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown>; at?: string }>;
    data: Record<string, unknown>;
    rendered: string;
  } | null;
  scribeSelect?: { calls: Array<{ fn: string; params: Record<string, unknown> }>; reason: string } | null;
  scribeSummarize?: { output: string } | null;
  /** Per-turn just-in-time retrieval (§4.3): which registry fns the Scribe chose for THIS turn,
   *  whether anything was injected, and the executed provenance (fn + rows). Recorded every turn
   *  — including the empty case — so the X-ray shows the turn WAS assessed. */
  turnSelect?: {
    calls: Array<{ fn: string; params: Record<string, unknown> }>;
    reason: string;
    injected: boolean;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown>; at?: string }>;
    fallback?: boolean; // the Scribe select failed and we skipped just-in-time retrieval
  } | null;
  coach?: {
    user: string;
    reply: string;
    model: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
  } | null;
  capture?: unknown;
}

const traces = new Map<string, DevTrace>();

export function updateTrace(userId: string, patch: Partial<DevTrace>): void {
  const cur = traces.get(userId) ?? { updatedAt: '' };
  traces.set(userId, { ...cur, ...patch, updatedAt: new Date().toISOString() });
}

export function getTrace(userId: string): DevTrace | null {
  return traces.get(userId) ?? null;
}

/** Drop a user's in-memory trace — called on dev reset so the X-ray doesn't show stale activity
 *  from before the wipe (the DB tables clear, but this map lives in-process and would otherwise
 *  keep serving the pre-reset context/prompts/coach/scribe cards). */
export function clearTrace(userId: string): void {
  traces.delete(userId);
}
