/**
 * Checking what the `fact-review` job hands back (fact-review-findings.ts). Evidence is required:
 * a finding without it, or with evidence that cites none of its own facts, is dropped and counted.
 */
import { describe, it, expect } from 'vitest';
import type { ReviewFact } from './fact-review-dossier.ts';
import {
  checkFindings,
  evidenceCitesIds,
  MAX_QUESTION_CHARS,
  normQuestion,
  selectFindings,
  storedEvidence,
  type FactFinding,
} from './fact-review-findings.ts';

const FACTS: ReviewFact[] = [
  { id: 'e1', kind: 'equipment', text: 'gym membership', added: '2026-02-01', notes: ['other'] },
  { id: 'c1', kind: 'constraint', text: 'gym closed for renovation', added: null, notes: ['life'] },
  { id: 'g1', kind: 'goal', text: 'Spartan Ultrabeast', added: '2026-03-01', notes: ['confirmed'] },
  { id: 'g2', kind: 'goal', text: 'Spartan Ultra Beast', added: '2026-04-01', notes: ['confirmed'] },
];

const good = (over: Record<string, unknown> = {}) => ({
  fact_ids: ['e1', 'c1'],
  kind: 'stale',
  evidence: '[e1] "gym membership" (added 2026-02-01) and [c1] "gym closed for renovation".',
  question: 'You mentioned the gym closed — are you back there?',
  ...over,
});

describe('checkFindings', () => {
  it('keeps a finding with known facts, a kind, evidence that cites them, and a question', () => {
    const r = checkFindings({ findings: [good()] }, FACTS);
    expect(r.parsed).toBe(true);
    expect(r.findings).toEqual([good()]);
    expect(r.dropped).toEqual({ no_evidence: 0, unknown_fact: 0, bad_shape: 0, repeated: 0 });
  });

  it.each([
    ['no evidence field', { evidence: undefined }, 'no_evidence'],
    ['empty evidence', { evidence: '   ' }, 'no_evidence'],
    ['evidence that cites none of its facts', { evidence: 'These two disagree.' }, 'no_evidence'],
    ['evidence citing a different fact only', { evidence: 'See [g1].' }, 'no_evidence'],
    ['an id not in the dossier', { fact_ids: ['e1', 'e9'] }, 'unknown_fact'],
    ['no fact ids', { fact_ids: [] }, 'bad_shape'],
    ['fact ids that are not strings', { fact_ids: [1, 2] }, 'bad_shape'],
    ['a kind outside the three', { kind: 'outdated' }, 'bad_shape'],
    ['no question', { question: '' }, 'bad_shape'],
    ['a question that is a paragraph', { question: 'x'.repeat(MAX_QUESTION_CHARS + 1) }, 'bad_shape'],
  ] as const)('drops %s and counts it', (_label, over, reason) => {
    const r = checkFindings({ findings: [good(over as Record<string, unknown>)] }, FACTS);
    expect(r.findings).toEqual([]);
    expect(r.dropped[reason]).toBe(1);
  });

  it('drops a non-object item as bad shape', () => {
    expect(checkFindings({ findings: ['e1 and c1 disagree', null] }, FACTS).dropped.bad_shape).toBe(2);
  });

  it('keeps one of two findings asking the same question', () => {
    const r = checkFindings(
      { findings: [good(), good({ question: 'you mentioned the gym closed — are you back there' })] },
      FACTS,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.dropped.repeated).toBe(1);
  });

  it('dedupes fact ids and trims the text it keeps', () => {
    const r = checkFindings(
      { findings: [good({ fact_ids: ['e1', 'e1', ' c1 '], question: '  Are you   back there? ' })] },
      FACTS,
    );
    expect(r.findings[0]?.fact_ids).toEqual(['e1', 'c1']);
    expect(r.findings[0]?.question).toBe('Are you back there?');
  });

  it.each([
    ['a JSON string', JSON.stringify({ findings: [good()] })],
    ['a bare array', [good()]],
  ])('reads %s', (_label, raw) => {
    expect(checkFindings(raw, FACTS).findings).toHaveLength(1);
  });

  it.each([
    ['prose', 'I found nothing worth asking.'],
    ['an object without findings', { results: [] }],
    ['nothing', ''],
  ])('reports %s as unreadable, with nothing kept', (_label, raw) => {
    const r = checkFindings(raw, FACTS);
    expect(r.parsed).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it('an empty list is a clean answer, not an unreadable one', () => {
    expect(checkFindings({ findings: [] }, FACTS)).toMatchObject({ parsed: true, findings: [] });
  });
});

describe('evidenceCitesIds', () => {
  it.each([
    ['[e1] and [c1]', ['e1']],
    ['e1 says one thing', ['e1']],
    ['(c1) and the membership', ['c1']],
    ['facts e1, c1 disagree', ['c1']],
    ['E1 is older', ['e1']],
    ['ends with e1', ['e1']],
  ])('cites: %s', (evidence, ids) => {
    expect(evidenceCitesIds(evidence, ids)).toBe(true);
  });

  it.each([
    ['e12 is older', ['e1']],
    ['ce1 is older', ['e1']],
    ['e1a is older', ['e1']],
    ['the membership is older', ['e1']],
    ['', ['e1']],
  ])('does not cite: %s', (evidence, ids) => {
    expect(evidenceCitesIds(evidence, ids)).toBe(false);
  });
});

describe('normQuestion', () => {
  it.each([
    ['Are you back at the gym?', 'are you back at the gym'],
    ['  are you  back at the gym ', 'are you back at the gym'],
    ['Are you back at the gym?!', 'are you back at the gym'],
    ['You’re still at the gym?', "you're still at the gym"],
  ])('%s → %s', (q, out) => {
    expect(normQuestion(q)).toBe(out);
  });

  it('a different question stays different', () => {
    expect(normQuestion('Are you back at the gym?')).not.toBe(normQuestion('Are you back at the pool?'));
  });
});

const finding = (question: string): FactFinding => ({
  fact_ids: ['e1', 'c1'],
  kind: 'stale',
  evidence: '[e1] vs [c1]',
  question,
});

describe('selectFindings', () => {
  it('skips a question already open, whatever its case or closing mark', () => {
    const s = selectFindings(
      [finding('Are you back at the gym?'), finding('Is it one race?')],
      ['are you back at the gym'],
      3,
    );
    expect(s.write.map((f) => f.question)).toEqual(['Is it one race?']);
    expect(s.already_open).toBe(1);
  });

  it('writes no more than the room, clearest first, and counts the rest', () => {
    const s = selectFindings([finding('a?'), finding('b?'), finding('c?'), finding('d?')], [], 2);
    expect(s.write.map((f) => f.question)).toEqual(['a?', 'b?']);
    expect(s.over_cap).toBe(2);
  });

  it('no room writes nothing', () => {
    expect(selectFindings([finding('a?')], [], 0).write).toEqual([]);
    expect(selectFindings([finding('a?')], [], -1).write).toEqual([]);
  });
});

describe('storedEvidence', () => {
  it('keeps the job’s sentence and resolves each id into the fact’s own words', () => {
    const text = storedEvidence({ ...finding('Are you back there?'), evidence: '[e1] is older than [c1].' }, FACTS);
    expect(text).toBe(
      [
        'stale: [e1] is older than [c1].',
        '[e1] equipment: "gym membership" — added 2026-02-01; other',
        '[c1] constraint: "gym closed for renovation" — life',
      ].join('\n'),
    );
  });
});
