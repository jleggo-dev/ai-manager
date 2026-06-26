import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueSlug } from './setup.ts';

describe('Calling Applications CRUD', () => {
  let appId: string;
  const cleanupIds: string[] = [];

  afterAll(async () => {
    for (const id of cleanupIds.reverse()) {
      await request(app)
        .delete(`/api/calling-applications/${id}`)
        .set(authHeaders());
    }
  });

  it('lists calling applications with pagination', async () => {
    const res = await request(app)
      .get('/api/calling-applications')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('creates a calling application', async () => {
    appId = uniqueSlug('test-app');
    cleanupIds.push(appId);

    const res = await request(app)
      .post('/api/calling-applications')
      .set(authHeaders())
      .send({ id: appId, display_name: 'Test Application' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(appId);
    expect(res.body.display_name).toBe('Test Application');
  });

  it('gets a calling application by ID', async () => {
    const res = await request(app)
      .get(`/api/calling-applications/${appId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(appId);
    expect(res.body.display_name).toBe('Test Application');
  });

  it('updates a calling application display_name', async () => {
    const res = await request(app)
      .put(`/api/calling-applications/${appId}`)
      .set(authHeaders())
      .send({ display_name: 'Renamed Application' });
    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Renamed Application');
  });

  it('deletes a calling application and returns 204', async () => {
    const tempId = uniqueSlug('temp-app');
    await request(app)
      .post('/api/calling-applications')
      .set(authHeaders())
      .send({ id: tempId, display_name: 'Temp' });

    const res = await request(app)
      .delete(`/api/calling-applications/${tempId}`)
      .set(authHeaders());
    expect(res.status).toBe(204);
  });

  it('upsert with existing ID preserves original display_name', async () => {
    const dupId = uniqueSlug('dup-app');
    const createRes = await request(app)
      .post('/api/calling-applications')
      .set(authHeaders())
      .send({ id: dupId, display_name: 'Original Name' });
    expect(createRes.status).toBe(201);
    cleanupIds.push(dupId);

    // Second POST with same ID — ignoreDuplicates means no overwrite
    await request(app)
      .post('/api/calling-applications')
      .set(authHeaders())
      .send({ id: dupId, display_name: 'Different Name' });

    const getRes = await request(app)
      .get(`/api/calling-applications/${dupId}`)
      .set(authHeaders());
    expect(getRes.status).toBe(200);
    expect(getRes.body.display_name).toBe('Original Name');
  });
});
