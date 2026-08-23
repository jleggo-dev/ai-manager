/**
 * Provision ONLY the cadence-research profile — never the full provision-aim pass.
 *
 * provision-aim.ts re-syncs every profile, and the memory of 2026-08 is exactly why that is not
 * run casually: live model pointers that drifted from config get clobbered back. `/api/sync` is
 * upsert-by-slug and touches only what is SENT, so this posts one profile and nothing else.
 *
 * The provider is read off the LIVE Broker profile rather than discovered by type — whatever
 * provider the Broker actually runs on today is the one that works, and the research profile
 * should sit beside it.
 *
 * Run: npx tsx apps/cadence-api/scripts/provision-research-profile.ts
 * Then: npx tsx apps/cadence-api/scripts/sync-jobs.ts   (binds research-food to the new profile)
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
const research = cfg.profiles.find((p) => p.slug === 'cadence-research');
if (!research) throw new Error('cadence-research profile missing from ai-admin.config.json');

const list = (await api('GET', '/api/ai-profiles?limit=100')) as { data?: Array<Record<string, unknown>> };
const profiles = (list.data ?? []) as Array<{ id: string; slug?: string; provider_id?: string }>;
const broker = profiles.find((p) => p.slug === 'cadence-broker');
if (!broker?.provider_id) throw new Error('live cadence-broker profile not found — provision-aim has never run?');

research.provider_id = broker.provider_id;
research.failover_provider_id = broker.provider_id;
console.log(`provider (from live Broker): ${broker.provider_id}`);

const result = await api('POST', '/api/sync', { profiles: [research] });
console.log('sync →', JSON.stringify(result));

const after = (await api('GET', '/api/ai-profiles?limit=100')) as { data?: Array<Record<string, unknown>> };
const created = ((after.data ?? []) as Array<{ id: string; slug?: string; external_ai_id?: string }>).find(
  (p) => p.slug === 'cadence-research',
);
if (!created) throw new Error('cadence-research not found after sync');
console.log(`cadence-research → ${created.id} (${created.external_ai_id})`);
console.log('next: npx tsx apps/cadence-api/scripts/sync-jobs.ts');
