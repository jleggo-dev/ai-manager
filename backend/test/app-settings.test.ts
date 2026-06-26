import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('App Settings', () => {
  const testKey = `test_setting_${Date.now()}`;
  const cleanupKeys: string[] = [];

  afterAll(async () => {
    for (const key of cleanupKeys) {
      await request(app).delete(`/api/settings/${key}`).set(authHeaders());
    }
  });

  it('lists settings as an array', async () => {
    const res = await request(app).get('/api/settings').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('upserts a setting via PUT /:key', async () => {
    cleanupKeys.push(testKey);
    const res = await request(app)
      .put(`/api/settings/${testKey}`)
      .set(authHeaders())
      .send({ value: 'hello', description: 'Integration test setting' });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(testKey);
    expect(res.body.value).toBe('hello');
  });

  it('gets a setting by key', async () => {
    const res = await request(app)
      .get(`/api/settings/${testKey}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(testKey);
    expect(res.body.value).toBe('hello');
  });

  it('deletes a setting', async () => {
    const deleteKey = `del_setting_${Date.now()}`;
    await request(app)
      .put(`/api/settings/${deleteKey}`)
      .set(authHeaders())
      .send({ value: 'temp' });

    const res = await request(app)
      .delete(`/api/settings/${deleteKey}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 404 for a missing key', async () => {
    const res = await request(app)
      .get('/api/settings/nonexistent_key_xyz')
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Setting not found');
  });
});
