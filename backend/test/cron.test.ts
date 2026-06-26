import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/models/health-checks.ts', () => ({
  listDueChecks: vi.fn(),
}));

vi.mock('../src/services/health-checker.ts', () => ({
  runAndRecordCheck: vi.fn(),
}));

vi.mock('../src/models/widget-health-checks.ts', () => ({
  listDueWidgetChecks: vi.fn(),
}));

vi.mock('../src/services/widget-health-checker.ts', () => ({
  runAndRecordWidgetCheck: vi.fn(),
}));

import cronRouter from '../src/routes/cron.ts';
import { listDueChecks } from '../src/models/health-checks.ts';
import { runAndRecordCheck } from '../src/services/health-checker.ts';
import { listDueWidgetChecks } from '../src/models/widget-health-checks.ts';
import { runAndRecordWidgetCheck } from '../src/services/widget-health-checker.ts';

const TEST_SECRET = 'test-cron-secret-123';
const app = express();
app.use('/api/cron', cronRouter);

describe('Cron endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  describe('Authentication', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await request(app).get('/api/cron/tick/health');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('rejects requests with wrong secret', async () => {
      const res = await request(app).get('/api/cron/tick/health').set('Authorization', 'Bearer wrong-secret');
      expect(res.status).toBe(401);
    });

    it('rejects requests when CRON_SECRET is not set', async () => {
      delete process.env.CRON_SECRET;
      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);
      expect(res.status).toBe(401);
    });

    it('accepts requests with correct secret', async () => {
      vi.mocked(listDueChecks).mockResolvedValue([]);
      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/cron/tick/health', () => {
    it('returns zero counts when no checks are due', async () => {
      vi.mocked(listDueChecks).mockResolvedValue([]);

      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, healthChecks: 0, errors: 0 });
    });

    it('executes due checks and reports count', async () => {
      const mockChecks = [
        { id: 'chk-1', name: 'Check 1' },
        { id: 'chk-2', name: 'Check 2' },
      ];
      vi.mocked(listDueChecks).mockResolvedValue(mockChecks as unknown as Awaited<ReturnType<typeof listDueChecks>>);
      vi.mocked(runAndRecordCheck).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof runAndRecordCheck>>,
      );

      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.healthChecks).toBe(2);
      expect(res.body.errors).toBe(0);
      expect(runAndRecordCheck).toHaveBeenCalledTimes(2);
    });

    it('counts rejected promises as errors', async () => {
      const mockChecks = [{ id: 'chk-1' }];
      vi.mocked(listDueChecks).mockResolvedValue(mockChecks as unknown as Awaited<ReturnType<typeof listDueChecks>>);
      vi.mocked(runAndRecordCheck).mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.errors).toBe(1);
    });

    it('handles listDueChecks throwing gracefully', async () => {
      vi.mocked(listDueChecks).mockRejectedValue(new Error('DB unreachable'));

      const res = await request(app).get('/api/cron/tick/health').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.errors).toBe(1);
    });
  });

  describe('GET /api/cron/tick/widget', () => {
    it('returns zero counts when no widget checks are due', async () => {
      vi.mocked(listDueWidgetChecks).mockResolvedValue([]);

      const res = await request(app).get('/api/cron/tick/widget').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, widgetChecks: 0, errors: 0 });
    });

    it('executes due widget checks and reports count', async () => {
      const mockChecks = [{ id: 'wchk-1' }, { id: 'wchk-2' }, { id: 'wchk-3' }];
      vi.mocked(listDueWidgetChecks).mockResolvedValue(
        mockChecks as unknown as Awaited<ReturnType<typeof listDueWidgetChecks>>,
      );
      vi.mocked(runAndRecordWidgetCheck).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof runAndRecordWidgetCheck>>,
      );

      const res = await request(app).get('/api/cron/tick/widget').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.widgetChecks).toBe(3);
      expect(res.body.errors).toBe(0);
      expect(runAndRecordWidgetCheck).toHaveBeenCalledTimes(3);
    });

    it('counts rejected widget checks as errors', async () => {
      const mockChecks = [{ id: 'wchk-1' }, { id: 'wchk-2' }];
      vi.mocked(listDueWidgetChecks).mockResolvedValue(
        mockChecks as unknown as Awaited<ReturnType<typeof listDueWidgetChecks>>,
      );
      vi.mocked(runAndRecordWidgetCheck)
        .mockResolvedValueOnce(undefined as unknown as Awaited<ReturnType<typeof runAndRecordWidgetCheck>>)
        .mockRejectedValueOnce(new Error('Chrome crashed'));

      const res = await request(app).get('/api/cron/tick/widget').set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.widgetChecks).toBe(2);
      expect(res.body.errors).toBe(1);
    });
  });
});
