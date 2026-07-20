import { BASE, headers } from './http.ts';

/** Dev-only: wipe the current account's data (goals, plan, chat, baseline). */
export async function resetAccount(): Promise<void> {
  const res = await fetch(`${BASE}/dev/reset`, { method: 'POST', headers: headers() });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

/* ── Dev "X-ray" trace ─────────────────────────────────────────── */
export interface DevTrace {
  updatedAt?: string;
  empty?: boolean;
  persona?: string | null;
  context?: {
    mode: string;
    selectReason: string;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown> }>;
    data: Record<string, unknown>;
    rendered: string;
  } | null;
  scribeSelect?: { calls: Array<{ fn: string; params: Record<string, unknown> }>; reason: string } | null;
  scribeSummarize?: { output: string } | null;
  turnSelect?: {
    calls: Array<{ fn: string; params: Record<string, unknown> }>;
    reason: string;
    injected: boolean;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown>; at?: string }>;
    fallback?: boolean;
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

export async function getTrace(): Promise<DevTrace> {
  const res = await fetch(`${BASE}/coach/trace`, { headers: headers() });
  if (!res.ok) throw new Error(`getTrace failed: ${res.status}`);
  return res.json();
}

export interface AiLogEntry {
  kind: string;
  input: unknown;
  output: unknown;
  meta: unknown;
  created_at: string;
}
export async function getCoachLog(): Promise<{ entries: AiLogEntry[] }> {
  const res = await fetch(`${BASE}/coach/log`, { headers: headers() });
  if (!res.ok) return { entries: [] };
  return res.json();
}
