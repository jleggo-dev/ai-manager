import { describe, it, expect } from 'vitest';
import { parseEvalCases } from '../src/services/job-eval.ts';
import type { ProcessingJobRow } from '../src/types.ts';

describe('job-eval', () => {
  it('parseEvalCases reads config.testData as default case', () => {
    const job = {
      id: 'j1',
      slug: 'test-job',
      config: { testData: { company: 'Acme', domain: 'acme.com' } },
    } as unknown as ProcessingJobRow;
    const cases = parseEvalCases(job);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.variables.company).toBe('Acme');
  });

  it('parseEvalCases prefers explicit evalCases', () => {
    const job = {
      id: 'j1',
      slug: 'test-job',
      config: {
        evalCases: [
          { name: 'edge-empty', variables: { input: '' }, expectedKeys: ['result'] },
        ],
      },
    } as unknown as ProcessingJobRow;
    const cases = parseEvalCases(job);
    expect(cases[0]?.name).toBe('edge-empty');
  });
});
