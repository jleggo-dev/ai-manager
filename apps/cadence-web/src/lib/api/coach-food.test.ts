import { describe, it, expect } from 'vitest';

// Light parse coverage via prepareCoachFoodAction's soft network path — mock fetch.
import { prepareCoachFoodAction } from './coach-food.ts';

describe('prepareCoachFoodAction client', () => {
  it('returns null action on network failure', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    try {
      const r = await prepareCoachFoodAction({ message: 'I had eggs' });
      expect(r.status).toBe('unavailable');
      expect(r.action).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('parses a dietary_update action', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        action: {
          kind: 'dietary_update',
          current: { allergies: [], diet: null, dislikes: [], notes: null },
          proposed: { allergies: ['peanuts'], diet: null, dislikes: [], notes: null },
        },
      }),
    }) as unknown as typeof fetch;
    try {
      const r = await prepareCoachFoodAction({ message: "I'm allergic to peanuts" });
      expect(r.status).toBe('ok');
      expect(r.action?.kind).toBe('dietary_update');
      if (r.action?.kind === 'dietary_update') expect(r.action.proposed.allergies).toContain('peanuts');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
