/**
 * The Week review routes — split out of plan.ts (already at its size gate) rather than grown
 * inside it, the same way coach-food.ts sits beside coach.ts. Mounted under /plan so the URLs read
 * exactly as if they lived there: GET /plan/week-review/pending, POST /plan/week-review/dismiss,
 * GET /plan/week-review/facts, the write-back trio (check-in rebuild, step 5):
 * POST /plan/week-review/session, /meal, /mind-step, and `recap` (Progress Engine W2-1) below them.
 *
 * The pending/dismiss pair mirrors /plan/pending-change precisely: the coach's `open_week_review`
 * tool (coach-action-week-review.ts) is the only writer of the POINTER, the client polls this GET
 * on a finished turn, and renders a labelled card from whatever it finds — never from the turn's
 * own prose. `facts` is the full week that pointer names — what the review sheet (check-in
 * rebuild, step 4) renders once the card's "Open" is tapped.
 *
 * The write-back trio is thin CRUD onto `week-review-write.ts` — no model, never reached via
 * coach-actions.ts. The sheet applies each toggle optimistically and calls one of these behind it;
 * `dismiss` is what BOTH "Confirm my week" and the pending card's own "Not now" call today — the
 * two are indistinguishable to the server there, which is exactly why `recap`, added for W2-1, is
 * its OWN route rather than folded into dismiss: a card dismissed unopened must never read as a
 * confirmed week.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getUser, setPendingWeekReview } from '../repos/users.ts';
import { buildWeekReviewFacts } from '../services/week-review-facts.ts';
import { confirmSession, toggleMealSlot, toggleMindStep } from '../services/week-review-write.ts';
import { writeRecapForReview } from '../services/recap-write.ts';
import {
  BodyValidationError,
  parseBody,
  weekReviewSessionBodySchema,
  weekReviewMealBodySchema,
  weekReviewMindStepBodySchema,
  weekReviewRecapBodySchema,
} from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /plan/week-review/pending — the plan week `open_week_review` last put up, if the user
 * hasn't opened or dismissed it yet. The card reads its content from here rather than from the
 * turn that announced it, same reasoning as pending-change: what the screen shows is what the tool
 * actually computed, not what a reply claimed.
 */
router.get('/week-review/pending', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const review = (await getUser(userId))?.pending_week_review ?? null;
    res.json({ review });
  } catch (err) {
    console.error('[GET /plan/week-review/pending]', err);
    res.json({ review: null });
  }
});

/** POST /plan/week-review/dismiss — clears the pointer. Nothing else was ever written by
 *  opening or dismissing it, so there is nothing else to undo. */
router.post('/week-review/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingWeekReview(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/week-review/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

/**
 * GET /plan/week-review/facts — the full week the pending pointer names, computed
 * (`buildWeekReviewFacts`) for the read-only review sheet (check-in rebuild, step 4). No query
 * params: the pending pointer already IS the window (a parameterized arbitrary range — "last
 * week", a quarter — is DESIGN-check-in.md's coach-tool path, not this screen). A user with
 * nothing pending has no week to open, so 404 rather than guessing a default window that would
 * silently show the wrong one.
 */
router.get('/week-review/facts', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const review = (await getUser(userId))?.pending_week_review ?? null;
    if (!review) {
      res.status(404).json({ error: 'no review pending' });
      return;
    }
    const facts = await buildWeekReviewFacts(userId, review.from, review.to);
    res.json({ review, facts });
  } catch (err) {
    console.error('[GET /plan/week-review/facts]', err);
    res.status(500).json({ error: 'facts failed' });
  }
});

/* ── Write-back (check-in rebuild, step 5) ────────────────────────────────────
   Plain CRUD onto the same rows `facts` reads — no model anywhere below. Every route 404s when
   the write primitive hands back `false` (occurrence not found, or nothing to toggle) rather than
   guessing an outcome; a validation failure is a 400, never a 404. */

/** POST /plan/week-review/session — confirm (or correct) a session row: done/skipped, optionally
 *  with minutes. The SAME route backs the week's weigh-in row (WeeklyTasksList) — a weigh-in is
 *  just another occurrence to confirm, not a distinct write path. */
router.post('/week-review/session', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { occurrence_id, done, minutes } = parseBody(weekReviewSessionBodySchema, req.body);
    const ok = await confirmSession(userId, occurrence_id, { done, minutes });
    if (!ok) return void res.status(404).json({ error: 'occurrence not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/week-review/session]', err);
    res.status(500).json({ error: 'confirm failed' });
  }
});

/** POST /plan/week-review/meal — flip one day's meal slot. 404 when no per-meal row exists for
 *  that day (a plan predating the per-meal split, or a day outside the materialized horizon). */
router.post('/week-review/meal', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { date, meal, logged } = parseBody(weekReviewMealBodySchema, req.body);
    const ok = await toggleMealSlot(userId, date, meal, logged);
    if (!ok) return void res.status(404).json({ error: 'no meal occurrence for that day' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/week-review/meal]', err);
    res.status(500).json({ error: 'toggle failed' });
  }
});

/** POST /plan/week-review/mind-step — flip one named step of a mind/practice occurrence's
 *  checklist. 404 when the occurrence has no such step (or no named steps at all — the row's
 *  a plain done/not-done and `confirmSession` is the right call instead). */
router.post('/week-review/mind-step', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { occurrence_id, step, done } = parseBody(weekReviewMindStepBodySchema, req.body);
    const ok = await toggleMindStep(userId, occurrence_id, step, done);
    if (!ok) return void res.status(404).json({ error: 'no such step' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/week-review/mind-step]', err);
    res.status(500).json({ error: 'toggle failed' });
  }
});

/**
 * POST /plan/week-review/recap (Progress Engine W2-1) — the confirm anchor: persists this week's
 * recap (`cadence.recaps`) so the `recap_rail` widget has it. `dismiss` above is the only route
 * "Confirm my week" AND the card's own "Not now" both call today — they are indistinguishable to
 * the server there — so a real confirmation needs its OWN write, never piggybacked on dismiss.
 * The window is never taken from the body: it's the user's CURRENT `pending_week_review`, same
 * trust boundary `facts` uses, so a stale card can't write a recap for the wrong (or no) week. Not
 * yet called by the client — see the parcel report for the one-line wiring another parcel owns.
 */
router.post('/week-review/recap', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { line } = parseBody(weekReviewRecapBodySchema, req.body);
    const user = await getUser(userId);
    const review = user?.pending_week_review ?? null;
    if (!review) return void res.status(404).json({ error: 'no review pending' });
    const unit: 'kg' | 'lb' = user?.baseline?.weight_unit === 'lbs' ? 'lb' : 'kg';
    await writeRecapForReview(userId, review, unit, line);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/week-review/recap]', err);
    res.status(500).json({ error: 'recap failed' });
  }
});

export default router;
