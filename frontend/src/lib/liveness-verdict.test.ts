import { describe, it, expect } from 'vitest';
import { isDeadVerdict, verdictColor, verdictLabel, verdictShort } from './liveness-verdict';
import type { LivenessVerdict } from '../types/api';

describe("verdictLabel — the provider's words reach the admin", () => {
  it.each<[LivenessVerdict, string | null, string]>([
    ['ok', null, 'answers'],
    [
      'refused',
      'Model claude-sonnet-5 is not available for this request',
      'refused: Model claude-sonnet-5 is not available for this request',
    ],
    ['refused', null, 'refused'],
    ['timeout', 'Devs.ai v2 API request timed out after 30000ms', 'timed out'],
    ['empty', 'answered with no text — a reasoning model needs a larger output budget', 'answered with no text'],
    ['error', 'upstream exploded', 'error: upstream exploded'],
    ['error', null, 'error'],
    ['skipped', 'an agent id, not a model', 'not checked'],
  ])('%s / %s → %s', (verdict, message, label) => {
    expect(verdictLabel({ verdict, message })).toBe(label);
  });
});

describe('verdictShort / verdictColor / isDeadVerdict', () => {
  it.each<[LivenessVerdict, string, string, boolean]>([
    ['ok', 'answers', 'green', false],
    ['refused', 'refused', 'red', true],
    ['timeout', 'timed out', 'yellow', true],
    ['empty', 'empty', 'yellow', true],
    ['error', 'error', 'red', true],
    ['skipped', 'not checked', 'gray', false],
  ])('%s → %s / %s / dead=%s', (verdict, short, color, dead) => {
    expect(verdictShort(verdict)).toBe(short);
    expect(verdictColor(verdict)).toBe(color);
    expect(isDeadVerdict(verdict)).toBe(dead);
  });
});
