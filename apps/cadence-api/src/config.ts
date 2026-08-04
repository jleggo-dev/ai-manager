import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Env loading — single source of truth, NO duplication:
 *   backend/.env           → AI Admin engine secrets (the in-process engine reads these)
 *   apps/cadence-api/.env  → Cadence's own vars
 * Imported first in index.ts so vars exist before any engine call.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, 'backend/.env') });
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

/**
 * Build the Postgres connection string. Prefer a complete CADENCE_DATABASE_URL
 * (must contain '@'); otherwise assemble it from CADENCE_DB_PASSWORD plus the
 * pooler host/user (overridable). This avoids hand-editing a long URL: you only
 * ever paste the password, and it's URL-encoded so special chars can't break it.
 */
function buildDbUrl(): string {
  const full = process.env.CADENCE_DATABASE_URL;
  if (full && full.includes('@')) {
    // The DIRECT host (db.<ref>.supabase.co) is IPv6-ONLY — from an IPv4-only network (GitHub
    // Actions runners, most CI) every connect dies as ENETUNREACH on a 2600:… address, which
    // looks like a mystery outage and cost half a day on 2026-08-04. Say so up front; the value
    // that works everywhere is the POOLER (aws-*.pooler.supabase.com:6543, user postgres.<ref>).
    if (/@db\.[a-z0-9]+\.supabase\.co[:/]/.test(full)) {
      console.warn(
        '[config] CADENCE_DATABASE_URL points at the DIRECT Supabase host (db.*.supabase.co), ' +
          'which is IPv6-only — unreachable from IPv4-only environments like CI runners. ' +
          'Use the pooler URL (aws-*.pooler.supabase.com:6543) or set CADENCE_DB_PASSWORD instead.',
      );
    }
    return full;
  }

  const password = process.env.CADENCE_DB_PASSWORD;
  if (!password) {
    throw new Error('Set CADENCE_DB_PASSWORD (just the DB password) or a full CADENCE_DATABASE_URL');
  }
  const host = process.env.CADENCE_DB_HOST ?? 'aws-1-us-west-2.pooler.supabase.com';
  const port = process.env.CADENCE_DB_PORT ?? '6543';
  const user = process.env.CADENCE_DB_USER ?? 'postgres.qvukqinwmyvewzgcsgzt';
  const name = process.env.CADENCE_DB_NAME ?? 'postgres';
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

export const cadenceConfig = {
  port: parseInt(process.env.CADENCE_API_PORT ?? '3101', 10),

  /** When set, enables the header-based dev/test accounts ALONGSIDE real Supabase auth (see
   *  auth/middleware.ts). Leave unset in production so only real JWT auth is accepted. */
  devUserId: process.env.CADENCE_DEV_USER_ID ?? null,

  /**
   * Named dev accounts for testing without real auth. The client selects one via the
   * `X-Cadence-Dev-User` header; the middleware maps the slug to a fixed uuid (allowlisted here
   * so the client can't inject an arbitrary id). Two interchangeable scratch accounts — clear
   * either from the in-app Reset button or `scripts/account.ts reset <slug>`.
   */
  devAccounts: {
    'account-1': process.env.CADENCE_DEV_USER_ID ?? '00000000-0000-4000-a000-000000000001',
    'account-2': process.env.CADENCE_DEV_USER_ONGOING_ID ?? '00000000-0000-4000-a000-000000000002',
  } as Record<string, string>,

  /** Direct Postgres connection (Supabase pooler) — app data, `cadence` schema. */
  databaseUrl: buildDbUrl(),

  /** Supabase config — anon key validates JWTs; service key is server-only (Storage: meal photos). */
  supabase: {
    url: process.env.CADENCE_SUPABASE_URL ?? '',
    anonKey: process.env.CADENCE_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ?? '',
  },

  /** AI Admin entities Cadence drives (optional until provisioned + synced). */
  aim: {
    workspaceId: process.env.AIM_WORKSPACE_ID ?? '',
    callingApplication: process.env.AI_ADMIN_CALLING_APP ?? 'platform:cadence',
    coachProfileId: process.env.AIM_COACH_PROFILE_ID ?? '',
    brokerProfileId: process.env.AIM_BROKER_PROFILE_ID ?? '',
    /** The Coach chat is opened against this processing job (binds diagnostics + owns the persona). */
    coachJobSlug: process.env.AIM_COACH_JOB_SLUG ?? 'cadence-coach-chat',
    // The AIM_JOB_*_ID env layer is GONE (2026-08-04): every job call goes through
    // runJobBySlug with its canonical slug — the same name the config/sync layer uses — so no
    // environment has ids to provision and none can get them wrong. The layer's failure mode was
    // found by the DB suites' first CI run: absent ids all defaulted to '', every jobs.* compared
    // equal, and a slug-dispatching mock returned the SYNTHESIZE payload to the VET call — the
    // veto test committed. Eight env vars, three of them read by nothing, one silent collision.
    replanWorkflowSlug: process.env.AIM_WORKFLOW_REPLAN_SLUG ?? 'cadence-replan',
    /**
     * Fan-out → reduce planning: draft each goal in its own focused synthesize call, then a
     * coordinating reduce reconciles them into a tighter, balanced week (the single call covers but
     * over-scopes — 12 activities vs the reduce's 7, live-measured 2026-07-23). ON by default now
     * that the draft-priming prompt is synced; set AIM_PLAN_FANOUT=0 to disable (prod kill switch).
     */
    planFanout: process.env.AIM_PLAN_FANOUT !== '0',
  },

  /**
   * OpenWeatherMap — server-only (cadenceConfig.weatherApiKey). Never expose via VITE_* or
   * cadence-web. Set in apps/cadence-api/.env locally and the cadence-api Vercel project env.
   */
  weatherApiKey: process.env.WEATHER_API_KEY ?? '',

  /**
   * USDA FoodData Central (api.data.gov) — server-only. Never expose via VITE_* or cadence-web.
   * Set in apps/cadence-api/.env locally and the cadence-api Vercel project env in prod.
   */
  usdaApiKey: process.env.USDA_API_KEY ?? '',
};
