import { describe, expect, it } from 'vitest';
import { buildReviewDossier } from '../src/services/fact-review-dossier.ts';
import type { CheckedFindings, FactFinding } from '../src/services/fact-review-findings.ts';
import { FACT_REVIEW_CASES } from './eval-fact-review-cases.ts';
import { scoreCase, summarize } from './eval-fact-review-score.ts';

const f = (kind: FactFinding['kind'], ...fact_ids: string[]): FactFinding => ({
  fact_ids,
  kind,
  evidence: fact_ids.map((id) => `[${id}]`).join(' and '),
  question: 'Is that still true?',
});
const checked = (...findings: FactFinding[]): CheckedFindings => ({
  findings,
  parsed: true,
  dropped: { no_evidence: 0, unknown_fact: 0, bad_shape: 0, repeated: 0 },
});
const STALE = { kind: 'stale', cites: ['e1', 'c1'] } as const;

describe('scoreCase', () => {
  it.each([
    ['nothing expected, nothing found', null, checked(), { pass: true, verdict: 'clean', extra: 0 }],
    [
      'nothing expected, something found',
      null,
      checked(f('duplicate', 'e1', 'e2')),
      { pass: false, verdict: 'false-alarm', extra: 1 },
    ],
    ['the expected finding', STALE, checked(f('stale', 'e1', 'c1')), { pass: true, verdict: 'found', extra: 0 }],
    [
      'cites in another order, plus one more fact',
      STALE,
      checked(f('stale', 'd1', 'c1', 'e1')),
      { pass: true, verdict: 'found', extra: 0 },
    ],
    [
      'found among others, which count as extra',
      STALE,
      checked(f('duplicate', 'g1', 'g2'), f('stale', 'e1', 'c1')),
      { pass: true, verdict: 'found', extra: 1 },
    ],
    [
      'the right facts under another kind',
      STALE,
      checked(f('contradiction', 'e1', 'c1')),
      { pass: false, verdict: 'wrong-kind', extra: 0 },
    ],
    [
      'only one of the expected facts',
      STALE,
      checked(f('stale', 'e1', 'n1')),
      { pass: false, verdict: 'missed', extra: 1 },
    ],
    ['nothing found', STALE, checked(), { pass: false, verdict: 'missed', extra: 0 }],
  ] as const)('%s', (_label, expected, result, score) => {
    expect(scoreCase(expected, result)).toEqual(score);
  });

  it('an unreadable answer fails whatever was expected', () => {
    const unreadable: CheckedFindings = { ...checked(), parsed: false };
    expect(scoreCase(null, unreadable)).toEqual({ pass: false, verdict: 'unreadable', extra: 0 });
    expect(scoreCase(STALE, unreadable).verdict).toBe('unreadable');
  });
});

describe('summarize', () => {
  it('counts passes and extra findings', () => {
    expect(
      summarize([
        { pass: true, verdict: 'found', extra: 1 },
        { pass: false, verdict: 'false-alarm', extra: 2 },
        { pass: true, verdict: 'clean', extra: 0 },
      ]),
    ).toEqual({ passed: 2, total: 3, extra: 3 });
  });
});

/** A case is only worth a live call if its expected ids are the ones the real builder assigns. */
describe.each(FACT_REVIEW_CASES)('case $id', (c) => {
  it('cites only facts its own file produces, and those facts are what the case is about', () => {
    const facts = buildReviewDossier(c.sources);
    const ids = new Set(facts.map((x) => x.id));
    for (const id of c.expect?.cites ?? []) expect(ids.has(id)).toBe(true);
    expect(facts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the case table', () => {
  it('covers the design: each kind once, and at least three files that must stay quiet', () => {
    const kinds = FACT_REVIEW_CASES.map((c) => c.expect?.kind ?? 'none');
    expect(kinds.filter((k) => k === 'contradiction')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'stale')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'duplicate')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'none').length).toBeGreaterThanOrEqual(3);
    expect(new Set(FACT_REVIEW_CASES.map((c) => c.id)).size).toBe(FACT_REVIEW_CASES.length);
  });

  it('the cited facts read as the case says', () => {
    const text = (id: string, ref: string) =>
      buildReviewDossier(FACT_REVIEW_CASES.find((c) => c.id === id)!.sources).find((x) => x.id === ref)?.text;
    expect(text('stale-by-detour', 'e1')).toContain('gym membership');
    expect(text('stale-by-detour', 'c1')).toBe('gym closed for renovation');
    expect([text('duplicate-spelling', 'g1'), text('duplicate-spelling', 'g2')]).toEqual([
      'Spartan Ultrabeast — 50 km in Quebec, 30+ obstacles',
      'Spartan Ultra Beast',
    ]);
    expect(text('contradiction', 'e1')).toBe('squat rack and barbell at home');
  });
});
