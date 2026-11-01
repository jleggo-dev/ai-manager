/**
 * The decisions `repoint-profile.ts --verify` makes, as tables. The two that matter most: a
 * refusal BEFORE the write never touches the pointer, and after the write a miss reverts unless
 * --force gave a reason. Both fail silently if wrong — the coach simply keeps answering on a model
 * nobody proved.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendVerifyLog,
  decide,
  modelMatches,
  preflight,
  type SmokeResult,
  type VerifyPlan,
} from './repoint-verify.ts';

const plan: VerifyPlan = {
  primary: 'claude-sonnet-5-5',
  isCoachProfile: true,
  floor: 77.9,
  force: undefined,
  evalEnvProblem: null,
};

describe('preflight — refused before anything is written', () => {
  it.each([
    ['a plain verify of a new coach primary', plan, true],
    ['with a forced reason', { ...plan, force: 'owner ruled the miss is noise' }, true],
    ['--force with no reason', { ...plan, force: '' }, false],
    ['--force with only spaces', { ...plan, force: '   ' }, false],
    ['only a failover: the coach chat never calls it', { ...plan, primary: null }, false],
    ['a profile the coach chat does not use', { ...plan, isCoachProfile: false }, false],
    ['no floor on file and none given', { ...plan, floor: null }, false],
    ['the eval cannot mint its user', { ...plan, evalEnvProblem: 'Missing CADENCE_SUPABASE_*' }, false],
  ] as Array<[string, VerifyPlan, boolean]>)('%s → ok %s', (_label, p, ok) => {
    expect(preflight(p).ok).toBe(ok);
  });

  it('says why', () => {
    const r = preflight({ ...plan, primary: null });
    expect(!r.ok && r.why).toMatch(/failover/i);
  });
});

describe('modelMatches', () => {
  it.each([
    [['claude-sonnet-5-5'], 'claude-sonnet-5-5', true],
    [['anthropic/claude-sonnet-5-5'], 'claude-sonnet-5-5', true],
    [['Claude-Sonnet-5-5'], 'claude-sonnet-5-5', true],
    [['gpt-5.2'], 'claude-sonnet-5-5', false],
    [['gpt-5.2', 'claude-sonnet-5-5'], 'claude-sonnet-5-5', true],
    [[], 'claude-sonnet-5-5', null],
  ] as Array<[string[], string, boolean | null]>)('%j vs %s → %s', (models, want, out) => {
    expect(modelMatches(models, want)).toBe(out);
  });
});

const ran = (over: Partial<SmokeResult>): SmokeResult => ({
  f1: 85,
  floor: 77.9,
  graderOk: true,
  errors: 0,
  models: ['claude-sonnet-5-5'],
  error: null,
  ...over,
});

describe('decide — after the smoke run on the live pointer', () => {
  const FORCE = 'owner: the two misses are A26 noise';
  it.each([
    // [label, result, force, action]
    ['above the floor', ran({}), undefined, 'keep'],
    ['exactly at the floor', ran({ f1: 77.9 }), undefined, 'keep'],
    ['under the floor', ran({ f1: 70.1 }), undefined, 'revert'],
    ['under the floor, forced', ran({ f1: 70.1 }), FORCE, 'keep-forced'],
    ['no tool call seen anywhere', ran({ graderOk: false, f1: null }), undefined, 'revert'],
    ['no tool call seen, forced', ran({ graderOk: false, f1: null }), FORCE, 'keep-forced'],
    ['the run wrote no result', null, undefined, 'revert'],
    ['the run threw', ran({ f1: null, error: 'sign-in failed: 500' }), undefined, 'revert'],
    ['a different model answered', ran({ models: ['gpt-5.2'] }), undefined, 'revert'],
    ['no model reported: F1 decides', ran({ models: [] }), undefined, 'keep'],
    ['a blank force is no force', ran({ f1: 70.1 }), '  ', 'revert'],
  ] as Array<[string, SmokeResult | null, string | undefined, string]>)('%s → %s', (_label, result, force, action) => {
    expect(decide({ result, floor: 77.9, force, expectedModel: 'claude-sonnet-5-5' }).action).toBe(action);
  });

  it('names the gap on a miss, and the reason on a forced keep', () => {
    expect(
      decide({ result: ran({ f1: 70.1 }), floor: 77.9, force: undefined, expectedModel: 'claude-sonnet-5-5' }).why,
    ).toMatch(/7\.8 points under/);
    const forced = decide({ result: ran({ f1: 70.1 }), floor: 77.9, force: FORCE, expectedModel: 'claude-sonnet-5-5' });
    expect(forced.why).toContain(FORCE);
  });
});

describe('appendVerifyLog', () => {
  it('appends one JSON line per call', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repoint-log-'));
    const file = path.join(dir, 'log.jsonl');
    const entry = {
      at: '2026-10-31T00:00:00.000Z',
      profile: 'Cadence Coach',
      before: { external_ai_id: 'old' },
      after: { external_ai_id: 'old' },
      floor: 77.9,
      f1: 70.1,
      models: ['new'],
      action: 'revert' as const,
      why: 'under the floor',
      force: null,
    };
    expect(appendVerifyLog(entry, file)).toBe(file);
    appendVerifyLog({ ...entry, action: 'keep' }, file);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).action)).toEqual(['revert', 'keep']);
    rmSync(dir, { recursive: true, force: true });
  });
});
