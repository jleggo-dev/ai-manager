/**
 * The budget on "Something else": an answer that has not landed in time is a fault the sheet can
 * say, and the late answer is dropped rather than shown. Fake timers; the job promise never settles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const job = vi.fn();
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => job(...a) }));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: async () => [] }));
vi.mock('../repos/users.ts', () => ({ getUser: async () => ({ baseline: { constraints: [] } }) }));
vi.mock('../repos/occurrence-logs.ts', () => ({ listLoggedOccurrences: async () => [] }));
const logged: unknown[] = [];
vi.mock('./ai-log.ts', () => ({ logAi: async (_u: string, row: unknown) => void logged.push(row) }));

const { askAlternativeItem } = await import('./alternative-item.ts');

describe('askAlternativeItem — the time budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('answers unreachable when the job has not answered inside the budget', async () => {
    job.mockReturnValue(new Promise(() => {}));
    const p = askAlternativeItem('u1', { item: { name: 'Glute bridge' } }, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await p).toEqual({ status: 'unreachable', error: 'no answer inside 1000 ms' });
    expect(logged).toEqual([expect.objectContaining({ meta: expect.objectContaining({ status: 'unreachable' }) })]);
  });

  it('an answer inside the budget is used, and recent_logs reads "[]" when nothing is on file', async () => {
    job.mockResolvedValue({ formatted: JSON.stringify({ alternative: { name: 'Hip thrust', equipment: [] } }) });
    const r = await askAlternativeItem('u1', { item: { name: 'Glute bridge' } }, 1_000);
    expect(r).toEqual({ status: 'ok', alternative: { name: 'Hip thrust', equipment: [] } });
    expect((job.mock.calls[0]![2] as { recent_logs: string }).recent_logs).toBe('[]');
  });
});
