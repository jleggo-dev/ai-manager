/**
 * The boundary alarms share one notification centre with the plan reminders. These pin the
 * seam that keeps them apart: `sync` and `cancelAll` cancel every pending reminder and never a
 * booked boundary; `scheduleAlarms` books into the reserved ids only, never more than the range
 * holds, cancelling the whole range first; `cancelAlarms` cancels the whole range.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOCAL_NOTIFICATION_ID, localNotificationId } from '@cadence/shared';

const ln = vi.hoisted(() => ({
  pending: [] as Array<{ id: number }>,
  cancel: vi.fn(async (_o: { notifications: Array<{ id: number }> }) => undefined),
  schedule: vi.fn(async (_o: { notifications: unknown[] }) => undefined),
  permission: 'granted' as string,
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: async () => ({ notifications: ln.pending }),
    cancel: (o: { notifications: Array<{ id: number }> }) => ln.cancel(o),
    schedule: (o: { notifications: unknown[] }) => ln.schedule(o),
    checkPermissions: async () => ({ display: ln.permission }),
    requestPermissions: async () => ({ display: ln.permission }),
    registerActionTypes: async () => undefined,
  },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { addListener: () => Promise.resolve({}) } }));
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ scheduleWithIdentity: async () => ({ decorated: false }) }),
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock('capacitor-health', () => ({ Health: {} }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));

const { nativeCapabilities } = await import('./native.ts');
const { BOUNDARY_ALARM_COUNT, BOUNDARY_ALARM_IDS, isBoundaryAlarmId } = await import('./index.ts');

const cancelledIds = () => ln.cancel.mock.calls.flatMap(([o]) => o.notifications.map((n) => n.id));
const reminder = (n: number) => ({ id: n, title: 'Easy run', body: 'in 20 min' });

beforeEach(() => {
  ln.pending = [];
  ln.permission = 'granted';
  ln.cancel.mockClear();
  ln.schedule.mockClear();
});

describe('the reserved range', () => {
  it('sits above every reminder id and inside the 32-bit maximum, K ids long', () => {
    expect(BOUNDARY_ALARM_IDS).toHaveLength(BOUNDARY_ALARM_COUNT);
    expect(BOUNDARY_ALARM_IDS[0]).toBe(MAX_LOCAL_NOTIFICATION_ID + 1);
    expect(BOUNDARY_ALARM_IDS.at(-1)).toBe(2147483647);
    expect(isBoundaryAlarmId(MAX_LOCAL_NOTIFICATION_ID)).toBe(false);
    expect(isBoundaryAlarmId(MAX_LOCAL_NOTIFICATION_ID + 1)).toBe(true);
    expect(isBoundaryAlarmId(2147483647)).toBe(true);
    expect(isBoundaryAlarmId(2147483648)).toBe(false);
  });

  it('no reminder hash ever lands in it', () => {
    for (const key of ['a', 'run-1', 'activity-with-a-very-long-uuid-like-id', '🙂', 'zzq-test'])
      for (let wd = 1; wd <= 7; wd += 1) expect(isBoundaryAlarmId(localNotificationId(key, wd))).toBe(false);
  });
});

describe('sync and cancelAll step around booked boundaries', () => {
  it('sync cancels the pending reminders and leaves the boundaries, then schedules the new set', async () => {
    ln.pending = [{ id: 12 }, { id: BOUNDARY_ALARM_IDS[0]! }, { id: 34 }, { id: BOUNDARY_ALARM_IDS[3]! }];
    const n = await nativeCapabilities.localNotifications.sync([
      { ...reminder(12), kind: 'almost_time', weekday: 2, hour: 7, minute: 0 } as never,
    ]);
    expect(n).toBe(1);
    expect(cancelledIds()).toEqual([12, 34]);
    expect(ln.schedule).toHaveBeenCalledTimes(1);
  });

  it('cancelAll leaves the boundaries too', async () => {
    ln.pending = [{ id: 12 }, { id: BOUNDARY_ALARM_IDS[7]! }];
    await nativeCapabilities.localNotifications.cancelAll();
    expect(cancelledIds()).toEqual([12]);
  });

  it('cancelAll with only boundaries pending cancels nothing', async () => {
    ln.pending = [{ id: BOUNDARY_ALARM_IDS[0]! }];
    await nativeCapabilities.localNotifications.cancelAll();
    expect(ln.cancel).not.toHaveBeenCalled();
  });
});

describe('scheduleAlarms and cancelAlarms', () => {
  const at = Date.parse('2026-11-04T10:05:00Z');
  const alarms = Array.from({ length: 10 }, (_, i) => ({ at: at + i * 30_000, title: 'Bike sprints', body: 'Work' }));

  it('cancels the whole range first, then books into the reserved ids, never more than the range holds', async () => {
    expect(await nativeCapabilities.localNotifications.scheduleAlarms(alarms)).toBe(true);
    expect(cancelledIds()).toEqual([...BOUNDARY_ALARM_IDS]);
    const scheduled = ln.schedule.mock.calls[0]![0].notifications as Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date; allowWhileIdle: boolean };
      sound?: string;
    }>;
    expect(scheduled).toHaveLength(BOUNDARY_ALARM_COUNT);
    expect(scheduled.map((s) => s.id)).toEqual([...BOUNDARY_ALARM_IDS]);
    expect(scheduled[0]).toMatchObject({ title: 'Bike sprints', body: 'Work', schedule: { allowWhileIdle: true } });
    expect(scheduled[0]!.schedule.at.getTime()).toBe(at);
    expect(scheduled.every((s) => s.sound === undefined)).toBe(true); // the system default sound
  });

  it('with nothing to book it still clears the range and schedules nothing', async () => {
    expect(await nativeCapabilities.localNotifications.scheduleAlarms([])).toBe(true);
    expect(cancelledIds()).toEqual([...BOUNDARY_ALARM_IDS]);
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('without permission it books nothing and says so', async () => {
    ln.permission = 'denied';
    expect(await nativeCapabilities.localNotifications.scheduleAlarms(alarms)).toBe(false);
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('cancelAlarms cancels the whole range', async () => {
    await nativeCapabilities.localNotifications.cancelAlarms();
    expect(cancelledIds()).toEqual([...BOUNDARY_ALARM_IDS]);
  });
});
