/**
 * The conversational door into disrupted mode (REQ4 entry path #2, extended 2026-08-04).
 *
 * The user tells the coach they're travelling; the coach asks the two things a re-plan can't run
 * without — how long, and what they'll have with them — then confirms what it heard and offers to
 * set it up. **The user's plain yes in conversation is the trigger.** No banner re-asking what
 * they just said: BRAND's "confirm before you commit" happened IN the exchange, which is exactly
 * where it belongs. (The banner path stays for tripwires, where the system is guessing from a
 * timezone jump and a guess does need a separate confirm.)
 *
 * The two-speed split holds (REQ10 §11): the coach only talks. After the turn, this module — the
 * Broker — reads the same window ambient capture uses and acts on a CONFIRMED agreement:
 *
 *   gate (deterministic, no LLM when silent) → capture-detour job → normalize → enterEpisode
 *
 * Every layer fails closed. No signal → no job. No explicit yes → `detour: null` → nothing. An
 * episode already active → no re-entry (also what makes the rolling window idempotent: the same
 * confirmed exchange re-captured next turn is a no-op). Junk type, absurd days, oversized
 * equipment → clamped or dropped app-side, never trusted from the model.
 */
import type { CaptureDetourResult } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { enterEpisode } from './episode.ts';
import { hasDetourSignal } from './detour-signal.ts';

const EPISODE_TYPES = new Set(['travel', 'illness', 'injury', 'recovery', 'custom']);
const MAX_DAYS = 60;
const MAX_EQUIPMENT = 20;

export interface DetourCaptureOutcome {
  ran: boolean;
  entered: boolean;
  reason: 'no_signal' | 'episode_active' | 'no_agreement' | 'invalid' | 'no_plan' | 'entered';
}

/** Parse + clamp the job's output into an `enterEpisode` input, or null. Exported for tests. */
export function normalizeDetour(raw: string): {
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  days?: number;
  end?: string;
  available_equipment: Array<{ name: string }>;
} | null {
  let parsed: CaptureDetourResult;
  try {
    parsed = JSON.parse(raw) as CaptureDetourResult;
  } catch {
    return null;
  }
  const d = parsed?.detour;
  // The explicit-assent gate: anything short of a confirmed agreement is conversation, not consent.
  if (!d || d.confirmed !== true) return null;
  if (typeof d.type !== 'string' || !EPISODE_TYPES.has(d.type)) return null;

  const days =
    typeof d.days === 'number' && Number.isFinite(d.days)
      ? Math.min(MAX_DAYS, Math.max(1, Math.round(d.days)))
      : undefined;
  const end = typeof d.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.end) ? d.end : undefined;

  const available_equipment = (Array.isArray(d.available_equipment) ? d.available_equipment : [])
    .map((e) => (e && typeof e.name === 'string' ? e.name.trim().slice(0, 60) : ''))
    .filter(Boolean)
    .slice(0, MAX_EQUIPMENT)
    .map((name) => ({ name }));

  return { type: d.type, days, end, available_equipment };
}

/**
 * Run after a coach turn, sharing ambient capture's window. Fire-and-forget at the call site —
 * a detour landing one turn late is fine; a chat turn blocking on it is not.
 */
export async function runDetourCapture(userId: string, conversationWindow: string): Promise<DetourCaptureOutcome> {
  if (!hasDetourSignal(conversationWindow)) return { ran: false, entered: false, reason: 'no_signal' };

  // Cheaper than the job and fails closed: already on a detour means nothing to capture — and it
  // is what makes re-reading the same confirmed exchange next turn a no-op.
  if (await getActiveEpisode(userId)) return { ran: false, entered: false, reason: 'episode_active' };

  const res = await runJobBySlug(userId, 'capture-detour', { conversation_window: conversationWindow });
  const input = normalizeDetour(String(res.formatted ?? res.raw ?? 'null'));
  if (!input) return { ran: true, entered: false, reason: 'no_agreement' };

  const entered = await enterEpisode(userId, input);
  if (!entered) return { ran: true, entered: false, reason: 'no_plan' };
  return { ran: true, entered: true, reason: 'entered' };
}
