/**
 * The whole design is that this fires exactly ONCE per stalled week and can never accumulate: the
 * candidate query bounds eligibility structurally (see notify-candidates.ts), and `target` is
 * derived from a plan column (`generated_at`) that does not move while the plan stays active. These
 * tests pin the two things that would silently break that: the target staying IDENTICAL across
 * repeated ticks (the property the dedupe key relies on), and the producer trusting the query's
 * bound rather than re-deriving it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidates = vi.fn();
vi.mock('../../../repos/notify-candidates.ts', () => ({
  listCheckinDueCandidates: (...a: unknown[]) => listCandidates(...a),
}));

const { checkinDueProducer } = await import('./checkin-due.ts');

const row = (generatedAt: string, over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'Europe/London',
  generated_at: generatedAt,
  ...over,
});

/** 09:00 London on 2026-08-10. */
const MORNING = new Date('2026-08-10T08:00:00Z');
/** 21:00 London on 2026-08-10. */
const NIGHT = new Date('2026-08-10T20:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkin_due — the target', () => {
  it('targets generated_at + 7, not the day the tick happens to run', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [req] = await checkinDueProducer.produce(MORNING);
    expect(req).toMatchObject({ userId: 'u1', kind: 'weekly_checkin', target: '2026-08-10' });
  });

  it('is IDENTICAL across repeated ticks for the same stalled plan — the whole dedupe guarantee', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [first] = await checkinDueProducer.produce(MORNING);
    // A week later, the tick runs again and the plan is STILL active and STILL unreplaced —
    // exactly the "ignored check-in" case. Nothing about the row has changed, so nothing about
    // the target may either.
    const [again] = await checkinDueProducer.produce(new Date('2026-08-17T08:00:00Z'));
    expect(again?.target).toBe(first?.target);
  });

  it('gives a later plan (a different generated_at) its own target', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [first] = await checkinDueProducer.produce(MORNING);
    listCandidates.mockResolvedValue([row('2026-11-03')]);
    const [later] = await checkinDueProducer.produce(new Date('2026-11-10T08:00:00Z'));
    expect(later?.target).not.toBe(first?.target);
  });
});

describe('checkin_due — trusts the candidate bound', () => {
  it('proposes nothing when the query returns nothing — it does not re-derive eligibility itself', async () => {
    listCandidates.mockResolvedValue([]);
    expect(await checkinDueProducer.produce(MORNING)).toEqual([]);
  });

  it('proposes for every row the query hands back, without filtering by generated_at itself', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03', { user_id: 'u1' }), row('2026-01-01', { user_id: 'u2' })]);
    const out = await checkinDueProducer.produce(MORNING);
    expect(out.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });
});

describe('checkin_due — when and how', () => {
  it('only goes out in the morning, same as freeze_save and re_entry', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    expect(await checkinDueProducer.produce(NIGHT)).toEqual([]);
  });

  it('holds when the timezone is unknown', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03', { timezone: null })]);
    expect(await checkinDueProducer.produce(MORNING)).toEqual([]);
  });

  it('reuses the weekly_checkin kind — one dial entry, one row in Settings, whichever channel it ships from', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [req] = await checkinDueProducer.produce(MORNING);
    expect(req?.kind).toBe('weekly_checkin');
    expect(checkinDueProducer.kind).toBe('weekly_checkin');
  });

  it('never says "overdue" and never counts the days', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [req] = await checkinDueProducer.produce(MORNING);
    expect(`${req?.title} ${req?.body}`).not.toMatch(/overdue|\d+\s*days?/i);
  });
});
