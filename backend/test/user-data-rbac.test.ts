import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { RequestAuthContext } from '../src/types.ts';

const WORKSPACE_ID = '11111111-1111-4000-a000-000000000001';
const SELF_USER_ID = 'aaaaaaaa-aaaa-4000-a000-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4000-b000-bbbbbbbbbbbb';

const mockDelete = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
  }),
});

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: () => ({
    from: vi.fn(() => ({
      delete: mockDelete,
    })),
  }),
}));

vi.mock('../src/config.ts', () => ({
  getConfig: () => ({
    port: 3001,
    logLevel: 'silent',
    aiManagerSupabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
    credentialEncryptionKey: 'testkey1234567890testkey1234567890',
  }),
}));

let storedCtx: RequestAuthContext | undefined;

vi.mock('../src/db/tenant.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/tenant.ts')>();
  return {
    ...actual,
    getAuthContext: () => storedCtx,
    effectiveUserId: (ctx: RequestAuthContext | undefined) => {
      if (!ctx) return null;
      if (ctx.mode === 'jwt') return ctx.userId;
      return ctx.forwardedUserId || ctx.userId || null;
    },
  };
});

import userDataRouter from '../src/routes/user-data.ts';
import express from 'express';

const testApp = express();
testApp.use(express.json());
testApp.use('/api/user-data', userDataRouter);

function setAuthContext(ctx: RequestAuthContext) {
  storedCtx = ctx;
}

describe('User-data deletion RBAC', () => {
  beforeEach(() => {
    storedCtx = undefined;
    mockDelete.mockClear();
  });

  describe('DELETE /:userId/sessions (flat trust — any member)', () => {
    it('allows member to delete another user sessions', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}/sessions`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:userId/diagnostic-logs (flat trust — any member)', () => {
    it('allows member to delete another user diagnostic logs', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}/diagnostic-logs`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:userId/credentials (strict isolation)', () => {
    it('allows self-deletion of credentials', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${SELF_USER_ID}/credentials`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });

    it('blocks member from deleting another user credentials', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}/credentials`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('admin');
    });

    it('allows admin to delete another user credentials', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'admin',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}/credentials`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:userId (full purge — self or admin)', () => {
    it('allows self full purge', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp).delete(`/api/user-data/${SELF_USER_ID}`).send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });

    it('blocks member from full purge of another user', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'member',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(403);
    });

    it('allows admin to full purge another user', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'admin',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });

    it('allows owner to full purge another user', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'owner',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp)
        .delete(`/api/user-data/${OTHER_USER_ID}`)
        .send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('rejects invalid UUID', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'admin',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp).delete('/api/user-data/not-a-uuid').send({ confirm: 'DELETE_USER_DATA' });

      expect(res.status).toBe(400);
    });

    it('requires confirmation string', async () => {
      setAuthContext({
        mode: 'api_key',
        workspaceId: WORKSPACE_ID,
        apiKeyId: 'key-1',
        apiKeyRole: 'admin',
        userId: SELF_USER_ID,
      });

      const res = await request(testApp).delete(`/api/user-data/${SELF_USER_ID}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Confirmation');
    });
  });
});
