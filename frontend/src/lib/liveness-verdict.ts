/**
 * Plain words for a model liveness verdict. One place, so the provider page and the profile
 * form's model pickers say the same thing about the same model.
 */
import type { LivenessVerdict, ModelLiveness } from '../types/api';

export function verdictLabel(result: Pick<ModelLiveness, 'verdict' | 'message'>): string {
  switch (result.verdict) {
    case 'ok':
      return 'answers';
    case 'refused':
      return result.message ? `refused: ${result.message}` : 'refused';
    case 'timeout':
      return 'timed out';
    case 'empty':
      return 'answered with no text';
    case 'error':
      return result.message ? `error: ${result.message}` : 'error';
    case 'skipped':
      return 'not checked';
  }
}

/** Short form for a badge beside a picker. */
export function verdictShort(verdict: LivenessVerdict): string {
  return verdict === 'ok'
    ? 'answers'
    : verdict === 'timeout'
      ? 'timed out'
      : verdict === 'empty'
        ? 'empty'
        : verdict === 'skipped'
          ? 'not checked'
          : verdict;
}

export function verdictColor(verdict: LivenessVerdict): string {
  if (verdict === 'ok') return 'green';
  if (verdict === 'skipped') return 'gray';
  if (verdict === 'empty' || verdict === 'timeout') return 'yellow';
  return 'red';
}

export function isDeadVerdict(verdict: LivenessVerdict): boolean {
  return verdict === 'refused' || verdict === 'timeout' || verdict === 'empty' || verdict === 'error';
}
