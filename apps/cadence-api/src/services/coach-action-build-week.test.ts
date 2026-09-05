import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The trust path's verb (check-in rebuild): thin over `buildNextWeek`, so what's tested here is
 * the translation — each service outcome becomes the right instruction to her, and the tool never
 * claims a build that didn't happen (TOOL-HARNESS §5).
 */
vi.mock('./week-build.ts', () => ({ buildNextWeek: vi.fn() }));

import { buildNextWeek } from './week-build.ts';
import { BUILD_NEXT_WEEK } from './coach-action-build-week.ts';

beforeEach(() => {
  vi.mocked(buildNextWeek).mockReset();
});

describe('build_next_week', () => {
  it('rolls the week, states the fact plainly (no length mandate), and skips the build card (TR-1)', async () => {
    vi.mocked(buildNextWeek).mockResolvedValue({ status: 'committed', version: 13, planId: 'p1' } as never);
    const out = await BUILD_NEXT_WEEK.run('u1', {});
    expect(buildNextWeek).toHaveBeenCalledWith('u1');
    expect(out).toContain('week 13 is being built from the same rhythm');
    expect(out).toContain('Next week is being built.');
    expect(out).toContain('Do not promise how long it will take');
    expect(out).toContain('do not put up a build card');
    expect(out).not.toMatch(/Say ONE short line/);
  });

  it('says plainly that nothing rolled when there is no plan, and points at the build card', async () => {
    vi.mocked(buildNextWeek).mockResolvedValue({ status: 'no_plan' } as never);
    const out = await BUILD_NEXT_WEEK.run('u1', {});
    expect(out).toContain('nothing was built');
    expect(out).toContain('build card');
  });

  it('refuses a week still running without claiming any effect', async () => {
    vi.mocked(buildNextWeek).mockResolvedValue({ status: 'not_due' } as never);
    const out = await BUILD_NEXT_WEEK.run('u1', {});
    expect(out).toContain('nothing was rolled');
    expect(out).toContain('propose_plan_change');
  });
});
