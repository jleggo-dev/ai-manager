import { describe, expect, it } from 'vitest';
import { BREATH_PATTERNS, type WalkthroughStep } from '@cadence/shared';
import { sessionOutcome } from './sessionOutcome.ts';
import type { StepLogs } from './state.ts';

const reps = (id: string): WalkthroughStep => ({
  id,
  title: id,
  minutes: 5,
  tool: { kind: 'reps', sets: 3, reps: 10 },
  core: true,
  skippable: false,
});

const breathing = (id: string): WalkthroughStep => ({
  id,
  title: id,
  minutes: 3,
  tool: { kind: 'breathing', pattern: BREATH_PATTERNS[0]!, cycles: 6 },
  core: true,
  skippable: false,
});

describe('sessionOutcome', () => {
  it('asks how hard it felt when a movement session finished clean', () => {
    const steps = [reps('a'), reps('b')];
    const logs: StepLogs = {
      a: { kind: 'reps', sets: [10, 10, 10] },
      b: { kind: 'reps', sets: [10, 10, 10] },
    };
    const o = sessionOutcome(steps, logs);
    expect(o.kind).toBe('movement');
    expect(o.partial).toBe(false);
    expect(o.asks).toBe('rpe');
    expect(o.statement).toContain('all 2 steps');
  });

  it('states what happened and asks WHY when steps were skipped', () => {
    const steps = [reps('a'), reps('b')];
    const logs: StepLogs = { a: { kind: 'reps', sets: [10, 10, 10] } };
    const o = sessionOutcome(steps, logs);
    expect(o.partial).toBe(true);
    expect(o.asks).toBe('reason');
    // Cadence STATES the outcome — she never asks whether they finished.
    expect(o.statement).toBe('You did 1 of 2 steps.');
  });

  it('counts a half-finished tool as partial even with every step touched', () => {
    const steps = [reps('a')];
    const logs: StepLogs = { a: { kind: 'reps', sets: [10] } }; // 1 of 3 sets
    expect(sessionOutcome(steps, logs).partial).toBe(true);
  });

  it('picks the mind question from the TOOLS used, not the activity name', () => {
    const steps = [breathing('breath')];
    const logs: StepLogs = { breath: { kind: 'breathing', roundsDone: 6, totalRounds: 6, pattern: 'box' } };
    expect(sessionOutcome(steps, logs).kind).toBe('mind');
    expect(sessionOutcome(steps, logs).asks).toBe('felt_state');
  });

  it('frames a stopped mind session as a completed rep, never as a skip', () => {
    const steps = [breathing('breath')];
    const logs: StepLogs = { breath: { kind: 'breathing', roundsDone: 4, totalRounds: 6, pattern: 'box' } };
    const o = sessionOutcome(steps, logs);
    expect(o.partial).toBe(true);
    expect(o.statement).toContain('still counts');
    // Crucially: no reason codes on the mind pillar — asking "why did you stop?" would frame a
    // completed rep as a failure.
    expect(o.asks).toBe('felt_state');
  });

  it('treats a mixed session containing any mind tool as a mind session', () => {
    const steps = [reps('warmup'), breathing('winddown')];
    const logs: StepLogs = {};
    expect(sessionOutcome(steps, logs).kind).toBe('mind');
  });

  it('handles a session where nothing was logged at all', () => {
    const o = sessionOutcome([reps('a'), reps('b')], {});
    expect(o.logged).toBe(0);
    expect(o.partial).toBe(true);
    expect(o.statement).toBe('You did 0 of 2 steps.');
  });

  it('says "step" not "steps" for a single-step session', () => {
    const logs: StepLogs = { a: { kind: 'reps', sets: [10, 10, 10] } };
    expect(sessionOutcome([reps('a')], logs).statement).toContain('all 1 step,');
  });
});
