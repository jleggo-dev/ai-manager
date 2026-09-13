import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Build next week" from chat (owner, 2026-09-09): thin over `buildWeekAhead`, so what's tested
 * here is the translation — each outcome becomes the right instruction to her, and the tool never
 * claims a build that didn't happen (TOOL-HARNESS §5). The one fact every success line must carry
 * is that the check-in did NOT move — the whole difference from build_next_week.
 */
vi.mock('./week-build.ts', () => ({ buildWeekAhead: vi.fn() }));

import { buildWeekAhead } from './week-build.ts';
import { BUILD_WEEK_AHEAD } from './coach-action-build-week-ahead.ts';

beforeEach(() => {
  vi.mocked(buildWeekAhead).mockReset();
});

describe('build_week_ahead', () => {
  it('writes next week, names how far, and says the check-in stays put', async () => {
    vi.mocked(buildWeekAhead).mockResolvedValue({ status: 'built', builtThrough: '2026-09-20', occurrences: 9 });
    const out = await BUILD_WEEK_AHEAD.run('u1', {});
    expect(buildWeekAhead).toHaveBeenCalledWith('u1');
    expect(out).toContain('2026-09-20');
    expect(out).toContain('check-in stays on its day');
    expect(out).toContain('do not put up a build card');
    expect(out).not.toMatch(/Say ONE short line/i);
  });

  it('already built says nothing changed, and where it already reaches', async () => {
    vi.mocked(buildWeekAhead).mockResolvedValue({ status: 'already_built', builtThrough: '2026-09-20' });
    const out = await BUILD_WEEK_AHEAD.run('u1', {});
    expect(out).toContain('nothing changed');
    expect(out).toContain('2026-09-20');
  });

  it('a finished week is refused and pointed at the roll-forward and the check-in', async () => {
    vi.mocked(buildWeekAhead).mockResolvedValue({ status: 'due' });
    const out = await BUILD_WEEK_AHEAD.run('u1', {});
    expect(out).toContain('nothing changed');
    expect(out).toContain('build_next_week');
    expect(out).toContain('open_week_review');
  });

  it('no plan says nothing was built and points at the build card', async () => {
    vi.mocked(buildWeekAhead).mockResolvedValue({ status: 'no_plan' });
    const out = await BUILD_WEEK_AHEAD.run('u1', {});
    expect(out).toContain('nothing was built');
    expect(out).toContain('build card');
  });
});
