import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `rebalance_week` against faked seams. What these pin is the contract that keeps a minutes-long
 * synthesis honest from inside a chat turn: fire-and-forget through runInBackground, a pending
 * preview is never silently overwritten, and the return text forbids claiming a week she has
 * not seen.
 */
const seams = vi.hoisted(() => ({
  previewReplan: vi.fn(async () => ({ status: 'proposed' })),
  runInBackground: vi.fn((_label: string, work: Promise<unknown>) => {
    void work.catch(() => {});
  }),
  getUser: vi.fn(async (): Promise<{ pending_plan?: unknown } | null> => ({})),
}));

vi.mock('./replan.ts', () => ({ previewReplan: seams.previewReplan }));
vi.mock('./background.ts', () => ({ runInBackground: seams.runInBackground }));
vi.mock('../repos/users.ts', () => ({ getUser: seams.getUser }));

import { REBALANCE_WEEK } from './coach-action-rebalance.ts';

beforeEach(() => {
  vi.clearAllMocks();
  seams.getUser.mockResolvedValue({});
});

describe('rebalance_week', () => {
  it('starts the background redraw with her steer and tells her what she may not claim', async () => {
    const out = await REBALANCE_WEEK.run('u1', { steer: 'strength Monday, cardio Tuesday, one workout Wednesdays' });
    expect(seams.runInBackground).toHaveBeenCalledWith('rebalance_week', expect.any(Promise));
    expect(seams.previewReplan).toHaveBeenCalledWith('u1', 'strength Monday, cardio Tuesday, one workout Wednesdays');
    expect(out).toContain('MINUTES');
    expect(out).toContain('NOTHING changes until they tap');
    expect(out).toContain('Do NOT describe the new week');
  });

  it('refuses an empty steer without starting anything', async () => {
    const out = await REBALANCE_WEEK.run('u1', { steer: '   ' });
    expect(seams.previewReplan).not.toHaveBeenCalled();
    expect(out).toContain('nothing was started');
  });

  it('never stacks a second synthesis on an unanswered preview card', async () => {
    seams.getUser.mockResolvedValue({ pending_plan: { activities: [] } });
    const out = await REBALANCE_WEEK.run('u1', { steer: 'more cardio' });
    expect(seams.previewReplan).not.toHaveBeenCalled();
    expect(out).toContain('ALREADY waiting');
    expect(out).toContain('replace: true');
  });

  it('replace: true deliberately redraws over the waiting preview', async () => {
    seams.getUser.mockResolvedValue({ pending_plan: { activities: [] } });
    const out = await REBALANCE_WEEK.run('u1', { steer: 'more cardio', replace: true });
    expect(seams.previewReplan).toHaveBeenCalledWith('u1', 'more cardio');
    expect(out).toContain('Started');
  });
});
