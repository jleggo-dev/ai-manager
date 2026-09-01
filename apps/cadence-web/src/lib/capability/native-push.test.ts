/**
 * The native push-arrival doors (Gap 6, PLAN-CHANGES.md): a delivered push used to be a dead end —
 * no receive listener, no tap listener — so "your week is ready" arrived and nothing refreshed.
 * These pin the funnel: both Capacitor events reach the ONE handler, the payload rides along when
 * present, an empty push still fires (older servers), and unsubscribe detaches both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (event: never) => void;
const push = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  return {
    listeners,
    removed,
    addListener: vi.fn((name: string, cb: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), cb]);
      return Promise.resolve({ remove: () => removed.push(name) });
    }),
    fire(name: string, event: unknown) {
      for (const cb of listeners.get(name) ?? []) cb(event as never);
    },
  };
});

// Only the plugin surfaces native.ts touches at module load need to exist; none are exercised here.
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { addListener: push.addListener } }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => true } }));
vi.mock('capacitor-health', () => ({ Health: {} }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));

const { nativeCapabilities } = await import('./native.ts');

beforeEach(() => {
  push.listeners.clear();
  push.removed.length = 0;
  vi.clearAllMocks();
});

describe('native push — onNotification', () => {
  it('funnels a foreground arrival AND a tap into the one handler, payload attached', () => {
    const handler = vi.fn();
    nativeCapabilities.push.onNotification(handler);

    push.fire('pushNotificationReceived', { data: { kind: 'replan_ready', target: 'plan-1' } });
    expect(handler).toHaveBeenNthCalledWith(1, { kind: 'replan_ready', target: 'plan-1' });

    push.fire('pushNotificationActionPerformed', {
      actionId: 'tap',
      notification: { data: { kind: 'replan_committed', target: 'plan-2' } },
    });
    expect(handler).toHaveBeenNthCalledWith(2, { kind: 'replan_committed', target: 'plan-2' });
  });

  it('still fires on a push with no data — an older server means "go look", not silence', () => {
    const handler = vi.fn();
    nativeCapabilities.push.onNotification(handler);

    push.fire('pushNotificationReceived', {});
    push.fire('pushNotificationActionPerformed', { actionId: 'tap', notification: {} });
    expect(handler).toHaveBeenNthCalledWith(1, {});
    expect(handler).toHaveBeenNthCalledWith(2, {});
  });

  it('unsubscribe removes both listeners', async () => {
    const unsubscribe = nativeCapabilities.push.onNotification(vi.fn());
    expect(push.addListener).toHaveBeenCalledWith('pushNotificationReceived', expect.any(Function));
    expect(push.addListener).toHaveBeenCalledWith('pushNotificationActionPerformed', expect.any(Function));

    unsubscribe();
    await vi.waitFor(() =>
      expect(push.removed.sort()).toEqual(['pushNotificationActionPerformed', 'pushNotificationReceived']),
    );
  });
});
