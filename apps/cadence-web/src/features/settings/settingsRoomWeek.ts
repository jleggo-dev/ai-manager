/**
 * "WEEK N" — the Settings Room header's mono sub-line (design owner-approved 2026-08-31).
 *
 * Sourced from the Supabase session's `user.created_at`, the cheapest fact the client already
 * has: `supabase.auth.getSession()` resolves from the persisted session without a network round
 * trip in the common case. Dev mode has no real session at all, so there is nothing honest to
 * compute — the header omits WEEK entirely rather than fake a number (design's own instruction:
 * "if none is cheaply available, omit the WEEK segment rather than faking it").
 */

/** Week 1 covers days 0–6 since account creation, week 2 covers 7–13, and so on. Null on any
 *  unparseable or future-dated input — never a guess. */
export function weeksSinceCreation(createdAtIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!createdAtIso) return null;
  const created = new Date(createdAtIso).getTime();
  if (!Number.isFinite(created)) return null;
  const days = Math.floor((now.getTime() - created) / 86_400_000);
  if (days < 0) return null;
  return Math.floor(days / 7) + 1;
}

/** The header's sub-line: "email · WEEK N", either half optional, joined only where both exist. */
export function buildRoomSubLine(base: string, weekN: number | null): string {
  if (weekN == null) return base;
  const weekText = `WEEK ${weekN}`;
  return base ? `${base} · ${weekText}` : weekText;
}
