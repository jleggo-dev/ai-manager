import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const listOccurrences = vi.fn();
const getDailyCheckin = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('../repos/coach-moments.ts', () => ({ getDailyCheckin: (...a: unknown[]) => getDailyCheckin(...a) }));

const { getDailyCheckinStatus } = await import('./daily-checkin.ts');

/** 09:00 in London on 12 Mar — comfortably past the 4am floor. */
const MORNING = new Date('2026-03-12T09:00:00Z');

describe('daily check-in gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ timezone: 'Europe/London' });
    getDailyCheckin.mockResolvedValue(null);
    listOccurrences.mockResolvedValue([{ status: 'done' }, { status: 'pending' }]);
  });

  it('is due on the first open of a day that had a resolved plan', async () => {
    const s = await getDailyCheckinStatus('u1', MORNING);
    expect(s.due).toBe(true);
    expect(s.date).toBe('2026-03-12');
    expect(s.reviewing).toBe('2026-03-11');
  });

  it('stays quiet before 4am — someone up at 3 is finishing yesterday, not starting today', async () => {
    const s = await getDailyCheckinStatus('u1', new Date('2026-03-12T03:00:00Z'));
    expect(s.due).toBe(false);
  });

  it('uses the USER timezone for both the hour and the date, not UTC', async () => {
    getUser.mockResolvedValue({ timezone: 'Pacific/Auckland' });
    // 20:00 UTC on the 11th is 09:00 on the 12th in Auckland — a UTC-based gate would call this
    // "yesterday evening" and either fire twice or not at all.
    const s = await getDailyCheckinStatus('u1', new Date('2026-03-11T20:00:00Z'));
    expect(s.date).toBe('2026-03-12');
    expect(s.reviewing).toBe('2026-03-11');
    expect(s.due).toBe(true);
  });

  it('never asks twice in one day — an answered row closes it', async () => {
    getDailyCheckin.mockResolvedValue({ date: '2026-03-12', mood: 4, adjustment: null, dismissed_at: null });
    expect((await getDailyCheckinStatus('u1', MORNING)).due).toBe(false);
  });

  it('treats "Not now" as settled for the day', async () => {
    getDailyCheckin.mockResolvedValue({
      date: '2026-03-12',
      mood: null,
      adjustment: null,
      dismissed_at: '2026-03-12T09:01:00Z',
    });
    expect((await getDailyCheckinStatus('u1', MORNING)).due).toBe(false);
  });

  it('says nothing when yesterday had no plan — there is nothing to ask about', async () => {
    listOccurrences.mockResolvedValue([]);
    expect((await getDailyCheckinStatus('u1', MORNING)).due).toBe(false);
  });

  it('says nothing when yesterday never resolved', async () => {
    // Every item still pending: the day may simply not have synced, and "how did yesterday go?"
    // against an untouched day reads as an accusation.
    listOccurrences.mockResolvedValue([{ status: 'pending' }, { status: 'pending' }]);
    expect((await getDailyCheckinStatus('u1', MORNING)).due).toBe(false);
  });

  it('counts a skipped day as resolved — a skip is a real answer worth asking about', async () => {
    listOccurrences.mockResolvedValue([{ status: 'skipped' }]);
    expect((await getDailyCheckinStatus('u1', MORNING)).due).toBe(true);
  });

  it('falls back to UTC for a user with no timezone rather than throwing', async () => {
    getUser.mockResolvedValue({ timezone: null });
    const s = await getDailyCheckinStatus('u1', MORNING);
    expect(s.date).toBe('2026-03-12');
    expect(s.due).toBe(true);
  });

  it('crosses a month boundary correctly when naming yesterday', async () => {
    const s = await getDailyCheckinStatus('u1', new Date('2026-03-01T09:00:00Z'));
    expect(s.reviewing).toBe('2026-02-28');
  });
});
