/**
 * Provision ONLY the cadence-food-check profile — never the full provision-aim pass.
 *
 * Same shape and same reasoning as provision-evolve-profile.ts: provision-aim.ts re-syncs every
 * profile and can clobber live model pointers back to config; `/api/sync` is upsert-by-slug and
 * touches only what is SENT, so this posts one profile and nothing else.
 *
 * Why this profile exists (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29): the
 * described-meal check runs on a small model of its own, chosen by the eval — gpt-5.4-mini
 * primary, claude-sonnet-5-5 failover (ruling 1). The pointers and the reasoning are on the
 * profile's description in ai-admin.config.json.
 *
 * The provider is read off the LIVE Broker profile (the food-check is a gpt-class schema job
 * and sits beside the Broker, same relay).
 *
 * THEN IT PROVES THE MODEL. Devs.ai lists models it will not run (2026-10-27: four catalog
 * entries answered 400 on every call), so a catalog check is not a proof. After the sync this
 * runs one live call through the new profile and prints what answered; a failure here means the
 * primary is not callable and the pointer must not be left as it is. The failover is not
 * exercised by this call — prove it with a live call too before relying on it.
 *
 * IT CREATES, IT DOES NOT RE-POINT. `/api/sync` upserts by slug, so a second run would write the
 * config's pointers over a live repoint (scripts/repoint-profile.ts is how a pointer moves). When
 * the profile already exists this stops and says so; `--force` overwrites it on purpose.
 *
 * Run:  npx tsx apps/cadence-api/scripts/provision-food-check-profile.ts
 * Then: npx tsx apps/cadence-api/scripts/sync-jobs.ts   (binds food-check to the new profile)
 */
import { readFileSync } from 'node:fs';
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const BASE =
  rawBase.includes('/_/backend') || rawBase.includes('localhost')
    ? rawBase.replace(/\/+$/, '')
    : rawBase.replace(/\/+$/, '') + '/_/backend';
const CALLING_APP = 'platform:cadence';
const SLUG = 'cadence-food-check';

if (!KEY) {
  console.error('No API key found (VITE_DEV_API_KEY / AI_ADMIN_API_KEY)');
  process.exit(1);
}

type Json = Record<string, unknown>;

async function api(method: string, p: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

type Profile = {
  id: string;
  slug?: string;
  provider_id?: string;
  external_ai_id?: string;
  failover_external_ai_id?: string;
};
async function liveProfiles(): Promise<Profile[]> {
  const list = (await api('GET', '/api/ai-profiles?limit=100')) as { data?: Profile[] };
  return list.data ?? [];
}

const cfg = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  profiles: Array<Record<string, unknown> & { slug: string }>;
};
const profile = cfg.profiles.find((p) => p.slug === SLUG);
if (!profile) throw new Error(`${SLUG} profile missing from ai-admin.config.json`);

const FORCE = process.argv.includes('--force');
const live = await liveProfiles();
const existing = live.find((p) => p.slug === SLUG);
if (existing && !FORCE) {
  console.log(
    `${SLUG} already exists → ${existing.id} (${existing.external_ai_id}, failover ${existing.failover_external_ai_id}). ` +
      'Nothing written: a re-run would overwrite a live repoint. Pass --force to overwrite on purpose.',
  );
  process.exit(0);
}
const broker = live.find((p) => p.slug === 'cadence-broker');
if (!broker?.provider_id) throw new Error('live cadence-broker profile not found — provision-aim has never run?');

profile.provider_id = broker.provider_id;
profile.failover_provider_id = broker.provider_id;
console.log(`provider (from live Broker): ${broker.provider_id}`);

const result = await api('POST', '/api/sync', { profiles: [profile] });
console.log('sync →', JSON.stringify(result));

const created = (await liveProfiles()).find((p) => p.slug === SLUG);
if (!created) throw new Error(`${SLUG} not found after sync`);
console.log(`${SLUG} → ${created.id} (${created.external_ai_id}, failover ${created.failover_external_ai_id})`);

// The proof: one live call through the profile. A catalog listing is not one.
try {
  const r = await api('POST', '/api/ai-matcher/run-slot', {
    prompt: 'Reply with exactly: ok',
    slot: { type: 'profile', profileId: created.id },
    callingApplication: CALLING_APP,
  });
  const answered = String(r.raw ?? r.formatted ?? '').slice(0, 80);
  console.log(`live call through ${SLUG}: status=${String(r.status)} answered=${JSON.stringify(answered)}`);
  if (!answered.trim()) throw new Error('the model answered nothing');
} catch (e) {
  console.error(`LIVE CALL FAILED through ${SLUG}: ${(e as Error).message}`);
  console.error(
    'The primary is not proved callable. Do not run sync-jobs until it is (scripts/list-v2-models.ts, scripts/repoint-profile.ts).',
  );
  process.exit(2);
}
console.log('next: npx tsx apps/cadence-api/scripts/sync-jobs.ts');
