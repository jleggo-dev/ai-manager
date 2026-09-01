import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroTargets } from '@cadence/shared';

const getUser = vi.fn();
const setMacroTargets = vi.fn();
const insertGoalEvent = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setMacroTargets: (...a: unknown[]) => setMacroTargets(...a),
}));
vi.mock('../repos/goal-events.ts', () => ({ insertGoalEvent: (...a: unknown[]) => insertGoalEvent(...a) }));

const { SET_MICRO_TARGET } = await import('./coach-action-micro-target.ts');

/**
 * `getUser` is called twice per run — once to read the current blob, once to verify the write —
 * so the fake keeps state and `setMacroTargets` lands on it, the way the real pair would.
 */
function onFile(initial: MacroTargets = {}) {
  const state = { macro_targets: initial, baseline: { sex: 'male' as const, age: 40 } };
  getUser.mockImplementation(() => Promise.resolve(state));
  setMacroTargets.mockImplementation((_id: string, next: MacroTargets) => {
    state.macro_targets = next;
    return Promise.resolve();
  });
  return state;
}

const run = (params: Record<string, unknown>) => SET_MICRO_TARGET.run('u1', params);

beforeEach(() => {
  vi.clearAllMocks();
  insertGoalEvent.mockResolvedValue(undefined);
});

describe('set_micro_target', () => {
  it('records the number, and reports a FRESH read rather than its own intent', () => {
    const state = onFile();

    return run({ nutrient: 'vitamin_c_mg', amount: 2000, why: 'her doctor asked for 2000mg a day' }).then((said) => {
      expect(state.macro_targets.micro_targets?.vitamin_c_mg).toMatchObject({
        amount: 2000,
        why: 'her doctor asked for 2000mg a day',
      });
      expect(said).toMatch(/verified/i);
      expect(said).toMatch(/2000mg/);
      // getUser twice: the read before the write, and the verification after it.
      expect(getUser).toHaveBeenCalledTimes(2);
    });
  });

  it('refuses a dose past the published safe limit and changes nothing', async () => {
    const state = onFile();

    const said = await run({ nutrient: 'vitamin_c_mg', amount: 9000, why: 'they read it somewhere' });

    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(state.macro_targets.micro_targets).toBeUndefined();
    expect(said).toMatch(/outside the safe daily range/i);
    expect(said).toMatch(/45|2000/); // the range is quoted back so the refusal can be explained
    expect(said).toMatch(/do not set it/i);
  });

  it('will not record a number with no source — that is the invented one', async () => {
    onFile();

    const said = await run({ nutrient: 'iron_mg', amount: 25, why: '   ' });

    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(said).toMatch(/no source was given/i);
  });

  it('names the nutrients it knows when handed one it does not', async () => {
    onFile();

    const said = await run({ nutrient: 'magnesium_mg', amount: 400, why: 'their doctor' });

    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(said).toMatch(/iron_mg/);
    expect(said).toMatch(/zinc_mg/);
  });

  it('clears an override back to the published figure when amount is omitted', async () => {
    const state = onFile({
      kcal: 2100,
      micro_targets: { iron_mg: { amount: 30, why: 'a course of supplements', set_at: '2026-06-01' } },
    });

    const said = await run({ nutrient: 'iron_mg', why: 'the course finished' });

    expect(state.macro_targets.micro_targets).toEqual({});
    expect(said).toMatch(/cleared/i);
    expect(said).toMatch(/\b8mg\b/); // a 40-year-old man's published iron intake
  });

  it('says so plainly when there was no override to clear', async () => {
    onFile({ kcal: 2100 });

    const said = await run({ nutrient: 'zinc_mg', why: 'they asked me to take it off' });

    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(said).toMatch(/no override on zinc_mg to remove/i);
  });

  it('leaves the macro targets beside it untouched', async () => {
    const state = onFile({ kcal: 2100, protein_g: 150, eatback_pct: 40 });

    await run({ nutrient: 'calcium_mg', amount: 1500, why: 'her GP, after a bone scan' });

    expect(state.macro_targets).toMatchObject({ kcal: 2100, protein_g: 150, eatback_pct: 40 });
  });
});
