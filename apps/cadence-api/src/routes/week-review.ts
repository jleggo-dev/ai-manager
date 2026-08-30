/**
 * The Week review routes — split out of plan.ts (already at its size gate) rather than grown
 * inside it, the same way coach-food.ts sits beside coach.ts. Mounted under /plan so the URLs read
 * exactly as if they lived there: GET /plan/week-review/pending, POST /plan/week-review/dismiss,
 * GET /plan/week-review/facts[?week=YYYY-MM-DD], plus the write-back trio below (check-in rebuild,
 * step 5): POST /plan/week-review/session, /meal, /mind-step.
 *
 * The pending/dismiss pair mirrors /plan/pending-change precisely: the coach's `open_week_review`
 * tool (coach-action-week-review.ts) is the only writer of the POINTER, the client polls this GET
 * on a finished turn, and renders a labelled card from whatever it finds — never from the turn's
 * own prose. `facts` is the full week that pointer names — what the review sheet (check-in
 * rebuild, step 4) renders once the card's "Open" is tapped. Progress Engine parcel W2-2 adds the
 * optional `week` param (this same screen, scoped to an arbitrary week — see the route's own doc)
 * without touching that default, pointer-driven behavior.
 *
 * The write-back trio is thin CRUD onto `week-review-write.ts` — no model, never reached via
 * coach-actions.ts. The sheet applies each toggle optimistically and calls one of these behind it;
 * `dismiss` above is what "Confirm my week" calls when the user is done, since nothing about
 * finishing a review needs a write of its own — every correction already landed per-toggle.
 */
import { Router, type Request, type Response } from 'express';
import type { PendingWeekReview } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getUser, setPendingWeekReview } from '../repos/users.ts';
import { buildWeekReviewFacts } from '../services/week-review-facts.ts';
import { confirmSession, toggleMealSlot, toggleMindStep } from '../services/week-review-write.ts';
import { addDaysIso, mondayOnOrBefore } from '../services/progress-rhythm.ts';
import {
  BodyValidationError,
  parseBody,
  weekReviewSessionBodySchema,
  weekReviewMealBodySchema,
  weekReviewMindStepBodySchema,
} from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * GET /plan/week-review/facts[?week=YYYY-MM-DD] — the full week computed (`buildWeekReviewFacts`)
 * for the read-only review sheet (check-in rebuild, step 4). `week` OMITTED is exactly the
 * original behavior (backwards compatible): the pending pointer already IS the window, and a user
 * with nothing pending has no week to open, so 404 rather than guessing a default. `week` given
 * (Progress Engine parcel W2-2 — this same screen, scoped to an arbitrary week) snaps to that
 * week's Monday and reads the window directly, bypassing the pending pointer entirely — the
 * pointer only ever names ONE week (the one `open_week_review` last put up), so an explicit
 * `week` and "nothing pending" are not in conflict.
 */
router.get('/week-review/facts', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const weekRaw = req.query.week;
  if (weekRaw !== undefined && (typeof weekRaw !== 'string' || !ISO_DATE_RE.test(weekRaw))) {
    return void res.status(400).json({ error: 'week must be YYYY-MM-DD' });
  }
  try {
    let review: PendingWeekReview;
    if (typeof weekRaw === 'string') {
      const from = mondayOnOrBefore(weekRaw);
      review = { from, to: addDaysIso(from, 6), built_at: new Date().toISOString() };
    } else {
      const pending = (await getUser(userId))?.pending_week_review ?? null;
      if (!pending) {
        res.status(404).json({ error: 'no review pending' });
        return;
      }
      review = pending;
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

export default router;
