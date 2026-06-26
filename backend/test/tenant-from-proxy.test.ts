import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestAuthContext } from '../src/types.ts';

const WORKSPACE_A = '11111111-1111-4000-a000-000000000001';
const WORKSPACE_B = '22222222-2222-4000-a000-000000000002';

interface ChainEntry {
  method: string;
  args: unknown[];
}

function findEntry(entries: ChainEntry[], method: string): ChainEntry {
  const entry = entries.find((c) => c.method === method);
  if (!entry) throw new Error(`Expected chain entry for method '${method}' not found`);
  return entry;
}

let chain: ChainEntry[] = [];

const chainBuilder: Record<string, (...args: unknown[]) => unknown> = {};
const record =
  (method: string) =>
  (...args: unknown[]) => {
    chain.push({ method, args });
    return chainBuilder;
  };

for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'order', 'limit', 'single', 'maybeSingle']) {
  chainBuilder[m] = record(m);
}

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: vi.fn(() => ({
    from: vi.fn(() => chainBuilder),
    rpc: vi.fn(),
  })),
}));

vi.mock('../src/config.ts', () => ({
  getConfig: () => ({
    aiManagerSupabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
  }),
}));

import { runWithAuth, tenantFrom, tenantInsertPayload, requireWorkspaceId } from '../src/db/tenant.ts';

const apiKeyCtx = (workspaceId: string): RequestAuthContext => ({
  mode: 'api_key' as const,
  workspaceId,
  apiKeyId: 'test-key-id',
  apiKeyRole: 'admin',
});

describe('tenantFrom() Proxy', () => {
  beforeEach(() => {
    chain = [];
  });

  describe('select', () => {
    it('appends .eq(workspace_id) on select', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_A), () => {
        tenantFrom('providers').select('*');
      });

      findEntry(chain, 'select');
      expect(findEntry(chain, 'eq').args).toEqual(['workspace_id', WORKSPACE_A]);
    });
  });

  describe('update', () => {
    it('appends .eq(workspace_id) on update', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_B), () => {
        tenantFrom('providers').update({ name: 'new' });
      });

      findEntry(chain, 'update');
      expect(findEntry(chain, 'eq').args).toEqual(['workspace_id', WORKSPACE_B]);
    });
  });

  describe('delete', () => {
    it('appends .eq(workspace_id) on delete', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_A), () => {
        tenantFrom('providers').delete();
      });

      findEntry(chain, 'delete');
      expect(findEntry(chain, 'eq').args).toEqual(['workspace_id', WORKSPACE_A]);
    });
  });

  describe('insert', () => {
    it('injects workspace_id into inserted row', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_A), () => {
        tenantFrom('providers').insert({ name: 'test' });
      });

      expect(findEntry(chain, 'insert').args[0]).toEqual({ name: 'test', workspace_id: WORKSPACE_A });
    });

    it('injects workspace_id into array of rows', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_B), () => {
        tenantFrom('providers').insert([{ name: 'a' }, { name: 'b' }]);
      });

      expect(findEntry(chain, 'insert').args[0]).toEqual([
        { name: 'a', workspace_id: WORKSPACE_B },
        { name: 'b', workspace_id: WORKSPACE_B },
      ]);
    });
  });

  describe('upsert', () => {
    it('injects workspace_id into upserted row', () => {
      runWithAuth(apiKeyCtx(WORKSPACE_A), () => {
        tenantFrom('providers').upsert({ id: 'x', name: 'test' });
      });

      expect(findEntry(chain, 'upsert').args[0]).toEqual({ id: 'x', name: 'test', workspace_id: WORKSPACE_A });
    });
  });

  describe('no auth context', () => {
    it('throws when called outside auth context', () => {
      expect(() => tenantFrom('providers')).toThrow('No auth context');
    });
  });
});

describe('tenantInsertPayload()', () => {
  it('adds workspace_id from auth context', () => {
    const result = runWithAuth(apiKeyCtx(WORKSPACE_A), () => {
      return tenantInsertPayload({ name: 'test' });
    });

    expect(result).toEqual({ name: 'test', workspace_id: WORKSPACE_A });
  });

  it('throws when no workspace context', () => {
    const ctx: RequestAuthContext = {
      mode: 'jwt' as const,
      workspaceId: null,
      userId: 'user-1',
      userClient: {} as never,
    };
    expect(() => runWithAuth(ctx, () => tenantInsertPayload({ name: 'test' }))).toThrow('Missing workspace context');
  });
});

describe('requireWorkspaceId()', () => {
  it('returns workspace ID from auth context', () => {
    const result = runWithAuth(apiKeyCtx(WORKSPACE_A), () => requireWorkspaceId());
    expect(result).toBe(WORKSPACE_A);
  });

  it('throws when workspace ID is missing', () => {
    const ctx: RequestAuthContext = {
      mode: 'jwt' as const,
      workspaceId: null,
      userId: 'user-1',
      userClient: {} as never,
    };
    expect(() => runWithAuth(ctx, () => requireWorkspaceId())).toThrow('Missing workspace context');
  });
});
