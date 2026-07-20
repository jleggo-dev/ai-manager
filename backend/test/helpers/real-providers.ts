/**
 * Helpers for discovering real (non-mock) providers/profiles in e2e tests.
 *
 * Integration suites that open live Devs.ai chats must not pick leftover
 * fixtures from other tests (e.g. `https://cs-test.example.com`). Prefer
 * protected production names, then any provider whose base_url is not a
 * mock/RFC-2606 host.
 */

import type { Express } from 'express';
import request from 'supertest';

/** Exact display names that identify the real workspace providers. */
export const PROTECTED_PROVIDER_NAMES = new Set(['Devs.ai', 'Devs.ai v2', 'Google Gemini']);

export type ProviderLite = {
  id: string;
  name?: string | null;
  type?: string | null;
  base_url?: string | null;
};

export type ProfileLite = {
  id: string;
  mode?: string | null;
  external_ai_id?: string | null;
  profile_type?: string | null;
  provider_id?: string | null;
  provider?: {
    id?: string | null;
    name?: string | null;
    type?: string | null;
    base_url?: string | null;
  } | null;
};

/** True for RFC-2606 / local / obvious fixture hosts (never call these live). */
export function isMockProviderHost(baseUrl: string | null | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'example.com' || host.endsWith('.example.com')) return true;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
    if (host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.local')) return true;
    return false;
  } catch {
    return true;
  }
}

export function isProtectedProviderName(name: string | null | undefined): boolean {
  return Boolean(name && PROTECTED_PROVIDER_NAMES.has(name));
}

/**
 * True when the provider looks like a real configured provider.
 * Protected names always win; otherwise require a non-mock base_url.
 * List payloads that omit base_url and lack a protected name are rejected.
 */
export function isRealProvider(
  provider: { name?: string | null; base_url?: string | null } | null | undefined,
): boolean {
  if (!provider) return false;
  if (isProtectedProviderName(provider.name)) return true;
  if (provider.base_url != null && String(provider.base_url).trim() !== '')
    return !isMockProviderHost(provider.base_url);
  return false;
}

/** Merge list-join provider fields with a full providers map (adds base_url). */
export function enrichProfileProvider(profile: ProfileLite, providersById: Map<string, ProviderLite>): ProfileLite {
  const joined = profile.provider;
  const fromMap =
    (joined?.id ? providersById.get(joined.id) : undefined) ||
    (profile.provider_id ? providersById.get(profile.provider_id) : undefined);
  return {
    ...profile,
    provider: {
      id: joined?.id ?? fromMap?.id ?? null,
      type: joined?.type ?? fromMap?.type ?? null,
      name: joined?.name ?? fromMap?.name ?? null,
      base_url: joined?.base_url ?? fromMap?.base_url ?? null,
    },
  };
}

function rankDevsChatProfile(profile: ProfileLite): number {
  let score = 0;
  if (isProtectedProviderName(profile.provider?.name)) score += 100;
  if (profile.profile_type === 'agent') score += 10;
  return score;
}

/**
 * Pick the best live Devs.ai (v1) chat profile — skips mock hosts and prefers
 * the protected "Devs.ai" provider + agent profiles.
 */
export function pickDevsChatProfile(profiles: ProfileLite[], providers: ProviderLite[] = []): ProfileLite | null {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const candidates = profiles
    .map((p) => enrichProfileProvider(p, byId))
    .filter(
      (p) =>
        p.provider?.type === 'devs-ai' && p.mode === 'chat' && Boolean(p.external_ai_id) && isRealProvider(p.provider),
    );
  candidates.sort((a, b) => rankDevsChatProfile(b) - rankDevsChatProfile(a));
  return candidates[0] ?? null;
}

/** Keep only profiles whose backing provider is real (not *.example.com, etc.). */
export function filterRealProviderProfiles(profiles: ProfileLite[], providers: ProviderLite[] = []): ProfileLite[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  return profiles.map((p) => enrichProfileProvider(p, byId)).filter((p) => isRealProvider(p.provider));
}

/**
 * Discover a real Devs.ai chat profile via the API.
 * Fetches providers for base_url because GET /ai-profiles omits it on the join.
 */
export async function findDevsChatProfile(
  app: Express,
  authHeaders: () => Record<string, string>,
): Promise<ProfileLite | null> {
  const [profRes, provRes] = await Promise.all([
    request(app).get('/api/ai-profiles?limit=200').set(authHeaders()),
    request(app).get('/api/providers?limit=100').set(authHeaders()),
  ]);
  if (profRes.status !== 200) return null;
  const profiles = (profRes.body.data || []) as ProfileLite[];
  const providers = provRes.status === 200 ? ((provRes.body.data || []) as ProviderLite[]) : [];
  return pickDevsChatProfile(profiles, providers);
}
