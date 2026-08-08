/**
 * Dispatcher guarantees. The valuable cases here are the ones that only show up under
 * concurrency or bad config, where the failure mode is an unrecallable buzz on someone's phone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claim = vi.fn();
const settle = vi.fn(async (..._a: unknown[]) => {});
const countSent = vi.fn(async (..._a: unknown[]) => 0);
const getPrefs = vi.fn();
const getUser = vi.fn();
const listTokens = vi.fn(async (..._a: unknown[]): Promise<string[]> => ['tok-1']);
const sendPush = vi.fn();
const configured = vi.fn(() => true);

vi.mock('../../repos/notifications.ts', () => ({
  claimNotificationSlot: (...a: unknown[]) => claim(...a),
  settleNotification: (...a: unknown[]) => settle(...a),
  countSentBetween: (...a: unknown[]) => countSent(...a),
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
}));
vi.mock('../../repos/device-tokens.ts', () => ({ listDeviceTokens: (...a: unknown[]) => listTokens(...a) }));
vi.mock('../../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../push-apns.ts', () => ({
  apnsConfigured: () => configured(),
  sendPushToUser: (...a: unknown[]) => sendPush(...a),
}));

const { notify, localDayRangeUtc } = await import('./dispatch.ts');

const REQ = { userId: 'u1', kind: 'session_reminder', target: '2026-08-07', title: 'T', body: 'B' };
const NOON = new Date('2026-08-07T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  claim.mockResolvedValue('notif-1');
  countSent.mockResolvedValue(0);
  listTokens.mockResolvedValue(['tok-1']);
  configured.mockReturnValue(true);
  getUser.mockResolvedValue({ timezone: 'Europe/London' });
  getPrefs.mockResolvedValue({ enabled: true, quietStartMin: 1260, quietEndMin: 420, kinds: {}, maxPerDay: 3 });
  sendPush.mockResolvedValue([{ token: 'tok-1', status: 200 }]);
});

describe('notify', () => {
  it('claims the slot BEFORE sending — the ordering that makes concurrency safe', async () => {
    const order: string[] = [];
    claim.mockImplementation(async () => {
      order.push('claim');
      return 'notif-1';
    });
    sendPush.mockImplementation(async () => {
      order.push('send');
      return [{ token: 'tok-1', status: 200 }];
    });
    await notify(REQ, NOON);
    expect(order).toEqual(['claim', 'send']);
  });

  it('does not send when the slot is already taken — a lost race must be silent', async () => {
    claim.mockResolvedValue(null);
    expect(await notify(REQ, NOON)).toEqual({ status: 'duplicate' });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('records a skip on the claimed row, so the slot is not reconsidered every tick', async () => {
    getPrefs.mockResolvedValue({ enabled: true, quietStartMin: 0, quietEndMin: 1439, kinds: {}, maxPerDay: 3 });
    const out = await notify(REQ, NOON);
    expect(out).toEqual({ status: 'skipped', reason: 'quiet_hours' });
    expect(sendPush).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith('notif-1', 'skipped', 'quiet_hours');
  });

  it('never sends when APNs is unconfigured, even if everything else is fine', async () => {
    configured.mockReturnValue(false);
    expect((await notify(REQ, NOON)).reason).toBe('not_configured');
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('counts a partial multi-device delivery as sent', async () => {
    sendPush.mockResolvedValue([
      { token: 'a', status: 200 },
      { token: 'b', status: 410, reason: 'Unregistered' },
    ]);
    expect(await notify(REQ, NOON)).toEqual({ status: 'sent' });
    expect(settle).toHaveBeenCalledWith('notif-1', 'sent', '1/2 device(s)');
  });

  it('records failure with APNs reasons when every device rejects', async () => {
    sendPush.mockResolvedValue([{ token: 'a', status: 403, reason: 'BadEnvironmentKeyInToken' }]);
    const out = await notify(REQ, NOON);
    expect(out.status).toBe('failed');
    expect(settle).toHaveBeenCalledWith('notif-1', 'failed', expect.stringContaining('BadEnvironmentKeyInToken'));
  });

  it('leaves the slot claimed when sending throws — a missed push beats a double one', async () => {
    sendPush.mockRejectedValue(new Error('APNs unreachable'));
    const out = await notify(REQ, NOON);
    expect(out.status).toBe('failed');
    // Settled, not released: releasing would let the next tick retry and risk a duplicate buzz.
    expect(settle).toHaveBeenCalledWith('notif-1', 'failed', expect.stringContaining('unreachable'));
  });

  it('does not let one user’s failure throw into the caller’s loop', async () => {
    getPrefs.mockRejectedValue(new Error('db down'));
    await expect(notify(REQ, NOON)).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('localDayRangeUtc', () => {
  it('brackets the user’s local day, not UTC’s', async () => {
    // 00:30 UTC on the 8th is still the 7th in New York; the range must start on their day.
    const r = localDayRangeUtc(new Date('2026-08-08T00:30:00Z'), 'America/New_York');
    expect(r!.fromIso).toBe('2026-08-07T04:00:00.000Z'); // local midnight = 04:00Z in EDT
    expect(r!.toIso).toBe('2026-08-08T04:00:00.000Z');
  });

  it('returns null for an unknown zone so the caller can fall back safely', () => {
    expect(localDayRangeUtc(new Date(), null)).toBeNull();
  });
});
