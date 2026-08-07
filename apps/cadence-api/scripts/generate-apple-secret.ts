/**
 * Generate the "Secret Key" Supabase wants for the Apple auth provider.
 *
 * Apple does not issue a static client secret: it is an ES256 JWT you sign yourself, and Apple
 * caps its lifetime at SIX MONTHS. So this is not a one-time setup step — it is a recurring chore,
 * and when it lapses, Apple sign-in breaks for everyone with no code change to blame. Hence a
 * script (re-runnable, prints the expiry) rather than a value pasted once into a dashboard and
 * forgotten.
 *
 * Distinct from WeatherKit despite the same signing machinery: a DIFFERENT key (enabled for Sign
 * in with Apple), a DIFFERENT Services ID, and `aud: https://appleid.apple.com`.
 *
 * Run: node --import tsx apps/cadence-api/scripts/generate-apple-secret.ts
 * Reads APPLE_SIGNIN_{KEY_ID,TEAM_ID,SERVICE_ID,PRIVATE_KEY} from apps/cadence-api/.env.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSign, createPrivateKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EXPIRY_RECORD_PATH, RENEW_WINDOW_DAYS } from '../src/services/apple-secret-expiry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

/** Apple's hard ceiling. Six months minus a day, so a clock skew can't make Apple reject it. */
const MAX_LIFETIME_S = 15777000 - 86400;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

function main() {
  const keyId = process.env.APPLE_SIGNIN_KEY_ID ?? '';
  const teamId = process.env.APPLE_SIGNIN_TEAM_ID ?? '';
  const serviceId = process.env.APPLE_SIGNIN_SERVICE_ID ?? '';
  const privateKey = process.env.APPLE_SIGNIN_PRIVATE_KEY ?? '';

  const missing = Object.entries({
    APPLE_SIGNIN_KEY_ID: keyId,
    APPLE_SIGNIN_TEAM_ID: teamId,
    APPLE_SIGNIN_SERVICE_ID: serviceId,
    APPLE_SIGNIN_PRIVATE_KEY: privateKey,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`\nMissing in apps/cadence-api/.env:\n  ${missing.join('\n  ')}\n`);
    console.error('These are SEPARATE from the WEATHERKIT_* values — a different key and a');
    console.error('different Services ID. See docs/cadence/PLAN.md § Sign in with Apple.\n');
    process.exit(1);
  }

  // A common and confusing mistake: reusing the WeatherKit Services ID here. Apple will issue
  // tokens that Supabase then rejects for an audience mismatch, which reads like a Supabase bug.
  if (serviceId === process.env.WEATHERKIT_SERVICE_ID) {
    console.error('\nAPPLE_SIGNIN_SERVICE_ID is the same as WEATHERKIT_SERVICE_ID.');
    console.error('Sign in with Apple needs its OWN Services ID (with a return URL configured).\n');
    process.exit(1);
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MAX_LIFETIME_S;

  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(
    JSON.stringify({ iss: teamId, iat, exp, aud: 'https://appleid.apple.com', sub: serviceId }),
  );
  const signer = createSign('SHA256');
  signer.update(`${header}.${claims}`);
  const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');

  const expiresOn = new Date(exp * 1000).toISOString().slice(0, 10);

  console.log('\nSupabase → Authentication → Providers → Apple\n');
  console.log(`  Client IDs:  ${serviceId}`);
  console.log('  Secret Key:  (below)\n');
  console.log(`${header}.${claims}.${sig}\n`);
  console.log(`  Expires: ${expiresOn} — Apple's max is 6 months.`);

  // Record the DEADLINE (never the secret) so the tripwire in
  // src/services/apple-secret-expiry.test.ts can fail CI before users are affected. Writing this
  // is part of minting, not an optional follow-up: a secret rotated without updating the record
  // leaves the alarm set to the old date, which is worse than no alarm.
  const record = { expiresOn, generatedOn: new Date().toISOString().slice(0, 10), serviceId };
  writeFileSync(EXPIRY_RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n  Recorded the deadline in config/${path.basename(EXPIRY_RECORD_PATH)} — COMMIT IT.`);
  console.log(`  CI fails from ${RENEW_WINDOW_DAYS} days out, so this cannot lapse unnoticed.\n`);
}

main();
