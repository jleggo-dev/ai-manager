/**
 * Sign in with Apple client-secret expiry tripwire.
 *
 * Apple issues no static client secret: it is an ES256 JWT we sign ourselves, capped at SIX
 * MONTHS. Supabase performs the token exchange, so that long-lived secret has to sit in their
 * dashboard — meaning Apple sign-in breaks on a timer, with no deploy to correlate it to and a
 * generic auth error as the only symptom. A calendar reminder is the usual mitigation and it is
 * exactly as durable as the person who set it.
 *
 * So the deadline lives in the repo instead: `scripts/generate-apple-secret.ts` records the expiry
 * date it minted (never the secret) and the companion test fails once the renewal window opens.
 * CI goes red weeks before users are affected, which is the one signal that cannot be forgotten.
 *
 * Chosen over automated rotation through Supabase's Management API because a rotation job that
 * runs twice a year is untested when it matters; teams who automate this properly rotate monthly
 * so the path stays exercised. That is more operational surface than a solo maintainer needs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Renew with this much runway. A month is enough to notice, act, and not be rushed. */
export const RENEW_WINDOW_DAYS = 30;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const EXPIRY_RECORD_PATH = path.join(repoRoot, 'config/apple-signin-secret-expiry.json');

export interface ExpiryRecord {
  /** YYYY-MM-DD the Supabase client secret stops being accepted by Apple. */
  expiresOn: string;
  /** YYYY-MM-DD it was minted — context when reading the file cold. */
  generatedOn: string;
  /** Which Services ID it was minted for, so a mismatch is visible without decoding the JWT. */
  serviceId: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days from `now` until the expiry date (negative once past). Compared at UTC midnight so
 * the result never depends on the machine's timezone — a check that flips between a laptop and CI
 * is worse than no check.
 */
export function daysUntil(expiresOn: string, now: Date = new Date()): number {
  const expiry = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(expiry)) throw new Error(`Unparseable expiry date: "${expiresOn}"`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((expiry - today) / 86_400_000);
}

/** Read the committed record. Returns null when the file is absent — the caller decides. */
export function readExpiryRecord(filePath: string = EXPIRY_RECORD_PATH): ExpiryRecord | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<ExpiryRecord>;
  if (!parsed.expiresOn || !ISO_DATE.test(parsed.expiresOn)) {
    throw new Error(`${filePath} has no valid "expiresOn" (YYYY-MM-DD)`);
  }
  return {
    expiresOn: parsed.expiresOn,
    generatedOn: parsed.generatedOn ?? 'unknown',
    serviceId: parsed.serviceId ?? 'unknown',
  };
}

export interface ExpiryStatus {
  ok: boolean;
  daysRemaining: number;
  message: string;
}

/** The whole check, as data — so the test asserts on a value instead of re-deriving the rule. */
export function checkExpiry(record: ExpiryRecord, now: Date = new Date()): ExpiryStatus {
  const daysRemaining = daysUntil(record.expiresOn, now);
  const renew =
    'Re-mint it and update Supabase → Authentication → Providers → Apple:\n' +
    '  node --import tsx apps/cadence-api/scripts/generate-apple-secret.ts\n' +
    'then commit the refreshed config/apple-signin-secret-expiry.json.';
  if (daysRemaining < 0) {
    return {
      ok: false,
      daysRemaining,
      message: `Sign in with Apple EXPIRED ${-daysRemaining} day(s) ago (${record.expiresOn}). Apple sign-in is broken right now.\n${renew}`,
    };
  }
  if (daysRemaining <= RENEW_WINDOW_DAYS) {
    return {
      ok: false,
      daysRemaining,
      message: `Sign in with Apple client secret expires in ${daysRemaining} day(s) (${record.expiresOn}).\n${renew}`,
    };
  }
  return {
    ok: true,
    daysRemaining,
    message: `Sign in with Apple client secret valid for ${daysRemaining} more day(s) (${record.expiresOn}).`,
  };
}
