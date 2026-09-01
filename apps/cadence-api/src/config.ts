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
   * Diff-aware commit invalidation (plan-commit-diff.ts, PLAN-CHANGES.md Phase 1): on a plan
   * commit, future pending occurrences of activities the new version leaves unchanged survive
   * with their cached sessions instead of being wiped and re-authored (~34s per session — a
   * one-activity edit used to re-author the entire week). Set CADENCE_COMMIT_DIFF=0 to restore
   * the old wipe-everything commit — the prod kill switch if survivors ever misbehave.
   */
  commitDiff: process.env.CADENCE_COMMIT_DIFF !== '0',

  /**
   * APNs (native-shell push) — token-based auth with a .p8 key. All server-only; the key comes
   * from the Apple Developer portal (Keys → new key with APNs enabled). Optional until push
   * ships: apnsConfigured() gates every send, so an unset block just means "push off".
   * APNS_PRIVATE_KEY holds the .p8 PEM contents (literal \n escapes fine — the sender unescapes).
   */
  apns: {
    keyId: process.env.APNS_KEY_ID ?? '',
    teamId: process.env.APNS_TEAM_ID ?? '',
    privateKey: process.env.APNS_PRIVATE_KEY ?? '',
    bundleId: process.env.APNS_BUNDLE_ID ?? 'builders.cadence.app',
    environment: (process.env.APNS_ENVIRONMENT === 'production' ? 'production' : 'development') as
      'development' | 'production',
  },

  /**
   * Shared secret for the scheduler tick (POST /internal/notifications/tick). Set identically on
   * this API and on whatever drives the cron (GitHub Actions secret, or Vercel cron on Pro).
   *
   * UNSET MEANS THE ENDPOINT REFUSES EVERYTHING — it fails closed. An open tick endpoint would
   * let anyone drain a user's daily notification budget, and an env var missing from one
   * environment is a normal deployment slip, so the default has to be the safe one.
   */
  cronSecret: process.env.CADENCE_CRON_SECRET ?? '',

  /**
   * OpenWeatherMap — server-only (cadenceConfig.weatherApiKey). Never expose via VITE_* or
   * cadence-web. Set in apps/cadence-api/.env locally and the cadence-api Vercel project env.
   * Still wired after WeatherKit landed: it is the FALLBACK when WeatherKit is unconfigured or
   * erroring, and it remains the only geocoder (WeatherKit has no city → lat/lon endpoint).
   */
  weatherApiKey: process.env.WEATHER_API_KEY ?? '',

  /**
   * Apple WeatherKit (REST) — server-only, same .p8/ES256 shape as APNs but a different claim set
   * (`sub` = the Services ID; APNs has no `sub`). Preferred source when configured so an iOS
   * user's Cadence forecast matches their lock screen; OpenWeatherMap stays as fallback.
   * Unset = WeatherKit off, and everything silently keeps using OWM.
   * serviceId is the *Services ID* identifier, NOT the app's bundle ID.
   */
  weatherkit: {
    keyId: process.env.WEATHERKIT_KEY_ID ?? '',
    teamId: process.env.WEATHERKIT_TEAM_ID ?? '',
    serviceId: process.env.WEATHERKIT_SERVICE_ID ?? '',
    privateKey: process.env.WEATHERKIT_PRIVATE_KEY ?? '',
  },

  /**
   * USDA FoodData Central (api.data.gov) — server-only. Never expose via VITE_* or cadence-web.
   * Set in apps/cadence-api/.env locally and the cadence-api Vercel project env in prod.
   */
  usdaApiKey: process.env.USDA_API_KEY ?? '',

  /**
   * FatSecret Platform API — server-only, for the branded and restaurant foods USDA's whole-food
   * datasets cannot hold (A23 §4). Empty means the rung is simply absent: the resolver already
   * falls through to pinning an estimate, so an unset key degrades coverage and breaks nothing.
   *
   * OAuth 1.0 rather than 2.0 on purpose — their OAuth 2.0 requires an IP allowlist and this API
   * runs on Vercel serverless, which has no fixed egress address. 1.0 signs per request instead.
   */
  fatSecret: {
    consumerKey: process.env.FATSECRET_CONSUMER_KEY ?? '',
    consumerSecret: process.env.FATSECRET_CONSUMER_SECRET ?? '',
  },
};
