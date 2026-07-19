/**
 * Sync ONLY the jobs from ai-admin.config.json to the live AI Admin (upsert by slug),
 * WITHOUT re-syncing profiles — so the Broker's live provider/model (devs-ai-v2 /
 * gemini-3.5-flash, set by set-broker-v2.ts) is preserved. Use after editing job config
 * such as adding expectedSchema for native structured output.
 * Run: node --import tsx apps/cadence-api/scripts/sync-jobs.ts
 * Env (from backend/.env): VITE_DEV_API_KEY or AI_ADMIN_API_KEY [+ AI_ADMIN_BASE_URL].
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

type Json = Record<string, any>;

async function api(method: string, p: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function idBySlug(listPath: string, slug: string): Promise<string | null> {
  const r = await api('GET', `${listPath}?limit=100`);
  const data = (r.data ?? r) as Array<{ id: string; slug?: string }>;
  return data.find((x) => x.slug === slug)?.id ?? null;
}

async function main() {
  const cfg = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8'));
  const coachId = await idBySlug('/api/ai-profiles', 'cadence-coach');
  const brokerId = await idBySlug('/api/ai-profiles', 'cadence-broker');
  if (!coachId || !brokerId) throw new Error(`missing profile ids coach=${coachId} broker=${brokerId}`);

  // Resolve ai_profile_id by slug the same way provision-aim does — coach jobs → coach,
  // everything else → broker. Profiles themselves are NOT synced here (deliberate).
  const coachJobs = new Set(['synthesize-plan', 'weekly-readout', 'disrupted-plan', 'assess-goal', 'prescribe-session']);
  for (const j of cfg.jobs) j.ai_profile_id = coachJobs.has(j.slug) ? coachId : brokerId;

  const r = await api('POST', '/api/sync', { jobs: cfg.jobs });
  console.log('sync jobs →', JSON.stringify(r));

  const withSchema = cfg.jobs.filter((j: any) => j.config?.expectedSchema).map((j: any) => j.slug);
  console.log('jobs carrying expectedSchema (native on v2):', withSchema.join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
