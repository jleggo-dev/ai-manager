/**
 * The watch route is the seam between a device that may be offline for hours and a store that must
 * not end up with a session recorded twice — or a week the wrist cannot act on. The cases worth
 * pinning are the ones where being wrong is invisible: detail sent for a day nobody can use, a
 * redelivered log counted as a second session, and a malformed payload answered as though it were
 * stored.
 *
 * Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { WATCH_DETAIL_DAYS, WATCH_PAYLOAD_VERSION, type WatchWeekPayload } from '@cadence/shared';

const buildPlanView = vi.fn();
const listOccurrenceSessionLogs = vi.fn();
const logSessionFromWatch = vi.fn();

vi.mock('../services/plan-view.ts', () => ({ buildPlanView: (...a: unknown[]) => buildPlanView(...a) }));
vi.mock('../repos/occurrences.ts', () => ({
  listOccurrenceSessionLogs: (...a: unknown[]) => listOccurrenceSessionLogs(...a),
}));
vi.mock('../services/watch-log.ts', () => ({
  logSessionFromWatch: (...a: unknown[]) => logSessionFromWatch(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: watchRoutes } = await import('./plan-watch.ts');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/plan', watchRoutes);
  return a;
}

/** Minimal fetch against the route, without pulling in supertest. */
async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const server = app().listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const TODAY = '2026-09-07';

function day(date: string, occurrences: unknown[] = []) {
  return { date, weekday: 'Mon', dayNum: 7, isToday: date === TODAY, occurrences };
}

function occurrence(id: string, over: Record<string, unknown> = {}) {
  return {
    occurrence_id: id,
    activity_id: 'act-1',
    title: 'Strength — lower',
    kind: 'user',
    status: 'pending',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildPlanView.mockResolvedValue({ week: [day(TODAY, [occurrence('o1')])], activities: [] });
  listOccurrenceSessionLogs.mockResolvedValue([]);
});

describe('GET /plan/watch', () => {
  it('returns a versioned payload the watch can check before trusting it', async () => {
    const { status, body } = await call('/plan/watch');
    expect(status).toBe(200);
    expect((body as WatchWeekPayload).version).toBe(WATCH_PAYLOAD_VERSION);
  });

  it('reads sessions ONLY for the detail window, not the whole week', async () => {
    // The week view deliberately excludes the session jsonb; paying for seven days of prescriptions
    // to discard five would be the expensive version of the same read.
    buildPlanView.mockResolvedValue({
      week: [day(TODAY, [occurrence('o1')]), day('2026-09-13', [occurrence('o2')])],
      activities: [],
    });
    await call('/plan/watch');
    expect(listOccurrenceSessionLogs).toHaveBeenCalledWith('u1', TODAY, '2026-09-08');
    expect(WATCH_DETAIL_DAYS).toBe(2);
  });

  it("sends the phone's whole week — today first even when empty, rest days to the end", async () => {
    // The Sunday bug: today had nothing on it and the plan started Monday, so the wrist got a week
    // with no Sunday and no today. The route now names the view's window so the projection draws
    // every day of it.
    buildPlanView.mockResolvedValue({
      week: [day(TODAY), day('2026-09-08', [occurrence('o1')]), day('2026-09-09'), day('2026-09-10')],
      activities: [],
    });
    const { body } = await call('/plan/watch');
    const days = (body as WatchWeekPayload).days;
    expect(days.map((d) => d.date)).toEqual([TODAY, '2026-09-08', '2026-09-09', '2026-09-10']);
    expect(days[0]).toMatchObject({ isToday: true, sessions: [] });
  });

  it('answers an empty payload for a user with no week, not an error', async () => {
    buildPlanView.mockResolvedValue({ week: [], activities: [] });
    const { status, body } = await call('/plan/watch');
    expect(status).toBe(200);
    expect((body as WatchWeekPayload).days).toEqual([]);
    // No week means no detail read at all.
    expect(listOccurrenceSessionLogs).not.toHaveBeenCalled();
  });

  it("carries the commitment's duration so a prescription without a clock still says a length", async () => {
    buildPlanView.mockResolvedValue({
      week: [day(TODAY, [occurrence('o1')])],
      activities: [{ activity_id: 'act-1', title: 'Strength — lower', duration_min: 26 }],
    });
    const { body } = await call('/plan/watch');
    expect((body as WatchWeekPayload).days[0]?.sessions[0]?.minutes).toBe(26);
  });

  it('drops system rows — nothing on a wrist opens a food log', async () => {
    buildPlanView.mockResolvedValue({
      week: [day(TODAY, [occurrence('food', { title: 'Food log', kind: 'system' }), occurrence('o1')])],
      activities: [],
    });
    const { body } = await call('/plan/watch');
    const ids = (body as WatchWeekPayload).days.flatMap((d) => d.sessions.map((s) => s.occurrenceId));
    expect(ids).toEqual(['o1']);
  });

  it('answers 500 rather than a half-built week when the plan read fails', async () => {
    buildPlanView.mockRejectedValue(new Error('db down'));
    const { status } = await call('/plan/watch');
    expect(status).toBe(500);
  });
});

describe('POST /plan/watch/log', () => {
  const body = (payload: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  it('stores a log and reports what it did', async () => {
    logSessionFromWatch.mockResolvedValue({ stored: true, summary: 'Done on your watch — 3 sets.', duplicate: false });
    const { status, body: res } = await call('/plan/watch/log', body({ occurrenceId: 'o1' }));
    expect(status).toBe(200);
    expect(res).toEqual({ stored: true, summary: 'Done on your watch — 3 sets.', duplicate: false });
  });

  it('reports a redelivery as a duplicate rather than storing it twice', async () => {
    // transferUserInfo is at-least-once, and the watch keeps its own outbox — so the same finished
    // session genuinely arrives twice. Counting it twice would double somebody's week.
    logSessionFromWatch.mockResolvedValue({ stored: false, summary: 'Done on your watch.', duplicate: true });
    const { status, body: res } = await call('/plan/watch/log', body({ occurrenceId: 'o1' }));
    expect(status).toBe(200);
    expect((res as { duplicate: boolean }).duplicate).toBe(true);
  });

  it('answers 400 for a payload that is not a log, so the watch stops retrying it', async () => {
    logSessionFromWatch.mockResolvedValue(null);
    const { status } = await call('/plan/watch/log', body({ nope: true }));
    expect(status).toBe(400);
  });

  it('answers 500 on an unexpected failure, so the watch KEEPS the log and retries', async () => {
    // The distinction matters: 400 makes the watch drop it, 500 makes it try again. A transient
    // database failure must never look like a malformed payload.
    logSessionFromWatch.mockRejectedValue(new Error('db down'));
    const { status } = await call('/plan/watch/log', body({ occurrenceId: 'o1' }));
    expect(status).toBe(500);
  });
});
