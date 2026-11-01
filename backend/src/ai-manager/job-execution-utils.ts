/**
 * Shared helpers for job execution and chat messaging (timeout resolution + template fill).
 */
import { getSetting } from '../models/app-settings.ts';
import type { ProviderRow } from '../types.ts';
import type { VariableCut } from '../types/llm.ts';

/**
 * Resolve the effective timeout (ms) for an LLM call.
 * Priority: per-job override → provider setting → system default.
 */
export async function resolveTimeoutMs(
  advancedConfig: Record<string, unknown>,
  provider: ProviderRow,
): Promise<number> {
  const timeoutConfig = advancedConfig?.timeout as Record<string, unknown> | undefined;
  const jobTimeout = Number(timeoutConfig?.llmTimeoutMs || advancedConfig?.timeoutMs) || 0;
  if (jobTimeout > 0) return jobTimeout;

  const providerTimeout = Number(provider?.request_timeout_ms) || 0;
  if (providerTimeout > 0) return providerTimeout;

  const setting = await getSetting('default_llm_timeout_ms');
  return Number((setting?.value as Record<string, unknown>)?.value) || 300_000;
}

/**
 * The most characters of one job variable a prompt ever sees. Anything longer is cut here, ends in
 * `... [truncated]`, and is logged with the variable's name — a cut is a defect in the caller,
 * never a quiet trim. The length is measured on the value itself, BEFORE the
 * `<user_input name="…">` wrapper below is added, so the wrapper does not count against it.
 *
 * 40,000 characters is about 10,000 tokens: a guard against a runaway value (a whole file, a
 * loop's output), not a sizing tool. It was 10,000 until 2026-11-01, when the food-check job's
 * candidate book (8 records a part, 200–400 characters a record) was found to be cut on any meal of
 * five or more parts with nothing in the logs. A caller that builds a long variable still sizes it
 * to what the job should read: compaction pins its fold at `TRANSCRIPT_BUDGET_CHARS`
 * (session-compaction-plan.ts); the candidate book has a budget of its own.
 */
export const MAX_VARIABLE_LENGTH = 40_000;

/**
 * Replace {{variableName}} placeholders with their values and report every variable that was cut.
 * The report is what a run writes to its diagnostic row and hands back to the caller, so a cut is
 * never only a line in a server log nobody reads.
 */
export function fillTemplate(
  template: string,
  variables: Record<string, unknown>,
): { text: string; cuts: VariableCut[] } {
  const cuts: VariableCut[] = [];
  const text = template.replace(/\{\{([\w.-]+)\}\}/g, (match: string, key: string): string => {
    if (variables[key] === undefined) return match;
    let value = String(variables[key]);
    if (value.length > MAX_VARIABLE_LENGTH) {
      cuts.push({ variable: key, length: value.length, cap: MAX_VARIABLE_LENGTH });
      value = value.slice(0, MAX_VARIABLE_LENGTH) + '... [truncated]';
    }
    return `<user_input name="${key}">${value}</user_input>`;
  });
  return { text, cuts };
}

/** The fill alone, for callers that only want the text; a cut still reaches the server log. */
export function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
  const { text, cuts } = fillTemplate(template, variables);
  for (const cut of cuts) console.warn('[job-execution] variable cut to the cap; the caller should size it', cut);
  return text;
}
