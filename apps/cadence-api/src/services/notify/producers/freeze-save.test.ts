/**
 * freeze_save is the only streak notification that exists, so the cases that matter are the ones
 * where it becomes something else: a same-night buzz, a repeat, or a celebration of nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidates = vi.fn();
vi.mock('../../../repos/notify-candidates.ts', () => ({
  listFreezeSaveCandidates: (...a: unknown[]) => listCandidates(...a),
}));

const { freezeSaveProducer } = await import('./freeze-save.ts');

const row = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'Europe/London',
  streak_state: {
    current: 12,
    longest: 12,
    freezes: 1,
    freeze_credit: 0,
    last_evaluated: '2026-08-09',
    last_saved_by_freeze: '2026-08-09',
  },
  ...over,
});

/** 09:00 London on 2026-08-10 — the morning after the saved day. */
const MORNING = new Date('2026-08-10T08:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  listCandidates.mockResolvedValue([row()]);
});

describe('freeze_save', () => {
  it('proposes the morning after the saved day, targeted on that day', async () => {
    const [req] = await freezeSaveProducer.produce(MORNING);
    expect(req).toMatchObject({ userId: 'u1', kind: 'freeze_save', target: '2026-08-09' });
    expect(req?.title).toBe("Streak's safe");
    expect(req?.body).toContain('12 days, still counting');
  });

  it('never fires the same night — the whole point of waiting until morning', async () => {
    // 23:30 London on the saved day itself.
    expect(await freezeSaveProducer.produce(new Date('2026-08-09T22:30:00Z'))).toEqual([]);
  });

  it('is silent once the morning has passed', async () => {
    expect(await freezeSaveProducer.produce(new Date('2026-08-10T14:00:00Z'))).toEqual([]);
  });

  it('uses the USER’s yesterday, not the server’s', async () => {
    // 08:00Z is 17:00 in Tokyo on the 10th — not their morning, so nothing goes out…
    listCandidates.mockResolvedValue([row({ timezone: 'Asia/Tokyo' })]);
    expect(await freezeSaveProducer.produce(MORNING)).toEqual([]);
    // …and at 23:00Z on the 9th it IS 08:00 on the 10th in Tokyo, so it does.
    expect(await freezeSaveProducer.produce(new Date('2026-08-09T23:00:00Z'))).toHaveLength(1);
  });

  it('ignores a save from two days ago — the query’s slack is not a licence to send late', async () => {
    listCandidates.mockResolvedValue([
      row({ streak_state: { ...row().streak_state, last_saved_by_freeze: '2026-08-08' } }),
    ]);
    expect(await freezeSaveProducer.produce(MORNING)).toEqual([]);
  });

  it('says nothing about a zero-day streak — that is a rescue of nothing', async () => {
    listCandidates.mockResolvedValue([row({ streak_state: { ...row().streak_state, current: 0 } })]);
    expect(await freezeSaveProducer.produce(MORNING)).toEqual([]);
  });

  it('holds when the timezone is unknown', async () => {
    listCandidates.mockResolvedValue([row({ timezone: null })]);
    expect(await freezeSaveProducer.produce(MORNING)).toEqual([]);
  });

  it('holds when the streak state is missing entirely', async () => {
    listCandidates.mockResolvedValue([row({ streak_state: null })]);
    expect(await freezeSaveProducer.produce(MORNING)).toEqual([]);
  });

  it('never warns about risk — it only ever reports a save that already happened', async () => {
    const [req] = await freezeSaveProducer.produce(MORNING);
    expect(`${req?.title} ${req?.body}`).not.toMatch(/\b(risk|about to|nearly|careful|don't|will break)\b/i);
  });
});
