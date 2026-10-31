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
import { runJobBySlug } from '../ai/aim.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { enterEpisode, reviseEpisodeEquipment } from './episode.ts';
import { hasDetourSignal, hasEquipmentSignal } from './detour-signal.ts';
import { normalizeDetour, normalizeEquipmentUpdate } from './detour-normalize.ts';

// Re-exported so existing callers and tests keep one import; the probe imports detour-normalize.ts.
export { normalizeDetour, normalizeEquipmentUpdate };

export interface DetourCaptureOutcome {
  ran: boolean;
  entered: boolean;
  reason:
    | 'no_signal'
    | 'no_agreement'
    | 'invalid'
    | 'no_plan'
    | 'entered'
    | 'equipment_revised'
    | 'equipment_unchanged'
    | 'no_update';
}

/**
 * Run after a coach turn, sharing ambient capture's window. Fire-and-forget at the call site —
 * a detour landing one turn late is fine; a chat turn blocking on it is not.
 */
export async function runDetourCapture(userId: string, conversationWindow: string): Promise<DetourCaptureOutcome> {
  const active = await getActiveEpisode(userId);

  // UPDATE mode — the "I'll only know when I get there" case (owner, 2026-08-04): a detour was
  // entered on schedule alone, and the equipment answer arrives mid-window. The job is told about
  // the active episode and may ONLY report newly-stated equipment; entering is off the table (one
  // detour at a time), which is also what keeps re-reading the old confirmed exchange a no-op.
  // The deterministic churn guard lives in reviseEpisodeEquipment: same names, nothing happens.
  if (active) {
    if (!hasEquipmentSignal(conversationWindow)) return { ran: false, entered: false, reason: 'no_signal' };
    const res = await runJobBySlug(userId, 'capture-detour', {
      conversation_window: conversationWindow,
      active_episode: JSON.stringify({
        type: active.type,
        start: active.start,
        end: active.end,
        available_equipment: active.available_equipment ?? [],
      }),
    });
    const update = normalizeEquipmentUpdate(String(res.formatted ?? res.raw ?? 'null'));
    if (!update) return { ran: true, entered: false, reason: 'no_update' };
    const r = await reviseEpisodeEquipment(userId, update);
    return {
      ran: true,
      entered: false,
      reason: r.reason === 'revised' ? 'equipment_revised' : 'equipment_unchanged',
    };
  }

  // ENTER mode — no episode yet; consent is the only trigger.
  if (!hasDetourSignal(conversationWindow)) return { ran: false, entered: false, reason: 'no_signal' };
  const res = await runJobBySlug(userId, 'capture-detour', {
    conversation_window: conversationWindow,
    active_episode: '',
  });
  const input = normalizeDetour(String(res.formatted ?? res.raw ?? 'null'));
  if (!input) return { ran: true, entered: false, reason: 'no_agreement' };

  const entered = await enterEpisode(userId, input);
  if (!entered) return { ran: true, entered: false, reason: 'no_plan' };
  return { ran: true, entered: true, reason: 'entered' };
}
