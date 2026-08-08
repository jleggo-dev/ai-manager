import http2 from 'node:http2';
import { createSign, createPrivateKey } from 'node:crypto';
import { cadenceConfig } from '../config.ts';
import { listDeviceTokens, pruneDeadToken } from '../repos/device-tokens.ts';

/**
 * APNs sender — token-based auth (.p8 key, ES256 provider JWT) over HTTP/2, no SDK dependency.
 * v1 scope (iOS milestone): a working send path + the dev test endpoint. Nothing schedules
 * pushes yet — that lands with the proactive check-in cadence (PLAN.md §12 B).
 */

const APNS_HOSTS = {
  development: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

/** Provider JWTs may be reused for up to an hour; refresh at 45 min. */
const JWT_TTL_MS = 45 * 60 * 1000;
let cachedJwt: { value: string; mintedAt: number } | null = null;

export function apnsConfigured(): boolean {
  const { keyId, teamId, privateKey } = cadenceConfig.apns;
  return Boolean(keyId && teamId && privateKey);
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Mint (or reuse) the ES256 provider token Apple authenticates us with. Exported for tests. */
export function providerJwt(nowMs = Date.now()): string {
  const age = cachedJwt ? nowMs - cachedJwt.mintedAt : -1;
  if (cachedJwt && age >= 0 && age < JWT_TTL_MS) return cachedJwt.value;
  const { keyId, teamId, privateKey } = cadenceConfig.apns;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${claims}`);
  // .p8 keys arrive via env with literal \n; dsaEncoding ieee-p1363 is the JWT (r||s) form.
  const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  cachedJwt = { value: `${header}.${claims}.${sig}`, mintedAt: nowMs };
  return cachedJwt.value;
}

export interface PushResult {
  token: string;
  status: number;
  reason?: string;
}

/** One HTTP/2 POST to APNs for one device token. Resolves with the status; never throws on 4xx. */
function sendToToken(token: string, payload: object, jwt: string): Promise<PushResult> {
  return new Promise((resolve, reject) => {
    const host = APNS_HOSTS[cadenceConfig.apns.environment];
    const client = http2.connect(host);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': cadenceConfig.apns.bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      client.close();
      let reason: string | undefined;
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
      } catch {
        reason = body || undefined;
      }
      resolve({ token, status, reason });
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

/**
 * Send an alert push to every device a user has registered. Dead tokens (410, or 400
 * BadDeviceToken) are pruned as APNs reports them. Returns per-token results for the caller to
 * log; throws only when APNs is unconfigured or unreachable.
 */
export async function sendPushToUser(userId: string, title: string, bodyText: string): Promise<PushResult[]> {
  if (!apnsConfigured()) throw new Error('APNs is not configured (APNS_KEY_ID/TEAM_ID/PRIVATE_KEY)');
  const tokens = await listDeviceTokens(userId);
  if (tokens.length === 0) return [];
  const jwt = providerJwt();
  const payload = { aps: { alert: { title, body: bodyText }, sound: 'default' } };
  const results: PushResult[] = [];
  for (const token of tokens) {
    const r = await sendToToken(token, payload, jwt);
    if (r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken')) {
      await pruneDeadToken(token);
    }
    // Apple issues environment-SCOPED APNs keys, so the key and the host must agree. This reason
    // names neither, and the natural reading ("bad token") sends you hunting the wrong thing —
    // every device would fail, not one. Say what to actually change.
    if (r.reason === 'BadEnvironmentKeyInToken') {
      console.error(
        `[apns] BadEnvironmentKeyInToken — APNS_KEY_ID (${cadenceConfig.apns.keyId}) is not valid for ` +
          `APNS_ENVIRONMENT=${cadenceConfig.apns.environment}. They are a matched pair: the Sandbox key ` +
          'goes with development, the Production key with production. Nothing about the device token is wrong.',
      );
    }
    results.push(r);
  }
  return results;
}
