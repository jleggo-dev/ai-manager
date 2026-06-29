/**
 * Job evaluation — run golden test cases and assert output contracts.
 */

import { executeJobById } from '../ai-manager/index.ts';
import { applyFormattingRules } from '../services/formatting-rules.ts';
import type { ProcessingJobRow, FormattingRule } from '../types.ts';

export interface EvalCase {
  name: string;
  variables: Record<string, unknown>;
  expectedKeys?: string[];
  expectedContains?: string;
}

export interface EvalCaseResult {
  name: string;
  passed: boolean;
  reason?: string;
  formatted?: string;
  durationMs?: number;
}

export interface EvalResult {
  jobId: string;
  jobSlug: string;
  total: number;
  passed: number;
  failed: number;
  cases: EvalCaseResult[];
}

/** Parse eval cases from job.config.testData and optional config.evalCases. */
export function parseEvalCases(job: ProcessingJobRow): EvalCase[] {
  const config = job.config || {};
  const explicit = config.evalCases as EvalCase[] | undefined;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;

  const testData = config.testData as Record<string, string> | undefined;
  if (!testData || typeof testData !== 'object') return [];

  return [{ name: 'default', variables: testData }];
}

/** Run eval cases against a job; applies formatting rules + require-keys if configured. */
export async function runJobEval(
  job: ProcessingJobRow,
  callingApplication: string,
): Promise<EvalResult> {
  const cases = parseEvalCases(job);
  const results: EvalCaseResult[] = [];
  const formattingRules = (job.config?.formattingRules as FormattingRule[]) || [];

  for (const evalCase of cases) {
    try {
      const result = await executeJobById(job.id, {
        callingApplication,
        variables: evalCase.variables,
      });

      let output = result.formatted || result.raw;
      if (formattingRules.length > 0) {
        const { formatted } = applyFormattingRules(output, formattingRules);
        output = formatted;
      }

      let passed = true;
      let reason: string | undefined;

      if (evalCase.expectedContains && !output.includes(evalCase.expectedContains)) {
        passed = false;
        reason = `Output does not contain "${evalCase.expectedContains}"`;
      }

      if (evalCase.expectedKeys && evalCase.expectedKeys.length > 0) {
        try {
          const parsed = JSON.parse(output);
          for (const key of evalCase.expectedKeys) {
            if (parsed[key] === undefined || parsed[key] === null) {
              passed = false;
              reason = `Missing expected key: ${key}`;
              break;
            }
          }
        } catch {
          passed = false;
          reason = 'Output is not valid JSON';
        }
      }

      /* Detect verified:false from assertion rules */
      try {
        const parsed = JSON.parse(output);
        if (parsed.verified === false) {
          passed = false;
          reason = parsed.reason || 'Assertion rule failed';
        }
      } catch {
        /* not JSON — ok if no JSON expectations */
      }

      results.push({
        name: evalCase.name,
        passed,
        reason,
        formatted: output.slice(0, 500),
        durationMs: result.metadata.durationMs,
      });
    } catch (err) {
      results.push({
        name: evalCase.name,
        passed: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    jobId: job.id,
    jobSlug: job.slug,
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: results,
  };
}
