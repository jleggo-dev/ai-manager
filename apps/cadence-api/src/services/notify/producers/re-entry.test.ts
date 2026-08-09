/**
 * The decay ladder is the design, so these tests are mostly about SILENCE: days 4-6, day 8
 * onwards, and the fact that no arrangement of the clock produces a third nudge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidates = vi.fn();
vi.mock('../../../repos/notify-candidates.ts', () => ({
  listReEntryCandidates: (...a: unknown[]) => listCandidates(...a),
}));

const { reEntryProducer } = await import('./re-entry.ts');

const row = (lastDone: string, over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'Europe/London',
  last_done: lastDone,
  ...over,
});

/** 09:00 London on 2026-08-10. */
const MORNING = new Date('2026-08-10T08:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('re_entry — the rungs', () => {
  it('fires at day three, honestly and with an invitation', async () => {
    listCandidates.mockResolvedValue([row('2026-08-07')]);
    const [req] = await reEntryProducer.produce(MORNING);
    expect(req).toMatchObject({ userId: 'u1', kind: 're_entry', target: '2026-08-10' });
    expect(req?.title).toBe('Checking in');
    expect(req?.body).toMatch(/haven't seen you/i);
  });

  it('fires once more at day seven, softer', async () => {
    listCandidates.mockResolvedValue([row('2026-08-03')]);
    const [req] = await reEntryProducer.produce(MORNING);
    expect(req?.target).toBe('2026-08-10');
    expect(req?.body).toMatch(/still here/i);
    expect(req?.body).not.toMatch(/haven't seen you/i);
  });

  it('is silent on days four, five and six — the rungs are not a range', async () => {
    for (const lastDone of ['2026-08-06', '2026-08-05', '2026-08-04']) {
      listCandidates.mockResolvedValue([row(lastDone)]);
      expect(await reEntryProducer.produce(MORNING), lastDone).toEqual([]);
    }
  });

  it('is silent at day eight and beyond — escalation decays, it never intensifies', async () => {
    for (const lastDone of ['2026-08-02', '2026-08-01', '2026-07-20']) {
      listCandidates.mockResolvedValue([row(lastDone)]);
      expect(await reEntryProducer.produce(MORNING), lastDone).toEqual([]);
    }
  });

  it('is silent before day three — two quiet days is not an absence', async () => {
    listCandidates.mockResolvedValue([row('2026-08-08')]);
    expect(await reEntryProducer.produce(MORNING)).toEqual([]);
  });
});

describe('re_entry — when and how', () => {
  it('only goes out in the morning; at 9pm this reads as being watched', async () => {
    listCandidates.mockResolvedValue([row('2026-08-07')]);
    expect(await reEntryProducer.produce(new Date('2026-08-10T20:00:00Z'))).toEqual([]);
  });

  it('targets the threshold DAY, so a later absence gets its own ladder', async () => {
    listCandidates.mockResolvedValue([row('2026-08-07')]);
    const [first] = await reEntryProducer.produce(MORNING);
    listCandidates.mockResolvedValue([row('2026-11-07')]);
    const [later] = await reEntryProducer.produce(new Date('2026-11-10T08:00:00Z'));
    expect(first?.target).not.toBe(later?.target);
  });

  it('infers nothing about the person from their absence', async () => {
    for (const lastDone of ['2026-08-07', '2026-08-03']) {
      listCandidates.mockResolvedValue([row(lastDone)]);
      const [req] = await reEntryProducer.produce(MORNING);
      expect(`${req?.title} ${req?.body}`).not.toMatch(/\b(ok|okay|alright|struggling|hope|missed|behind|slipping)\b/i);
    }
  });

  it('proposes no detour — the user explains the gap first, always', async () => {
    listCandidates.mockResolvedValue([row('2026-08-07')]);
    const [req] = await reEntryProducer.produce(MORNING);
    expect(req?.body).not.toMatch(/detour|pause|break from/i);
  });

  it('holds when the timezone is unknown', async () => {
    listCandidates.mockResolvedValue([row('2026-08-07', { timezone: null })]);
    expect(await reEntryProducer.produce(MORNING)).toEqual([]);
  });
});
