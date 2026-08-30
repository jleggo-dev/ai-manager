import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listRecaps } from '../repos/recaps.ts';

const router = Router();
router.use(requireCadenceUser);

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/** `?limit=` clamped to a sane range — never trust the raw query param, never 500 on garbage. */
function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * GET /me/recaps — the `recap_rail` widget's data (Progress Engine W2-1). Rows persist at
 * week-review confirm time (services/recap-write.ts); this is a plain read, most-recent-week
 * first. Deliberately NOT the frozen `RecapRailPayload` shape itself: `week_of` there is a
 * pre-formatted human label ("AUG 18"), and formatting is the client's job (windowDates.ts /
 * BoundWidget.tsx already do this kind of date shaping locally) — this route sends the raw ISO
 * `week_start` and the client maps it. `line` is sent as-is (string | null); the widget payload's
 * non-nullable `line` is a client-side fallback, not a server-side fabrication.
 */
router.get('/recaps', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const rows = await listRecaps(userId, parseLimit(req.query.limit));
    res.json({
      recaps: rows.map((r) => ({
        week_start: r.week_start,
        facts_line: r.facts_line,
        line: r.line,
        detour: r.detour,
      })),
    });
  } catch (err) {
    console.error('[GET /me/recaps]', err);
    res.status(500).json({ error: 'failed to load recaps' });
  }
});

export default router;
