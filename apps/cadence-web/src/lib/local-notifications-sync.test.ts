/**
 * The prefs are what make this sync correct. Nothing downstream can suppress a local notification
 * — the OS fires it, not us — so a sync that ignored the dial would schedule the full catalog and
 * there would be no second chance to withhold it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPrefs = vi.fn();
const getPlan = vi.fn();
const sync = vi.fn(async (..._a: unknown[]) => 0);
const isAvailable = vi.fn(() => true);
const registerCategories = vi.fn(async () => {});
const donate = vi.fn(async () => true);

vi.mock('./api.ts', () => ({
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
  getLocalNudgePlan: (...a: unknown[]) => getPlan(...a),
}));
vi.mock('./capability/index.ts', () => ({
  capabilities: {
    localNotifications: {
      isAvailable: () => isAvailable(),
      sync: (...a: unknown[]) => sync(...a),
    },
    coachIdentity: { registerCategories: () => registerCategories() },
  },
}));
vi.mock('./coach-identity.ts', () => ({ donateCoachIdentity: () => donate() }));

const { syncPlanLocalNotifications } = await import('./local-notifications-sync.ts');

const PLAN = {
  today: '2026-08-10',
  todayWeekday: 2,
  nowMinutes: 6 * 60,
  activities: [
    {
      activity_id: 'run-1',
      title: 'Easy run',
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '07:00' },
    },
  ],
  flexibleToday: { activity_id: 'flex', title: 'stretch', schedule: { recurrence: 'FREQ=DAILY' } },
  yesterday: { done: 2, planned: 4 },
  waypoints: [],
};

const prefs = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  tier: 'lots',
  quietStartMin: 21 * 60,
  quietEndMin: 6 * 60,
  includes: [],
  excludes: [],
  maxPerDay: 2,
  ...over,
});

/** The kinds handed to the OS on the last sync call. */
const scheduledKinds = (): string[] =>
  ((sync.mock.calls.at(-1)?.[0] ?? []) as Array<{ kind: string }>).map((s) => s.kind);

beforeEach(() => {
  vi.clearAllMocks();
  isAvailable.mockReturnValue(true);
  sync.mockImplementation(async (specs) => (specs as unknown[]).length);
  getPrefs.mockResolvedValue(prefs());
  getPlan.mockResolvedValue({ ...PLAN });
});

describe('syncPlanLocalNotifications', () => {
  it('schedules the full local set at "lots"', async () => {
    const r = await syncPlanLocalNotifications();
    expect(r.scheduled).toBeGreaterThan(0);
    expect(new Set(scheduledKinds())).toEqual(new Set(['almost_time', 'before_quiet_hours', 'morning_adjust']));
  });

  it('drops everything above the tier when the dial is turned down', async () => {
    // weekly_checkin was the one LOCAL kind `few` allowed through; now that it ships as a PUSH
    // nudge instead (check-in rebuild, step 8), `few` leaves the local scheduler nothing to build.
    getPrefs.mockResolvedValue(prefs({ tier: 'few' }));
    await syncPlanLocalNotifications();
    expect(scheduledKinds()).toEqual([]);
  });

  it('drops what the new quiet window now covers', async () => {
    // Quiet until 08:30 puts the 06:45 lead inside the window, so the run's nudge goes entirely.
    getPrefs.mockResolvedValue(prefs({ quietEndMin: 8 * 60 + 30 }));
    await syncPlanLocalNotifications();
    expect(scheduledKinds()).not.toContain('almost_time');
  });

  it('moves the morning nudges to just after quiet hours instead of waking a late riser', async () => {
    getPrefs.mockResolvedValue(prefs({ quietEndMin: 9 * 60 }));
    await syncPlanLocalNotifications();
    const specs = (sync.mock.calls.at(-1)?.[0] ?? []) as Array<{ kind: string; hour: number; minute: number }>;
    const morning = specs.find((s) => s.kind === 'morning_adjust');
    expect([morning?.hour, morning?.minute]).toEqual([9, 0]);
  });

  it('registers the action categories and donates the portrait BEFORE scheduling', async () => {
    const order: string[] = [];
    registerCategories.mockImplementation(async () => void order.push('categories'));
    donate.mockImplementation(async () => {
      order.push('donate');
      return true;
    });
    sync.mockImplementation(async () => {
      order.push('schedule');
      return 1;
    });
    await syncPlanLocalNotifications();
    expect(order).toEqual(['categories', 'donate', 'schedule']);
  });

  it('CANCELS everything when there is no plan — orphans would fire forever', async () => {
    getPlan.mockResolvedValue(null);
    const r = await syncPlanLocalNotifications();
    expect(sync).toHaveBeenCalledWith([]);
    expect(r.reason).toBe('no_plan');
  });

  it('falls back to the standard quiet window when prefs cannot be read', async () => {
    // A failed fetch must schedule a QUIETER night, never an unbounded one.
    getPrefs.mockResolvedValue(null);
    await syncPlanLocalNotifications();
    const specs = (sync.mock.calls.at(-1)?.[0] ?? []) as Array<{ hour: number }>;
    for (const s of specs) expect(s.hour < 21 && s.hour >= 7).toBe(true);
  });

  it('is a no-op on web', async () => {
    isAvailable.mockReturnValue(false);
    expect(await syncPlanLocalNotifications()).toEqual({ scheduled: 0, reason: 'unavailable' });
    expect(sync).not.toHaveBeenCalled();
  });

  it('reports "not permitted" rather than pretending it scheduled', async () => {
    sync.mockResolvedValue(0);
    expect((await syncPlanLocalNotifications()).reason).toBe('not_permitted');
  });

  it('never throws — a notification problem must not stop the app loading', async () => {
    getPlan.mockRejectedValue(new Error('offline'));
    await expect(syncPlanLocalNotifications()).resolves.toEqual({ scheduled: 0, reason: 'unavailable' });
  });
});
