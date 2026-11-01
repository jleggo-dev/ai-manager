/**
 * Scoring for `npm run eval:fact-review` — pure, so a grader bug cannot read as a model regression
 * (eval-fact-review-score.test.ts). Scores what survives the same checks production applies
 * (fact-review-findings.ts `checkFindings`), never the raw answer: a finding production would drop
 * for want of evidence is not a finding here either.
 */
import type { CheckedFindings } from '../src/services/fact-review-findings.ts';
import type { FactReviewCase } from './eval-fact-review-cases.ts';

export type Verdict =
  /** The expected finding, with the expected kind. */
  | 'found'
  /** The expected facts were cited together, but under another kind. */
  | 'wrong-kind'
  /** No finding cites the expected facts together. */
  | 'missed'
  /** Nothing expected, nothing found. */
  | 'clean'
  /** Nothing expected, something found. */
  | 'false-alarm'
  /** The answer was not a findings list. */
  | 'unreadable';

export interface CaseScore {
  pass: boolean;
  verdict: Verdict;
  /** Findings beyond the one the case expects (all of them, on a case that expects none). */
  extra: number;
}

export function scoreCase(expected: FactReviewCase['expect'], checked: CheckedFindings): CaseScore {
  if (!checked.parsed) return { pass: false, verdict: 'unreadable', extra: 0 };
  const found = checked.findings;
  if (!expected) {
    return found.length
      ? { pass: false, verdict: 'false-alarm', extra: found.length }
      : { pass: true, verdict: 'clean', extra: 0 };
  }
  const covering = found.filter((f) => expected.cites.every((id) => f.fact_ids.includes(id)));
  const extra = Math.max(0, found.length - 1);
  if (covering.some((f) => f.kind === expected.kind)) return { pass: true, verdict: 'found', extra };
  if (covering.length) return { pass: false, verdict: 'wrong-kind', extra };
  return { pass: false, verdict: 'missed', extra: found.length };
}

export function summarize(scores: CaseScore[]): { passed: number; total: number; extra: number } {
  return {
    passed: scores.filter((s) => s.pass).length,
    total: scores.length,
    extra: scores.reduce((n, s) => n + s.extra, 0),
  };
}
