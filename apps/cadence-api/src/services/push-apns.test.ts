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
      bundleId: 'com.cadenceapp.ios',
      environment: 'development',
    },
  },
}));
vi.mock('../repos/device-tokens.ts', () => ({
  listDeviceTokens: vi.fn(async () => []),
  pruneDeadToken: vi.fn(),
}));

const { apnsConfigured, providerJwt, sendPushToUser } = await import('./push-apns.ts');

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
});
