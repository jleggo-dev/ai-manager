/**
 * The plan facades (owner, 2026-09-15: "Build the plan facade so we stop raising the cap"). A
 * facade decides WHICH tool runs and nothing else, so the table pins exactly that: every named
 * choice reaches its original with the same parameters, an unnamed or unknown choice names the
 * options and runs nothing, and the covered list is the five the drawer no longer lists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runs = {
  extend: vi.fn(),
  build_ahead: vi.fn(),
  pause: vi.fn(),
  session: vi.fn(),
  week: vi.fn(),
};
vi.mock('./coach-action-extend-horizon.ts', () => ({
  EXTEND_HORIZON: { name: 'extend_horizon', run: (...a: unknown[]) => runs.extend(...a) },
}));
vi.mock('./coach-action-build-week-ahead.ts', () => ({
  BUILD_WEEK_AHEAD: { name: 'build_week_ahead', run: (...a: unknown[]) => runs.build_ahead(...a) },
}));
vi.mock('./coach-action-pause-week.ts', () => ({
  PAUSE_WEEK: { name: 'pause_week', run: (...a: unknown[]) => runs.pause(...a) },
}));
vi.mock('./coach-action-revise-session.ts', () => ({
  REVISE_SESSION: { name: 'revise_session', run: (...a: unknown[]) => runs.session(...a) },
}));
vi.mock('./coach-action-start-replan.ts', () => ({
  START_REPLAN: { name: 'start_replan', run: (...a: unknown[]) => runs.week(...a) },
}));

const { PLAN_FACADE_COVERS, REBUILD, SHAPE_WEEK } = await import('./coach-action-plan-facade.ts');

beforeEach(() => {
  vi.clearAllMocks();
  for (const r of Object.values(runs)) r.mockResolvedValue('done');
});

describe('shape_week — the week’s edges', () => {
  it.each([
    // [action, the original that runs, params]
    ['extend', 'extend', { action: 'extend', days: 14 }],
    ['build_ahead', 'build_ahead', { action: 'build_ahead' }],
    ['pause', 'pause', { action: 'pause', start: '2026-09-07', end: '2026-09-13', reason: 'funeral' }],
  ] as const)('"%s" runs the original with the same parameters', async (_action, which, params) => {
    expect(await SHAPE_WEEK.run('u1', params)).toBe('done');
    expect(runs[which]).toHaveBeenCalledWith('u1', params);
    for (const [name, r] of Object.entries(runs)) if (name !== which) expect(r).not.toHaveBeenCalled();
  });

  it.each([
    ['no action', {}],
    ['an unknown action', { action: 'shrink', days: 3 }],
    ['an old tool name as the action', { action: 'extend_horizon', days: 14 }],
  ])('%s runs nothing and names the three choices', async (_label, params) => {
    const out = await SHAPE_WEEK.run('u1', params);
    expect(out).toMatch(/^Nothing was changed to their week:/);
    expect(out).toContain('extend, build_ahead, pause');
    for (const r of Object.values(runs)) expect(r).not.toHaveBeenCalled();
  });
});

describe('rebuild — one session, or the whole week', () => {
  it.each([
    ['session', 'session', { scope: 'session', session: 'Strength', steer: 'add chest and abs', date: '2026-09-01' }],
    ['week', 'week', { scope: 'week', steer: 'more recovery, keep the long run' }],
  ] as const)('scope "%s" runs the original with the same parameters', async (_scope, which, params) => {
    expect(await REBUILD.run('u1', params)).toBe('done');
    expect(runs[which]).toHaveBeenCalledWith('u1', params);
    for (const [name, r] of Object.entries(runs)) if (name !== which) expect(r).not.toHaveBeenCalled();
  });

  it.each([
    ['no scope', { steer: 'more recovery' }],
    ['an unknown scope', { scope: 'month', steer: 'more recovery' }],
    ['an old tool name as the scope', { scope: 'start_replan', steer: 'more recovery' }],
  ])('%s runs nothing and names the two choices', async (_label, params) => {
    const out = await REBUILD.run('u1', params);
    expect(out).toMatch(/^Nothing was rebuilt:/);
    expect(out).toContain('session, week');
    for (const r of Object.values(runs)) expect(r).not.toHaveBeenCalled();
  });
});

describe('what the facades cover', () => {
  it('is exactly the five the drawer no longer lists', () => {
    expect([...PLAN_FACADE_COVERS].sort()).toEqual(
      ['build_week_ahead', 'extend_horizon', 'pause_week', 'revise_session', 'start_replan'].sort(),
    );
  });

  it('marks both as actions in their descriptions — the gate the audit reads', () => {
    expect(SHAPE_WEEK.description).toMatch(/taking effect immediately/);
    expect(REBUILD.description).toMatch(/takes effect immediately/);
    expect(REBUILD.description).toMatch(/nothing changes until that tap/);
  });
});
