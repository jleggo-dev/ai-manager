/**
 * BE-03 / BE-03a — RBAC route guards.
 *
 * BE-03: mutating routes (POST/PUT/PATCH/DELETE) on the admin-sensitive AI Admin routers
 * require an owner/admin role, while most GET/list routes stay member-readable (the plan's
 * "don't over-gate the reads" constraint).
 *
 * BE-03a (product decision): `diagnostic-logs` is the exception — GETs (and DELETEs) require
 * owner/admin because logs may contain sensitive prompt/response content.
 *
 * The `requireRole` api_key branch returns 403 from `ctx.apiKeyRole` directly (no DB), so the
 * mutating-route assertions need no Supabase mock. GET-open assertions reach the handler, so
 * `tenantFrom` is stubbed to a fast chainable that never touches the network. api-keys.ts gates the
 * JWT path (it already blocks api_key mode outright), so its member case uses a JWT ctx + a mocked
 * workspace_members lookup. diagnostic-logs model is stubbed so admin GETs do not hit the network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { RequestAuthContext, WorkspaceRole } from '../src/types.ts';

const WORKSPACE_ID = '11111111-1111-4000-a000-000000000001';
const USER_ID = 'aaaaaaaa-aaaa-4000-a000-aaaaaaaaaaaa';

/** A thenable Supabase-style chain: every method returns itself; awaiting resolves `result`. */
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'gte',
    'lte',
    'order',
    'limit',
    'range',
    'match',
    'or',
    'filter',
    'single',
    'maybeSingle',
  ];
  for (const m of methods) c[m] = () => c;
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return c;
}

let storedCtx: RequestAuthContext | undefined;
let membershipRole: WorkspaceRole | null = null;

vi.mock('../src/config.ts', () => ({
  getConfig: () => ({
    port: 3001,
    logLevel: 'silent',
    aiManagerSupabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
    credentialEncryptionKey: 'testkey1234567890testkey1234567890',
  }),
}));

vi.mock('../src/db/tenant.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/tenant.ts')>();
  return {
    ...actual,
    getAuthContext: () => storedCtx,
    tenantFrom: () => chain({ data: [], error: null }),
    tenantInsertPayload: (p: Record<string, unknown>) => p,
  };
});

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: () => ({
    from: () => chain({ data: membershipRole ? { role: membershipRole } : null, error: null }),
  }),
}));

vi.mock('../src/models/diagnostic-logs.ts', () => ({
  listDiagnosticLogs: vi.fn(async () => []),
  getDiagnosticLog: vi.fn(async () => ({ id: 'log-1' })),
  deleteDiagnosticLog: vi.fn(async () => undefined),
  clearDiagnosticLogs: vi.fn(async () => undefined),
  getDiagTokenUsageStats: vi.fn(async () => ({
    sampleSize: 0,
    totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    byJob: {},
    byModel: {},
    byUser: {},
  })),
}));

// Routers under test (imported after mocks are declared).
import appSettingsRouter from '../src/routes/app-settings.ts';
import callingApplicationsRouter from '../src/routes/calling-applications.ts';
import providersRouter from '../src/routes/providers.ts';
import aiProfilesRouter from '../src/routes/ai-profiles.ts';
import processingJobsRouter from '../src/routes/processing-jobs.ts';
import workflowsRouter from '../src/routes/workflows.ts';
import apiKeysRouter from '../src/routes/api-keys.ts';
import diagnosticLogsRouter from '../src/routes/diagnostic-logs.ts';

function mount(router: express.Router, base: string) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  return app;
}

const apiKeyCtx = (role: WorkspaceRole): RequestAuthContext => ({
  mode: 'api_key',
  workspaceId: WORKSPACE_ID,
  apiKeyId: 'key-1',
  apiKeyRole: role,
  userId: USER_ID,
});
// requireRole never reads userClient (it uses the service client for the membership lookup), so a
// stub satisfies the type without a real Supabase client.
const jwtCtx = (): RequestAuthContext => ({
  mode: 'jwt',
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  userClient: {} as never,
});

beforeEach(() => {
  storedCtx = undefined;
  membershipRole = null;
});

