/**
 * Keeps the Coach's live chat session grounded in the current date. The persona (system
 * prompt) has to stay static/cacheable, and the session-open context pack is built once and
 * then reused indefinitely (a returning user's session is restored, not reopened — see
 * GET /coach/current) — so without this, the coach's only notion of "today" is whatever day
 * the session happened to first open, forever. Stamped once per calendar day per user (a cheap
 * in-memory check, no I/O) rather than every turn, so a long-running conversation doesn't
 * accumulate a redundant injected turn on every single message.
 *
 * Keyed by SESSION, not user: a user who was already stamped today can still end up in a
 * brand-new session (dev reset, or any future new-session path) whose history has no date
 * turn yet — keying by user alone would wrongly skip it. sessionId is globally unique, so
 * this always stamps a session's first turn and then re-stamps only when the day rolls over.
 */
import { injectCoachContext } from '../ai/aim.ts';

const lastStamped = new Map<string, string>();

function todayLabel(): { iso: string; label: string } {
  const d = new Date();
  // Both derived from the SAME (UTC) calendar day — see the matching note in ai/aim.ts's
  // clockVars(). Without timeZone: 'UTC' here, this label can name the wrong weekday.
  return {
    iso: d.toISOString().slice(0, 10),
    label: d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
}

/** Best-effort: inject a fresh date stamp into the session if today hasn't been stamped yet. */
export async function ensureDateStamped(userId: string, sessionId: string): Promise<void> {
  const { iso, label } = todayLabel();
  if (lastStamped.get(sessionId) === iso) return;
  lastStamped.set(sessionId, iso);
  await injectCoachContext(userId, sessionId, `Today is ${label} (${iso}).`, { source: 'date', version: 1 }).catch(
    (e) => console.error('[date-context]', e),
  );
}
