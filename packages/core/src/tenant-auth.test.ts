import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runWithAuth, getAuthContext, effectiveUserId, type RequestAuthContext } from './index.ts';

/**
 * Smoke test for the seam Cadence actually depends on at runtime: every AI Admin
 * engine call must happen inside `runWithAuth`, and `effectiveUserId` is what
 * decides which user id gets attributed to it (spec §8.1). This exercises the
 * real AsyncLocalStorage-backed context, not a mock of it.
 */
describe('@ai-admin/core tenant/auth seam', () => {
  it('scopes an api_key context to the callback and clears it afterward', () => {
    const ctx: RequestAuthContext = {
      mode: 'api_key',
      workspaceId: 'ws-1',
      apiKeyId: 'key-1',
      forwardedUserId: 'forwarded-user',
    };

    expect(getAuthContext()).toBeUndefined();
    runWithAuth(ctx, () => {
      expect(getAuthContext()).toBe(ctx);
    });
    expect(getAuthContext()).toBeUndefined();
  });

  it('effectiveUserId prefers forwardedUserId over userId for api_key contexts', () => {
    const forwarded: RequestAuthContext = {
      mode: 'api_key',
      workspaceId: 'ws-1',
      apiKeyId: 'key-1',
      userId: 'owner-of-the-key',
      forwardedUserId: 'forwarded-user',
    };
    expect(effectiveUserId(forwarded)).toBe('forwarded-user');

    const noForward: RequestAuthContext = {
      mode: 'api_key',
      workspaceId: 'ws-1',
      apiKeyId: 'key-1',
      userId: 'owner-of-the-key',
    };
    expect(effectiveUserId(noForward)).toBe('owner-of-the-key');
  });

  it('effectiveUserId always resolves to userId for jwt contexts', () => {
    const jwt: RequestAuthContext = {
      mode: 'jwt',
      workspaceId: 'ws-2',
      userId: 'user-2',
      userClient: {} as SupabaseClient,
    };
    expect(effectiveUserId(jwt)).toBe('user-2');
  });

  it('returns null when there is no context at all', () => {
    expect(effectiveUserId(undefined)).toBeNull();
  });
});
