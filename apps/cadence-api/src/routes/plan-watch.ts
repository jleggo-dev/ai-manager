import { Router, type Request, type Response } from 'express';
import { buildWatchWeek, WATCH_DETAIL_DAYS, WATCH_MAX_DAYS, type WatchOccurrenceInput } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { buildPlanView } from '../services/plan-view.ts';
import { listOccurrenceSessionLogs } from '../repos/occurrences.ts';
import { logSessionFromWatch } from '../services/watch-log.ts';

/**
 * GET /plan/watch — the committed week, projected for the wrist (watch app W2).
 *
 * Its own file rather than another handler on `plan.ts`: a distinct responsibility gets its own
 * route from day one, and `plan.ts` is already at the size gate.
 *
 * **This route makes no judgements.** Which sessions reach the wrist, what each one is called,
 * how deep the detail rides and what gets shed to fit the transport are all decided by
 * `buildWatchWeek` in `@cadence/shared` — unit-tested there, and the same division of labour the
 * WorkoutKit hand-off uses. What this file owns is the two reads and the window between them.
 *
 * The week comes from `buildPlanView`, not a fresh query, so the wrist and the phone agree on
 * what the week IS — including whose "today" it is (the user's stored zone, else the client's
 * hint; a server-side UTC "today" put tomorrow's plan on screen once already).
 */
const router = Router();
router.use(requireCadenceUser);

/** The caller's IANA zone, when the client sent one. Never trusted over the stored value. */
function tzHint(req: Request): string | null {
  const h = req.header('X-Cadence-Timezone');
  return h && h.length < 64 ? h : null;
}

function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

router.get('/watch', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const view = await buildPlanView(userId, WATCH_MAX_DAYS - 1, tzHint(req));
    const todayISO = view.week[0]?.date;
    if (!todayISO) {
      // No week at all — a user with no committed plan. An empty payload is the honest answer and
      // the watch draws its rest-day face from it; an error here would read as a broken sync.
      res.json(buildWatchWeek({ todayISO: '', occurrences: [], generatedAt: new Date().toISOString() }));
      return;
    }

    /**
     * Prescriptions for the detail window ONLY.
     *
     * `listOccurrences` (inside buildPlanView) deliberately excludes the session jsonb because the
     * week view has no use for it. The wrist does — but only for the days it can act on, so this
     * second read is bounded to today+tomorrow rather than paying for a week of payloads to throw
     * five days of them away.
     */
    const detailTo = addDays(todayISO, WATCH_DETAIL_DAYS - 1);
    const detail = await listOccurrenceSessionLogs(userId, todayISO, detailTo);
    const sessionById = new Map(detail.map((r) => [r.occurrence_id, r.session]));
    // `duration_min` lives on the commitment, not the occurrence — it is the fallback the
    // projection uses when a prescription carries no clock of its own.
    const durationByActivity = new Map(view.activities.map((a) => [a.activity_id, a.duration_min]));

    const occurrences: WatchOccurrenceInput[] = view.week.flatMap((day) =>
      day.occurrences.map((o) => ({
        occurrence_id: o.occurrence_id,
        title: o.title,
        date: day.date,
        status: o.status,
        kind: o.kind,
        duration_min: durationByActivity.get(o.activity_id) ?? null,
        session: sessionById.get(o.occurrence_id) ?? null,
      })),
    );

    // The view's own last day, so the wrist draws the same week the phone does — a rest day at
    // the end of the week is still a day, and today is still today when nothing is on it.
    const throughISO = view.week[view.week.length - 1]?.date;
    res.json(buildWatchWeek({ todayISO, throughISO, occurrences, generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('[GET /plan/watch]', err);
    res.status(500).json({ error: 'failed to build watch week' });
  }
});

/**
 * POST /plan/watch/log — a session finished on the watch.
 *
 * The return leg of the sync. The body is the watch's structured record; every judgement about
 * what it means was made before it got here (`normalizeWatchLog` asserts it, `watchLogSummary`
 * words it), so this route validates ownership and stores.
 *
 * 400 for a payload that is not a log, 404 when the occurrence is not this user's. Both are
 * answers the watch can act on — it keeps an unsent log in its own outbox and retries, so a
 * failure here costs freshness, never the record.
 */
router.post('/watch/log', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await logSessionFromWatch(userId, req.body);
    if (!result) {
      res.status(400).json({ error: 'not a watch log, or no such occurrence' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('[POST /plan/watch/log]', err);
    res.status(500).json({ error: 'failed to store watch log' });
  }
});

export default router;
