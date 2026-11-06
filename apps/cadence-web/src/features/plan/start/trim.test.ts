import { describe, expect, it } from 'vitest';
import type { Walkthrough, WalkthroughStep } from '@cadence/shared';
import { applyTrim, canTrim, isHerProposal, pickSteps, proposeTrim, trimLine } from './trim.ts';

const step = (id: string, minutes: number, core: boolean, skippable: boolean): WalkthroughStep => ({
  id,
  title: id,
  minutes,
  tool: { kind: 'checkoff', label: 'Done' },
  core,
  skippable,
});

const wt = (steps: WalkthroughStep[]): Walkthrough => ({
  total_min: steps.reduce((n, s) => n + s.minutes, 0),
  steps,
});

describe('trim proposals', () => {
  const full = wt([
    step('warmup', 3, false, true), // optional
    step('run', 22, true, false), // core
    step('cooldown', 5, false, false), // non-core, not marked optional
  ]);

  it('proposes the gentlest cut first, and names what goes', () => {
    const p = proposeTrim(full, 0)!;
    expect(p.cut.map((s) => s.id)).toEqual(['warmup']);
    expect(p.kept.map((s) => s.id)).toEqual(['run', 'cooldown']);
    expect(p.minutes).toBe(27);
    expect(p.canTrimMore).toBe(true);
  });

  it('tightens to core-only on the next rung, and then stops offering', () => {
    const p = proposeTrim(full, 1)!;
    expect(p.kept.map((s) => s.id)).toEqual(['run']);
    expect(p.cut.map((s) => s.id)).toEqual(['warmup', 'cooldown']);
    expect(p.minutes).toBe(22);
    expect(p.canTrimMore).toBe(false);
  });

  it('never proposes cutting into the core, at any level', () => {
    for (const level of [0, 1, 2, 5]) {
      const p = proposeTrim(full, level)!;
      expect(p.cut.every((s) => !s.core)).toBe(true);
      expect(p.kept.filter((s) => s.core)).toHaveLength(1);
    }
  });

  it('clamps a level past the last rung rather than returning nothing', () => {
    expect(proposeTrim(full, 99)!.kept.map((s) => s.id)).toEqual(['run']);
  });

  it('collapses rungs that would cut the same steps, so "trim more" is never a no-op', () => {
    // Here "optional" and "non-core" describe the same step, so there is exactly one rung.
    const oneRung = wt([step('warmup', 3, false, true), step('run', 22, true, false)]);
    expect(proposeTrim(oneRung, 0)!.canTrimMore).toBe(false);
  });

  it('offers nothing when every step is core', () => {
    const allCore = wt([step('a', 5, true, false), step('b', 5, true, false)]);
    expect(canTrim(allCore)).toBe(false);
    expect(proposeTrim(allCore, 0)).toBeNull();
  });

  it('offers nothing for a single-step session', () => {
    expect(canTrim(wt([step('only', 5, true, false)]))).toBe(false);
  });

  it('rebuilds a runnable walkthrough with honest total minutes', () => {
    const p = proposeTrim(full, 0)!;
    const trimmed = applyTrim(full, p);
    expect(trimmed.steps.map((s) => s.id)).toEqual(['run', 'cooldown']);
    expect(trimmed.total_min).toBe(27);
    expect(trimmed.total_min).toBe(trimmed.steps.reduce((n, s) => n + s.minutes, 0));
  });

  it('preserves the original step order in the proposal', () => {
    const shuffled = wt([
      step('a', 1, false, true),
      step('b', 1, true, false),
      step('c', 1, false, true),
      step('d', 1, true, false),
    ]);
    expect(proposeTrim(shuffled, 0)!.kept.map((s) => s.id)).toEqual(['b', 'd']);
  });
});

describe('the person picks what stays', () => {
  const steps = [step('warmup', 3, false, true), step('run', 22, true, false), step('cooldown', 5, false, false)];
  const full = wt(steps);
  const ids = (...x: string[]) => new Set(x);

  it.each([
    { name: 'puts back a step she cut', keep: ['warmup', 'run', 'cooldown'], cut: [], minutes: 30 },
    { name: 'drops a step she kept', keep: ['run'], cut: ['warmup', 'cooldown'], minutes: 22 },
    { name: 'may drop the core she would never propose', keep: ['warmup'], cut: ['run', 'cooldown'], minutes: 3 },
    { name: 'dropping everything keeps nothing', keep: [], cut: ['warmup', 'run', 'cooldown'], minutes: 0 },
  ])('$name', ({ keep, cut, minutes }) => {
    const pick = pickSteps(steps, ids(...keep));
    expect(pick.kept.map((s) => s.id)).toEqual(keep);
    expect(pick.cut.map((s) => s.id)).toEqual(cut);
    expect(pick.minutes).toBe(minutes);
  });

  it('keeps the session order however the choice was made', () => {
    expect(pickSteps(steps, ids('cooldown', 'warmup')).kept.map((s) => s.id)).toEqual(['warmup', 'cooldown']);
  });

  it('a pick runs like a proposal, with honest total minutes', () => {
    const trimmed = applyTrim(full, pickSteps(steps, ids('warmup', 'run')));
    expect(trimmed.steps.map((s) => s.id)).toEqual(['warmup', 'run']);
    expect(trimmed.total_min).toBe(25);
  });

  it.each([
    { name: 'the same steps', keep: ['run', 'cooldown'], hers: true },
    { name: 'one more than she kept', keep: ['warmup', 'run', 'cooldown'], hers: false },
    { name: 'one fewer than she kept', keep: ['run'], hers: false },
    { name: 'the same count, different steps', keep: ['warmup', 'run'], hers: false },
  ])('$name is her proposal: $hers', ({ keep, hers }) => {
    expect(isHerProposal(proposeTrim(full, 0)!, ids(...keep))).toBe(hers);
  });

  it.each([
    {
      name: 'her proposal',
      keep: ['run', 'cooldown'],
      hers: true,
      line: "Here's what I'd drop — that brings it to 27 min. Sound right?",
    },
    { name: 'a changed pick', keep: ['run'], hers: false, line: 'Your call — that brings it to 22 min.' },
    {
      name: 'all of it put back',
      keep: ['warmup', 'run', 'cooldown'],
      hers: false,
      line: 'That keeps all of it — 30 min.',
    },
    { name: 'nothing left', keep: [], hers: false, line: 'That drops everything — keep at least one step.' },
  ])('she says the true thing for $name', ({ keep, hers, line }) => {
    expect(trimLine(pickSteps(steps, ids(...keep)), hers)).toBe(line);
  });
});
