/**
 * The coach-portrait plugin as JS sees it when the native side never registered it. For a month
 * every `CoachIdentity` call rejected with Capacitor's "not implemented on ios" and both catches in
 * native.ts swallowed it — the fallback (a plain app-icon notification) was right, the silence was
 * not. These pin that the fallback still holds AND that the reason is said out loud, where Safari's
 * Web Inspector can see it on the device that failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalNotificationSpec } from '@cadence/shared';

const plugin = vi.hoisted(() => ({
  donate: vi.fn<() => Promise<{ donated: boolean }>>(),
  scheduleWithIdentity: vi.fn<() => Promise<{ scheduled: number; decorated: boolean }>>(),
}));
const local = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ display: 'granted' })),
  getPending: vi.fn(async () => ({ notifications: [] as { id: number }[] })),
  cancel: vi.fn(async () => undefined),
  schedule: vi.fn(async () => undefined),
}));

// Every local plugin module resolves through registerPlugin at load; they all get this stub.
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin, Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {} }));
vi.mock('capacitor-health', () => ({ Health: {} }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: local }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));

const { nativeCapabilities } = await import('./native.ts');

/** What @capacitor/core throws for a plugin the bridge never exported. */
const NOT_IMPLEMENTED = new Error('"CadenceCoachIdentity" plugin is not implemented on ios');

const SPEC: LocalNotificationSpec = {
  id: 41,
  kind: 'almost_time',
  activityId: 'run-1',
  title: 'Easy run',
  body: 'On the plan for 7:00.',
  hour: 7,
  minute: 0,
  weekday: 2,
  date: null,
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('coachIdentity.donate — an unregistered plugin', () => {
  it('falls back to false AND says why', async () => {
    plugin.donate.mockRejectedValueOnce(NOT_IMPLEMENTED);
    const donated = await nativeCapabilities.coachIdentity.donate({ senderName: 'Cadence', avatarBase64: 'AAAA' });
    expect(donated).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('donate failed'), NOT_IMPLEMENTED);
  });

  it('passes a real answer straight through, silently', async () => {
    plugin.donate.mockResolvedValueOnce({ donated: true });
    await expect(
      nativeCapabilities.coachIdentity.donate({ senderName: 'Cadence', avatarBase64: 'AAAA' }),
    ).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('localNotifications.sync — the portrait path', () => {
  it('schedules plain when the plugin is not registered, and reports it', async () => {
    plugin.scheduleWithIdentity.mockRejectedValueOnce(NOT_IMPLEMENTED);
    const n = await nativeCapabilities.localNotifications.sync([SPEC]);
    expect(n).toBe(1);
    expect(local.schedule).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('portrait path unavailable'), NOT_IMPLEMENTED);
  });

  it('schedules plain when the plugin answers but had no donation in effect — no warning, it is not a failure', async () => {
    plugin.scheduleWithIdentity.mockResolvedValueOnce({ scheduled: 0, decorated: false });
    expect(await nativeCapabilities.localNotifications.sync([SPEC])).toBe(1);
    expect(local.schedule).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never double-schedules once the plugin has decorated the set', async () => {
    plugin.scheduleWithIdentity.mockResolvedValueOnce({ scheduled: 1, decorated: true });
    expect(await nativeCapabilities.localNotifications.sync([SPEC])).toBe(1);
    expect(local.schedule).not.toHaveBeenCalled();
  });
});
