import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config.ts';
import { getServiceSupabase } from './service-supabase.ts';
import type { RequestAuthContext } from '../types.ts';

type SupabaseQueryBuilder = ReturnType<SupabaseClient['from']>;

export const authStorage = new AsyncLocalStorage<RequestAuthContext>();

export function getAuthContext(): RequestAuthContext | undefined {
  return authStorage.getStore();
}

export function effectiveUserId(ctx: RequestAuthContext | undefined): string | null {
  if (!ctx) return null;
  if (ctx.mode === 'jwt') return ctx.userId;
  return ctx.forwardedUserId || ctx.userId || null;
}

export function requireWorkspaceId(): string {
  const ctx = getAuthContext();
  if (!ctx?.workspaceId) throw new Error('Missing workspace context (X-Workspace-Id header)');
  return ctx.workspaceId;
}

/** Attach `workspace_id` from auth context for NOT NULL tenant inserts. */
export function tenantInsertPayload<T extends Record<string, unknown>>(row: T): T & { workspace_id: string } {
  return { ...row, workspace_id: requireWorkspaceId() };
}

/**
 * PostgREST requires filters after an operation (select / update / delete), not directly on .from().
 * Inserts/upserts rely on workspace_id on the row (tenantInsertPayload).
 */
function scopedFrom(client: SupabaseClient, table: string, workspaceId: string): SupabaseQueryBuilder {
  const base = client.from(table);
  return new Proxy(base, {
    get(target: object, prop: string | symbol, receiver: unknown) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'select') {
        return (...args: unknown[]) => value.apply(target, args).eq('workspace_id', workspaceId);
      }
      if (prop === 'update') {
        return (...args: unknown[]) => value.apply(target, args).eq('workspace_id', workspaceId);
      }
      if (prop === 'delete') {
        return (...args: unknown[]) => value.apply(target, args).eq('workspace_id', workspaceId);
      }
      if (prop === 'insert') {
        return (rows: Record<string, unknown> | Record<string, unknown>[], ...rest: unknown[]) => {
          const inject = (row: Record<string, unknown>) => ({ ...row, workspace_id: workspaceId });
          const patched = Array.isArray(rows) ? rows.map(inject) : inject(rows);
          return value.apply(target, [patched, ...rest]);
        };
      }
      if (prop === 'upsert') {
        return (rows: Record<string, unknown> | Record<string, unknown>[], ...rest: unknown[]) => {
          const inject = (row: Record<string, unknown>) => ({ ...row, workspace_id: workspaceId });
          const patched = Array.isArray(rows) ? rows.map(inject) : inject(rows);
          return value.apply(target, [patched, ...rest]);
        };
      }
      return value.bind(target);
    },
  }) as SupabaseQueryBuilder;
}

/**
 * Start a table query scoped to the current request.
 * JWT: user client + optional workspace filter (required when user has multiple workspaces).
 * API key: service client + mandatory workspace_id filter on reads/writes.
 */
export function tenantFrom(table: string): SupabaseQueryBuilder {
  const ctx = getAuthContext();
  if (!ctx) {
    throw new Error('No auth context — tenantFrom() used outside authenticated request');
  }
  if (ctx.mode === 'jwt') {
    if (!ctx.workspaceId) return ctx.userClient.from(table);
    return scopedFrom(ctx.userClient, table, ctx.workspaceId);
  }
  return scopedFrom(getServiceSupabase(), table, ctx.workspaceId);
}

/**
 * Return the raw SupabaseClient scoped to the current tenant (for `.rpc()` calls etc.).
 */
export function tenantClient(): SupabaseClient {
  const ctx = getAuthContext();
  if (!ctx) throw new Error('No auth context — tenantClient() used outside authenticated request');
  if (ctx.mode === 'jwt') return ctx.userClient;
  return getServiceSupabase();
}

/**
 * Run a (possibly async) handler with auth context (used by Express middleware).
 * If `fn` returns a Promise, Node keeps AsyncLocalStorage active until it settles — required so
 * `tenantFrom()` / `getAuthContext()` work after `await` inside route handlers.
 */
export function runWithAuth<T>(ctx: RequestAuthContext, fn: () => T): T {
  return authStorage.run(ctx, fn);
}

/**
 * Create Supabase client with user's access token (RLS enforced).
 */
export function createUserSupabase(accessToken: string): SupabaseClient {
  const config = getConfig();
  const anon = config.aiManagerSupabase.anonKey;
  if (!anon) throw new Error('AI_MANAGER_SUPABASE_ANON_KEY is not configured');
  return createClient(config.aiManagerSupabase.url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
