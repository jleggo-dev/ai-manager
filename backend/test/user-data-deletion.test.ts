import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000099';

describe('User Data Deletion (GDPR / CCPA)', () => {
  describe('confirmation safeguard', () => {
    it('returns 400 when confirm field is missing', async () => {
      const res = await request(app).delete(`/api/user-data/${FAKE_USER_ID}`).set(authHeaders()).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Confirmation required/);
    });

    it('returns 400 when confirm field is wrong', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}`)
        .set(authHeaders())
        .send({ confirm: 'WRONG' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Confirmation required/);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await request(app)
        .delete('/api/user-data/not-a-uuid')
        .set(authHeaders())
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid userId/);
    });
  });

  describe('unauthenticated requests', () => {
    it('returns 401 for full purge without auth', async () => {
      const res = await request(app).delete(`/api/user-data/${FAKE_USER_ID}`).send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(401);
    });

    it('returns 401 for selective session deletion without auth', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/sessions`)
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(401);
    });

    it('returns 401 for selective diagnostic-logs deletion without auth', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/diagnostic-logs`)
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(401);
    });

    it('returns 401 for selective credentials deletion without auth', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/credentials`)
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(401);
    });
  });

  describe('full purge with valid auth', () => {
    it('returns deletion counts for full purge', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}`)
        .set(authHeaders())
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('deleted');
      expect(res.body.deleted).toHaveProperty('sessions');
      expect(res.body.deleted).toHaveProperty('diagnosticLogs');
      expect(res.body.deleted).toHaveProperty('credentials');
      expect(typeof res.body.deleted.sessions).toBe('number');
      expect(typeof res.body.deleted.diagnosticLogs).toBe('number');
      expect(typeof res.body.deleted.credentials).toBe('number');
    });
  });

  describe('selective deletion with valid auth', () => {
    it('returns deletion count for sessions only', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/sessions`)
        .set(authHeaders())
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toHaveProperty('sessions');
      expect(typeof res.body.deleted.sessions).toBe('number');
    });

    it('returns deletion count for diagnostic-logs only', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/diagnostic-logs`)
        .set(authHeaders())
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toHaveProperty('diagnosticLogs');
      expect(typeof res.body.deleted.diagnosticLogs).toBe('number');
    });

    it('returns deletion count for credentials only', async () => {
      const res = await request(app)
        .delete(`/api/user-data/${FAKE_USER_ID}/credentials`)
        .set(authHeaders())
        .send({ confirm: 'DELETE_USER_DATA' });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toHaveProperty('credentials');
      expect(typeof res.body.deleted.credentials).toBe('number');
    });
  });
});
