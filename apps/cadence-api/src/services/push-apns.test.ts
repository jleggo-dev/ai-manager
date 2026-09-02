import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';

// Config is imported by the module under test; give it a real EC key so JWT minting works.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

vi.mock('../config.ts', () => ({
  cadenceConfig: {
    apns: {
      keyId: 'KEY123',
      teamId: 'TEAM456',
      privateKey: pem,
      bundleId: 'builders.cadence.app',
      environment: 'development',
    },
  },
}));
vi.mock('../repos/device-tokens.ts', () => ({
  listDeviceTokens: vi.fn(async () => []),
  pruneDeadToken: vi.fn(),
}));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn(async () => null) }));

const { apnsConfigured, buildPushPayload, providerJwt, sendPushToUser } = await import('./push-apns.ts');

describe('push-apns', () => {
  it('reports configured when key/team/private key are present', () => {
    expect(apnsConfigured()).toBe(true);
  });

  it('sends nothing (and succeeds) for a user with no registered devices', async () => {
    await expect(sendPushToUser('user-1', 'Cadence', 'hi')).resolves.toEqual([]);
  });

  it('mints an ES256 provider JWT with our kid/iss that verifies against the public key', () => {
    const jwt = providerJwt(1_000_000);
    const [h = '', c = '', s = ''] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM456', iat: 1000 });
    const verifier = createVerify('SHA256');
    verifier.update(`${h}.${c}`);
    expect(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('reuses the cached JWT inside the TTL and re-mints after it', () => {
    const first = providerJwt(2_000_000);
    expect(providerJwt(2_000_000 + 60_000)).toBe(first); // within 45 min
    expect(providerJwt(2_000_000 + 46 * 60_000)).not.toBe(first);
  });

  /**
   * The portrait keys. `mutable-content` is the whole reason a push can carry the coach's face:
   * it is what wakes CadenceNotificationService, which is the only place iOS lets us call
   * updating(from:) for a push. A payload without it delivers as-is — the app-icon notification
   * that shipped for months while the app donated an identity nothing could apply.
   */
  it('wakes the service extension and names the portrait when the user picked one', () => {
    const payload = buildPushPayload('Cadence', 'hi', {}, 'steady-pacer-neutral') as {
      aps: Record<string, unknown>;
      face_id?: string;
    };
    expect(payload.aps['mutable-content']).toBe(1);
    expect(payload.face_id).toBe('steady-pacer-neutral');
  });

  it('sends neither portrait key when no face is picked, so the extension is never woken for nothing', () => {
    const payload = buildPushPayload('Cadence', 'hi') as { aps: Record<string, unknown>; face_id?: string };
    expect(payload.aps).not.toHaveProperty('mutable-content');
    expect(payload).not.toHaveProperty('face_id');
  });

  it('keeps the alert, sound, category and extra payload alongside the portrait', () => {
    const payload = buildPushPayload('Cadence', 'hi', { categoryId: 'nudge', extra: { kind: 'ease' } }, 'x') as {
      aps: Record<string, unknown>;
      kind?: string;
    };
    expect(payload.aps).toMatchObject({ alert: { title: 'Cadence', body: 'hi' }, sound: 'default', category: 'nudge' });
    expect(payload.kind).toBe('ease');
  });
});
