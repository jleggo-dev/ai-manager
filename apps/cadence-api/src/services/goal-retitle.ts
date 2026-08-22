/**
 * A goal's title, kept honest when its target moves.
 *
 * `update_goal`'s retarget wrote `measure.target` and nothing else, so "Read 100 books this year"
 * went on saying 100 while the goal aimed at 50. The title is what every list, card and prompt
 * shows, so the number a user reads was the stale one. Found by the outcome eval's judge on
 * 2026-08-22, while the deterministic assert passed — it only checked the number it had just
 * written.
 *
 * DELIBERATELY TIMID. It rewrites the old target only where it stands as its own number, and only
 * when it appears exactly once. Anything else — no number, a different number, the same digits
 * appearing twice, the figure embedded in a longer one (a "100" inside "1000") — is left alone.
 * The title is the user's own words; the only thing being corrected is a digit that is now false,
 * and a guess is worse than a stale title nobody promised to maintain.
 */
export function retitleForTarget(title: string, was: unknown, target: number): string | null {
  const oldNum = Number(was);
  if (!Number.isFinite(oldNum) || !Number.isFinite(target) || oldNum === target) return null;

  const clean = (title ?? '').trim();
  if (!clean) return null;

  /**
   * Standalone occurrences only. The guards are on BOTH sides and cover more than digits:
   *  - digits/./, either side  — "100" must not match inside "1000" or "100.5"
   *  - letters either side     — "100k" is one token, not a hundred followed by a k
   * And exactly one hit: "Run 100 miles in 100 days" gives no way to know which they meant.
   */
  const pattern = new RegExp(`(?<![\\w.,])${oldNum}(?![\\w.,])`, 'g');
  const hits = clean.match(pattern);
  if (!hits || hits.length !== 1) return null;

  const next = clean.replace(pattern, String(target));
  return next === clean ? null : next;
}
