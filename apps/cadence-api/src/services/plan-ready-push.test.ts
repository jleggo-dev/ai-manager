/**
 * The plan-ready push must carry WHAT it announces (Gap 6, PLAN-CHANGES.md): it shipped as pure
 * text — no payload, so the app had nothing to refresh with; a push arrived and nothing moved.
 * `kind` + `target` already existed here as the idempotency key; these tests pin that they now
 * ride to the device too, and that the ledger behaviour around them is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apns = {
  apnsConfigured: vi.fn(),
  sendPushToUser: vi.fn(),
};
const ledger = {
  claimNotificationSlot: vi.fn(),
  settleNotification: vi.fn(),
};

vi.mock('./push-apns.ts', () => ({
  apnsConfigured: (...a: unknown[]) => apns.apnsConfigured(...a),
  sendPushToUser: (...a: unknown[]) => apns.sendPushToUser(...a),
}));
vi.mock('../repos/notifications.ts', () => ({
  claimNotificationSlot: (...a: unknown[]) => ledger.claimNotificationSlot(...a),
  settleNotification: (...a: unknown[]) => ledger.settleNotification(...a),
}));

const { sendPlanReadyPush } = await import('./plan-ready-push.ts');

beforeEach(() => {
  vi.clearAllMocks();
  apns.apnsConfigured.mockReturnValue(true);
  apns.sendPushToUser.mockResolvedValue([{ token: 't1', status: 200 }]);
  ledger.claimNotificationSlot.mockResolvedValue('n1');
});

describe('sendPlanReadyPush', () => {
  it('sends kind + target in the payload, so the app can refresh what the push announces', async () => {
    await sendPlanReadyPush('u1', 'replan_ready', 'plan-1', 'Your week is ready', 'Come take a look.');
    expect(apns.sendPushToUser).toHaveBeenCalledWith('u1', 'Your week is ready', 'Come take a look.', {
      extra: { kind: 'replan_ready', target: 'plan-1' },
    });
    expect(ledger.settleNotification).toHaveBeenCalledWith('n1', 'sent', '1/1 device(s)');
  });

  it('still settles the ledger as skipped when APNs is unconfigured — no payload sent at all', async () => {
    apns.apnsConfigured.mockReturnValue(false);
    await sendPlanReadyPush('u1', 'replan_committed', 'plan-2', 'Done', 'Your week landed.');
    expect(apns.sendPushToUser).not.toHaveBeenCalled();
    expect(ledger.settleNotification).toHaveBeenCalledWith('n1', 'skipped', 'not_configured');
  });

  it('records delivery failure without throwing — telling them must never undo the work', async () => {
    apns.sendPushToUser.mockResolvedValue([]);
    await expect(
      sendPlanReadyPush('u1', 'checkin_replan_ready', 'plan-3', 'Week 4 is ready', 'Built and waiting.'),
    ).resolves.toBeUndefined();
    expect(ledger.settleNotification).toHaveBeenCalledWith('n1', 'failed', 'no_devices');
  });
});
