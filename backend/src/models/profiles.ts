import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { AccountStatus } from '../constants/account-status.ts';
import type { PaginationParams, PaginatedResponse } from '../lib/pagination.ts';
import { buildPaginatedResponse } from '../lib/pagination.ts';

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  status: AccountStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserListItem extends ProfileRow {
  last_sign_in_at: string | null;
  auth_created_at: string | null;
}

export interface ListProfilesOptions {
  status?: AccountStatus;
  search?: string;
  pagination: PaginationParams;
}

function svc(): SupabaseClient {
  return getServiceSupabase();
}

/** Fetch a single profile by auth user id (service role). */
export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await svc().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProfileRow | null;
}

/** Ensure a profile row exists (defensive if trigger did not run). */
export async function ensureProfileRow(
  userId: string,
  email: string | null,
  displayName: string | null,
): Promise<ProfileRow> {
  const existing = await getProfile(userId);
  if (existing) return existing;

  const { data, error } = await svc()
    .from('profiles')
    .insert({
      id: userId,
      email,
      display_name: displayName,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ProfileRow;
}

/** List profiles with optional status filter and email/name search. */
export async function listProfiles(options: ListProfilesOptions): Promise<PaginatedResponse<ProfileRow>> {
  const { status, search, pagination } = options;
  let query = svc()
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pagination.limit + 1);

  if (status) query = query.eq('status', status);
  if (search?.trim()) {
    const term = search.trim().replace(/,/g, ' ');
    query = query.or(`email.ilike.%${term}%,display_name.ilike.%${term}%`);
  }
  if (pagination.cursor) {
    if (pagination.direction === 'prev') {
      query = query.gt('created_at', pagination.cursor);
    } else {
      query = query.lt('created_at', pagination.cursor);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return buildPaginatedResponse((data || []) as ProfileRow[], pagination);
}

/** Update account status and audit fields (service role). */
export async function setProfileStatus(
  userId: string,
  status: AccountStatus,
  approverId: string | null,
): Promise<ProfileRow> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === 'approved') {
    patch.approved_by = approverId;
    patch.approved_at = now;
  } else if (status === 'pending') {
    patch.approved_by = null;
    patch.approved_at = null;
  }

  const { data, error } = await svc().from('profiles').update(patch).eq('id', userId).select('*').single();
  if (error) throw new Error(error.message);
  return data as ProfileRow;
}

/** Enrich profile rows with auth.users metadata via admin API. */
export async function enrichProfilesWithAuthMeta(
  profiles: ProfileRow[],
): Promise<AdminUserListItem[]> {
  if (!profiles.length) return [];

  const svcClient = svc();
  const authById = new Map<string, { last_sign_in_at: string | null; created_at: string | null }>();

  // Paginate through auth users (Supabase returns up to 1000 per page)
  let page = 1;
  const perPage = 1000;
  const targetIds = new Set(profiles.map((p) => p.id));

  while (targetIds.size > authById.size) {
    const { data, error } = await svcClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    if (!users.length) break;

    for (const u of users) {
      if (targetIds.has(u.id)) {
        authById.set(u.id, {
          last_sign_in_at: u.last_sign_in_at ?? null,
          created_at: u.created_at ?? null,
        });
      }
    }

    if (users.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }

  return profiles.map((p) => {
    const meta = authById.get(p.id);
    return {
      ...p,
      last_sign_in_at: meta?.last_sign_in_at ?? null,
      auth_created_at: meta?.created_at ?? null,
    };
  });
}

/** Add approved user to default workspace as member if not already a member. */
export async function ensureDefaultWorkspaceMembership(userId: string): Promise<void> {
  const client = svc();
  const { data: defWs, error: wErr } = await client
    .from('workspaces')
    .select('id')
    .eq('slug', 'default')
    .maybeSingle();
  if (wErr) throw new Error(wErr.message);
  if (!defWs?.id) throw new Error('Default workspace missing');

  const { data: existing, error: mErr } = await client
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('workspace_id', defWs.id)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (existing) return;

  const { error: insErr } = await client.from('workspace_members').insert({
    workspace_id: defWs.id,
    user_id: userId,
    role: 'member',
  });
  if (insErr) throw new Error(insErr.message);
}
