import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Facts, not picks (owner 2026-09-03), applied to the three deterministic notes this module rides
 * on the session pack. Each used to tell the coach what to ASK, in what order, at what pace, and
 * roughly in what words — the readiness checklist ("ask for the missing starting point … one at a
 * time, never as a form"; "gather the missing ones … before pointing them to Review"), the
 * plan-gap note ("Raise it yourself this conversation, plainly …, and end that turn with the build
 * card"), and the numberless-goal note ("Ask plainly — how much, by when").
 *
 * What stays is the fact and the tool that writes it. These are the tests that would catch the
 * steer coming back: each asserts the old phrasing is gone AND the replacement fact is present.
 */

const getUser = vi.fn();
const listGoalsByStatus = vi.fn();
const listEquipment = vi.fn();
const countNutritionDays = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a) }));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: (...a: unknown[]) => listEquipment(...a) }));
vi.mock('../repos/nutrition.ts', () => ({ countNutritionDays: (...a: unknown[]) => countNutritionDays(...a) }));

const { onboardingReadiness, planGapNote, targetlessGoalNote } = await import('./coach-context.ts');

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ baseline: {}, home_location: null, macro_targets: null });
  listGoalsByStatus.mockResolvedValue([]);
  listEquipment.mockResolvedValue([]);
  countNutritionDays.mockResolvedValue(0);
});

const goal = (over: Record<string, unknown> = {}) => ({
  goal_id: 'g1',
  title: 'Run a 10k',
  area: 'movement',
  type: 'target',
  measure: { metric: 'distance', target: 10, unit: 'km' },
  ...over,
});

describe('onboardingReadiness — CC-1 / CC-2', () => {
  it('names the goals missing a starting point, without prescribing the question or its pace', async () => {
    listGoalsByStatus.mockResolvedValue([goal()]);

    const said = await onboardingReadiness('u1');

    expect(said).toMatch(/These goals carry a target with no starting point on file:/);
    expect(said).toContain('"Run a 10k" (distance)');
    expect(said).not.toMatch(/first question is where they are today/);
    expect(said).not.toMatch(/one at a time/);
    expect(said).not.toMatch(/never as a form/);
    expect(said).not.toMatch(/in their own words/);
  });

  it('says nothing about starting points when every goal already has one', async () => {
    listGoalsByStatus.mockResolvedValue([goal({ measure: { metric: 'distance', target: 10, unit: 'km', start: 5 } })]);

    const said = await onboardingReadiness('u1');

    expect(said).not.toMatch(/no starting point on file/);
  });

  it('says why body metrics matter, not when to gather them or in what order', async () => {
    listGoalsByStatus.mockResolvedValue([goal()]);

    const said = await onboardingReadiness('u1');

    expect(said).toMatch(/age, height, and current weight feed plan synthesis and the calorie-target flow/);
    expect(said).toMatch(/The missing ones are listed above\./);
    expect(said).not.toMatch(/gather the missing ones/);
    expect(said).not.toMatch(/before pointing them to Review/);
    expect(said).not.toMatch(/safe, realistic plan/);
  });

  it('still says plainly when body metrics are NOT wanted — a boundary, not a pick', async () => {
    listGoalsByStatus.mockResolvedValue([
      goal({ area: 'mind', type: 'recurring', measure: { metric: 'sessions', target: 3 } }),
    ]);

    const said = await onboardingReadiness('u1');

    expect(said).toMatch(/does not need body metrics/);
  });
});

describe('planGapNote — CC-3', () => {
  it('names the tool that closes the gap instead of scripting the turn', async () => {
    listGoalsByStatus.mockResolvedValue([goal({ title: 'Fix nutrition', area: 'nourishment' })]);

    const said = await planGapNote('u1');

    expect(said).toContain('Agreed but NOT YET IN THE PLAN: "Fix nutrition"');
    expect(said).toMatch(/start_replan rebuilds the week around it\./);
    // The boundary stays: a stranded goal must never be reported as handled.
    expect(said).toMatch(/Never claim it is already handled/);
    expect(said).not.toMatch(/Raise it yourself this conversation/);
    expect(said).not.toMatch(/rebuild the week around it now\?/);
    expect(said).not.toMatch(/end that turn with the build/);
  });
});

describe('targetlessGoalNote — CC-4', () => {
  it('says what a missing number costs and which tool writes one, not how to ask', async () => {
    listGoalsByStatus.mockResolvedValue([goal({ title: 'Lose weight', area: 'nourishment', measure: {} })]);

    const said = await targetlessGoalNote('u1');

    expect(said).toContain('"Lose weight" is committed with NO number');
    expect(said).toMatch(/Nothing downstream can measure progress without one/);
    expect(said).toMatch(/update_goal with action retarget writes a target and a date/);
    // The user's own veto stays — a boundary, not a steer.
    expect(said).toMatch(/do not invent one for them/);
    expect(said).not.toMatch(/can only be agreed with, never coached/);
    expect(said).not.toMatch(/Ask plainly/);
    expect(said).not.toMatch(/how much,/);
    expect(said).not.toMatch(/by when/);
  });
});
