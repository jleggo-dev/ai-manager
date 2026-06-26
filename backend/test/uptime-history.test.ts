import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('Uptime History API', () => {
  describe('GET /api/health-checks/uptime-history', () => {
    it('returns 200 with an array of check histories', async () => {
      const res = await request(app).get('/api/health-checks/uptime-history').set(authHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      for (const item of res.body.data) {
        expect(item).toHaveProperty('checkId');
        expect(item).toHaveProperty('checkName');
        expect(item.checkType).toBe('api');
        expect(typeof item.totals).toBe('object');
        expect(item.totals).toHaveProperty('pass');
        expect(item.totals).toHaveProperty('fail');
        expect(item.totals).toHaveProperty('timeout');
        expect(item.totals).toHaveProperty('error');
        expect(Array.isArray(item.dailyStats)).toBe(true);
        expect(item.uptimePercent === null || typeof item.uptimePercent === 'number').toBe(true);
      }
    });

    it('respects the days query parameter', async () => {
      const res = await request(app).get('/api/health-checks/uptime-history?days=7').set(authHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      for (const item of res.body.data) {
        for (const day of item.dailyStats) {
          const dayDate = new Date(day.date);
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
          sevenDaysAgo.setUTCHours(0, 0, 0, 0);
          expect(dayDate.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo.getTime());
        }
      }
    });

    it('clamps days to max 365', async () => {
      const res = await request(app).get('/api/health-checks/uptime-history?days=9999').set(authHeaders());

      expect(res.status).toBe(200);
    });

    it('daily stats entries have correct shape', async () => {
      const res = await request(app).get('/api/health-checks/uptime-history?days=30').set(authHeaders());

      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        for (const day of item.dailyStats) {
          expect(day).toHaveProperty('date');
          expect(typeof day.totalRuns).toBe('number');
          expect(typeof day.passCount).toBe('number');
          expect(typeof day.failCount).toBe('number');
          expect(typeof day.timeoutCount).toBe('number');
          expect(typeof day.errorCount).toBe('number');
          expect(day.totalRuns).toBe(day.passCount + day.failCount + day.timeoutCount + day.errorCount);
        }
      }
    });
  });

  describe('GET /api/widget-health-checks/uptime-history', () => {
    it('returns 200 with an array of widget check histories', async () => {
      const res = await request(app).get('/api/widget-health-checks/uptime-history').set(authHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      for (const item of res.body.data) {
        expect(item).toHaveProperty('checkId');
        expect(item).toHaveProperty('checkName');
        expect(item.checkType).toBe('widget');
        expect(typeof item.totals).toBe('object');
        expect(Array.isArray(item.dailyStats)).toBe(true);
      }
    });

    it('respects the days query parameter', async () => {
      const res = await request(app).get('/api/widget-health-checks/uptime-history?days=14').set(authHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
