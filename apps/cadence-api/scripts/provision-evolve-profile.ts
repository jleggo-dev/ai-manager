/**
 * Provision ONLY the cadence-evolve profile — never the full provision-aim pass.
 *
 * Same shape and same reasoning as provision-research-profile.ts: provision-aim.ts re-syncs
 * every profile and can clobber live model pointers back to config; `/api/sync` is
 * upsert-by-slug and touches only what is SENT, so this posts one profile and nothing else.
 *
 * Why this profile exists (owner ruling 2026-09-01): the evolve-plan job — plan ADJUSTMENTS,
 * not genesis — runs a faster model than the coach tier. The benchmark and the safety nets
 * behind the ruling are recorded on the profile's description in ai-admin.config.json and in
 * docs/cadence/PLAN-CHANGES.md.
 *
 * The provider is read off the LIVE Coach profile (evolve sits beside the coach, same relay).
 *
 * Run: npx tsx apps/cadence-api/scripts/provision-evolve-profile.ts
 * Then: npx tsx apps/cadence-api/scripts/sync-jobs.ts   (binds evolve-plan to the new profile)
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

const cfg = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  profiles: Array<Record<string, unknown> & { slug: string }>;
};
const evolve = cfg.profiles.find((p) => p.slug === 'cadence-evolve');
if (!evolve) throw new Error('cadence-evolve profile missing from ai-admin.config.json');

const list = (await api('GET', '/api/ai-profiles?limit=100')) as { data?: Array<Record<string, unknown>> };
const profiles = (list.data ?? []) as Array<{ id: string; slug?: string; provider_id?: string }>;
const coach = profiles.find((p) => p.slug === 'cadence-coach');
if (!coach?.provider_id) throw new Error('live cadence-coach profile not found — provision-aim has never run?');

evolve.provider_id = coach.provider_id;
evolve.failover_provider_id = coach.provider_id;
console.log(`provider (from live Coach): ${coach.provider_id}`);

const result = await api('POST', '/api/sync', { profiles: [evolve] });
console.log('sync →', JSON.stringify(result));

const after = (await api('GET', '/api/ai-profiles?limit=100')) as { data?: Array<Record<string, unknown>> };
const created = ((after.data ?? []) as Array<{ id: string; slug?: string; external_ai_id?: string }>).find(
  (p) => p.slug === 'cadence-evolve',
);
if (!created) throw new Error('cadence-evolve not found after sync');
console.log(`cadence-evolve → ${created.id} (${created.external_ai_id})`);
console.log('next: npx tsx apps/cadence-api/scripts/sync-jobs.ts');
