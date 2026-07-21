/**
 * One-time AI Admin provisioning for Cadence, via the HTTP API + SK.
 * Discovers providers, registers the calling app, syncs profiles → jobs → workflow
 * (resolving cross-refs by slug across staged sync calls), verifies each profile
 * with a live run-slot, and prints the AIM_* ids to put in apps/cadence-api/.env.
 *
 * Run: node --import tsx apps/cadence-api/scripts/provision-aim.ts
 * Env (from backend/.env): VITE_DEV_API_KEY or AI_ADMIN_API_KEY [+ AI_ADMIN_BASE_URL].
 */
import { readFileSync } from 'node:fs';
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveJobProfileIds } from '../src/lib/job-profiles.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const BASE =
  rawBase.includes('/_/backend') || rawBase.includes('localhost')
    ? rawBase.replace(/\/+$/, '')
    : rawBase.replace(/\/+$/, '') + '/_/backend';
const CALLING_APP = 'platform:cadence';

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

  // 1. Providers
  const provs = (await api('GET', '/api/providers')).data as Array<{ id: string; type: string; workspace_id: string }>;
  const devsai = provs.find((p) => p.type === 'devs-ai');
  const gemini = provs.find((p) => p.type === 'google-gemini');
  if (!devsai) throw new Error('No devs-ai provider found');
  const workspaceId = devsai.workspace_id;
  const brokerProviderId = devsai.id; // Broker: gemini-2.0-flash via Devs.ai (never the native google-gemini provider)
  console.log(`workspace=${workspaceId} devsai=${devsai.id} gemini=${gemini?.id ?? '(none)'}`);

  // 2. Calling app
  try {
    await api('POST', '/api/calling-applications', { id: CALLING_APP, display_name: 'Cadence' });
    console.log(`calling app registered: ${CALLING_APP}`);
  } catch (e) {
    console.log(`calling app: ${(e as Error).message}`);
  }

  // 3. Profiles (resolve provider_id by slug)
  for (const p of cfg.profiles) {
    p.provider_id = p.slug === 'cadence-coach' ? devsai.id : brokerProviderId;
    p.failover_provider_id = p.provider_id;
  }
  console.log('sync profiles →', JSON.stringify(await api('POST', '/api/sync', { profiles: cfg.profiles })));
  const coachId = await idBySlug('/api/ai-profiles', 'cadence-coach');
  const brokerId = await idBySlug('/api/ai-profiles', 'cadence-broker');
  console.log(`coach=${coachId} broker=${brokerId}`);

  // 4. Verify each profile with a live run-slot
  for (const [name, id] of [
    ['coach', coachId],
    ['broker', brokerId],
  ] as const) {
    if (!id) continue;
    try {
      const r = await api('POST', '/api/ai-matcher/run-slot', {
        prompt: 'Reply with exactly: ok',
        slot: { type: 'profile', profileId: id },
        callingApplication: CALLING_APP,
      });
      console.log(`run-slot ${name}: status=${r.status} raw=${JSON.stringify(r.raw ?? r.formatted ?? '').slice(0, 80)}`);
    } catch (e) {
      console.log(`run-slot ${name} FAILED: ${(e as Error).message}`);
    }
  }

  // 5. Jobs — resolve each placeholder ai_profile_id from the TOKEN itself (the config names the
  // tier), preserving explicit UUIDs (e.g. parse-meal → the live Gemini vision profile). Shared
  // with scripts/sync-jobs.ts so the two can no longer drift: the previous hardcoded slug set had
  // to be kept "in lockstep" by hand and silently mis-tiered whatever was forgotten — first
  // assess-goal, then nutrition-baseline.
  resolveJobProfileIds(cfg.jobs, { coachId, brokerId });
  console.log('sync jobs →', JSON.stringify(await api('POST', '/api/sync', { jobs: cfg.jobs })));
  const jobIds: Record<string, string | null> = {};
  for (const slug of ['capture-extract', 'plan-vet', 'situation-assess', 'context-select', 'synthesize-plan', 'weekly-readout', 'surface-insights', 'disrupted-plan']) {
    jobIds[slug] = await idBySlug('/api/processing-jobs', slug);
  }
  console.log('jobs:', jobIds);

  // 6. Workflow (resolve ai_profile_id + step job ids)
  for (const w of cfg.workflows) {
    w.ai_profile_id = coachId;
    for (const s of w.steps) {
      if (s.step_key === 'assess') s.processing_job_id = jobIds['situation-assess'];
      if (s.step_key === 'synthesize') s.processing_job_id = jobIds['synthesize-plan'];
      if (s.step_key === 'vet') s.processing_job_id = jobIds['plan-vet'];
    }
    try {
      const r = await api('POST', '/api/workflows', w);
      console.log(`workflow ${w.slug}: created ${r.id ?? ''}`);
    } catch (e) {
      console.log(`workflow ${w.slug}: ${(e as Error).message}`);
    }
  }

  // 7. Emit the .env block
  console.log('\n=== apps/cadence-api/.env values ===');
  console.log(`AIM_WORKSPACE_ID=${workspaceId}`);
  console.log(`AIM_COACH_PROFILE_ID=${coachId}`);
  console.log(`AIM_BROKER_PROFILE_ID=${brokerId}`);
  console.log(`AIM_JOB_CAPTURE_EXTRACT_ID=${jobIds['capture-extract']}`);
  console.log(`AIM_JOB_PLAN_VET_ID=${jobIds['plan-vet']}`);
  console.log(`AIM_JOB_SYNTHESIZE_PLAN_ID=${jobIds['synthesize-plan']}`);
  console.log(`AIM_JOB_SITUATION_ASSESS_ID=${jobIds['situation-assess']}`);
  console.log(`AIM_JOB_CONTEXT_SELECT_ID=${jobIds['context-select']}`);
  console.log(`AIM_JOB_WEEKLY_READOUT_ID=${jobIds['weekly-readout']}`);
  console.log(`AIM_JOB_SURFACE_INSIGHTS_ID=${jobIds['surface-insights']}`);
  console.log(`AIM_JOB_DISRUPTED_PLAN_ID=${jobIds['disrupted-plan']}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('PROVISION FAIL:', e);
    process.exit(1);
  });
