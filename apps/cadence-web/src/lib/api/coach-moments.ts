import type { CheckinAdjustment, CoachFaceId, MoodValue, SessionFeedback } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * The coach's face + the two moments that capture how things felt.
 *
 * Every read here degrades to "nothing to show" rather than throwing: a face that fails to load
 * falls back to the brand mark, and a check-in gate that fails resolves to `due:false`. None of
 * these are worth an error state in front of someone who just opened the app.
 */

/**
 * What a face read actually said. `{ ok: true, faceId: null }` is a real answer — "hasn't
 * picked", which renders the brand mark. `{ ok: false }` is NOT an answer: the request failed
 * (a 401 before auth resolved, a 500, a dead socket) and the stored pick is simply unknown.
 *
 * The two used to be the same `null`, and that equivalence is how a portrait "reverted": the
 * paint-before-auth boot (#311) fired this read without a bearer token, the 401 came back as
 * "hasn't picked", and `useEnsureCoachFace` could then persist a RANDOM face over the real one.
 * Failure must never be readable as a choice.
 */
export type CoachFaceRead = { ok: true; faceId: CoachFaceId | null } | { ok: false };

/** GET /me/coach-face — see CoachFaceRead for why failure and "hasn't picked" are kept apart. */
export async function getCoachFace(): Promise<CoachFaceRead> {
  try {
    const res = await fetch(`${BASE}/me/coach-face`, { headers: headers() });
    if (!res.ok) return { ok: false };
    return { ok: true, faceId: ((await res.json()) as { face_id: CoachFaceId | null }).face_id ?? null };
  } catch {
    return { ok: false };
  }
}

/** PUT /me/coach-face — pick a portrait, or pass null to go back to the mark. Throws on failure
 *  (unlike the read): this one is a deliberate user action and silently losing it is worse. */
export async function setCoachFace(faceId: CoachFaceId | null): Promise<CoachFaceId | null> {
  const res = await fetch(`${BASE}/me/coach-face`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ face_id: faceId }),
  });
  if (!res.ok) throw new Error('failed to save coach face');
  return ((await res.json()) as { face_id: CoachFaceId | null }).face_id ?? null;
}

/**
 * POST /me/session-feedback — how the session felt. Fire-and-forget by contract: the celebration
 * is already on screen when this runs, and a network blip must never cost someone their session.
 */
export async function sendSessionFeedback(
  input: SessionFeedback & { occurrence_id?: string | null },
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me/session-feedback`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type DailyCheckinStatus = { due: boolean; date: string | null; reviewing: string | null };

/** GET /me/daily-checkin — should Cadence ask about yesterday? Fails CLOSED. */
export async function getDailyCheckinStatus(): Promise<DailyCheckinStatus> {
  try {
    const res = await fetch(`${BASE}/me/daily-checkin`, { headers: headers() });
    if (!res.ok) return { due: false, date: null, reviewing: null };
    return (await res.json()) as DailyCheckinStatus;
  } catch {
    return { due: false, date: null, reviewing: null };
  }
}

/** POST /me/daily-checkin — mood, an adjustment intent, or "Not now". Best-effort. */
export async function sendDailyCheckin(input: {
  mood?: MoodValue | null;
  adjustment?: CheckinAdjustment | null;
  dismissed?: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me/daily-checkin`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type SessionInsight = { text: string; source: 'last_feedback' | 'last_log' };

/** GET /plan/occurrences/:id/insight — the one thing Cadence noticed, or null (the normal case). */
export async function getSessionInsight(occurrenceId: string): Promise<SessionInsight | null> {
  try {
    const res = await fetch(`${BASE}/plan/occurrences/${occurrenceId}/insight`, { headers: headers() });
    if (!res.ok) return null;
    return ((await res.json()) as { insight: SessionInsight | null }).insight ?? null;
  } catch {
    return null;
  }
}
