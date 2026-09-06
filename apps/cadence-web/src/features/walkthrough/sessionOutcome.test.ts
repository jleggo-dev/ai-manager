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

  // The session is what most of its MINUTES were. A 50-min ruck with a one-minute check-in at the
  // end was asked "how's your head now?" (2026-09-06) because one feeling_log made it all mind.
  it('a mixed session is mind when the mind tools carry most of the time', () => {
    const steps = [reps('warmup'), { ...breathing('winddown'), minutes: 10 }];
    expect(sessionOutcome(steps, {}).kind).toBe('mind');
  });

  it('a movement session with a short check-in stays a movement session', () => {
    const ruck: WalkthroughStep = {
      id: 'ruck',
      title: 'Ruck',
      minutes: 50,
      tool: { kind: 'timer', seconds: 3000, open_ended: true },
      core: true,
      skippable: false,
    };
    const checkin: WalkthroughStep = {
      id: 'head',
      title: 'How are you doing?',
      minutes: 1,
      tool: { kind: 'feeling_log' },
      skippable: true,
    };
    const o = sessionOutcome([ruck, checkin], {
      ruck: { kind: 'timer', elapsedSec: 6600, targetSec: 3000, done: true },
      head: { kind: 'feeling_log', word: 'settled', family: null, room: 1 },
    });
    expect(o.kind).toBe('movement');
    expect(o.asks).toBe('rpe');
    expect(o.question).toBe('How did it feel?');
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