/** Each entry: router + base path + a representative mutating request + a representative GET. */
const CORE = [
  {
    name: 'app-settings',
    router: appSettingsRouter,
    base: '/app-settings',
    mutate: (a: express.Express) => request(a).put('/app-settings/some-key').send({ value: 1 }),
    read: (a: express.Express) => request(a).get('/app-settings/'),
  },
  {
    name: 'calling-applications',
    router: callingApplicationsRouter,
    base: '/calling-applications',
    mutate: (a: express.Express) => request(a).post('/calling-applications/').send({ id: 'x' }),
    read: (a: express.Express) => request(a).get('/calling-applications/'),
  },
  {
    name: 'providers',
    router: providersRouter,
    base: '/providers',
    mutate: (a: express.Express) => request(a).post('/providers/').send({}),
    read: (a: express.Express) => request(a).get('/providers/'),
  },
  {
    name: 'ai-profiles',
    router: aiProfilesRouter,
    base: '/ai-profiles',
    mutate: (a: express.Express) => request(a).post('/ai-profiles/').send({}),
    read: (a: express.Express) => request(a).get('/ai-profiles/'),
  },
  {
    name: 'processing-jobs',
    router: processingJobsRouter,
    base: '/processing-jobs',
    mutate: (a: express.Express) => request(a).post('/processing-jobs/').send({}),
    read: (a: express.Express) => request(a).get('/processing-jobs/'),
  },
  {
    name: 'workflows',
    router: workflowsRouter,
    base: '/workflows',
    mutate: (a: express.Express) => request(a).post('/workflows/').send({}),
    read: (a: express.Express) => request(a).get('/workflows/'),
  },
] as const;

describe('BE-03 RBAC route guards', () => {
  describe.each(CORE)('$name', ({ router, base, mutate, read }) => {
    it('blocks a member (api_key) on a mutating route with 403', async () => {
      storedCtx = apiKeyCtx('member');
      const res = await mutate(mount(router, base));
      expect(res.status).toBe(403);
    });

    it('allows a member (api_key) past the role gate on a mutating route (admin role)', async () => {
      storedCtx = apiKeyCtx('admin');
      const res = await mutate(mount(router, base));
      expect(res.status).not.toBe(403);
    });

    it('leaves GET/list member-readable (never 403)', async () => {
      storedCtx = apiKeyCtx('member');
      const res = await read(mount(router, base));
      expect(res.status).not.toBe(403);
    });
  });

  describe('api-keys (JWT path)', () => {
    it('blocks a member (JWT) from creating an API key with 403', async () => {
      storedCtx = jwtCtx();
      membershipRole = 'member';
      const res = await request(mount(apiKeysRouter, '/api-keys')).post('/api-keys/').send({ name: 'k' });
      expect(res.status).toBe(403);
    });

    it('lets an admin (JWT) past the role gate when creating an API key', async () => {
      storedCtx = jwtCtx();
      membershipRole = 'admin';
      const res = await request(mount(apiKeysRouter, '/api-keys')).post('/api-keys/').send({ name: 'k' });
      expect(res.status).not.toBe(403);
    });

    it('still blocks api_key-mode callers from managing keys (existing guard intact)', async () => {
      storedCtx = apiKeyCtx('admin');
      const res = await request(mount(apiKeysRouter, '/api-keys')).post('/api-keys/').send({ name: 'k' });
      expect(res.status).toBe(403);
    });

    it('leaves the key list readable to a JWT member (not gated)', async () => {
      storedCtx = jwtCtx();
      membershipRole = 'member';
      const res = await request(mount(apiKeysRouter, '/api-keys')).get('/api-keys/');
      expect(res.status).not.toBe(403);
    });
  });

  /** BE-03a — diagnostic-logs GETs (and DELETEs) require owner/admin. */
  describe('diagnostic-logs (BE-03a)', () => {
    const app = () => mount(diagnosticLogsRouter, '/diagnostic-logs');

    it('blocks a member (api_key) on GET list with 403', async () => {
      storedCtx = apiKeyCtx('member');
      const res = await request(app()).get('/diagnostic-logs/');
      expect(res.status).toBe(403);
    });

    it('blocks a member (api_key) on GET token-stats with 403', async () => {
      storedCtx = apiKeyCtx('member');
      const res = await request(app()).get('/diagnostic-logs/token-stats');
      expect(res.status).toBe(403);
    });

    it('blocks a member (api_key) on GET by id with 403', async () => {
      storedCtx = apiKeyCtx('member');
      const res = await request(app()).get('/diagnostic-logs/log-1');
      expect(res.status).toBe(403);
    });

    it('lets an admin (api_key) read the list (not 403)', async () => {
      storedCtx = apiKeyCtx('admin');
      const res = await request(app()).get('/diagnostic-logs/');
      expect(res.status).not.toBe(403);
    });

    it('lets an owner (api_key) read token-stats (not 403)', async () => {
      storedCtx = apiKeyCtx('owner');
      const res = await request(app()).get('/diagnostic-logs/token-stats');
      expect(res.status).not.toBe(403);
    });

    it('blocks a member (JWT) on GET list with 403', async () => {
      storedCtx = jwtCtx();
      membershipRole = 'member';
      const res = await request(app()).get('/diagnostic-logs/');
      expect(res.status).toBe(403);
    });

    it('lets an admin (JWT) past the role gate on GET list', async () => {
      storedCtx = jwtCtx();
      membershipRole = 'admin';
      const res = await request(app()).get('/diagnostic-logs/');
      expect(res.status).not.toBe(403);
    });
  });
});
