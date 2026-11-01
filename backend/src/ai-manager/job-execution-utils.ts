/**
 * Shared helpers for job execution and chat messaging (timeout resolution + template fill).
 */
import { getSetting } from '../models/app-settings.ts';
import type { ProviderRow } from '../types.ts';

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
 * The most characters of one job variable a prompt ever sees. Anything longer is cut here and
 * ends in `... [truncated]`. The length is measured on the value itself, BEFORE the
 * `<user_input name="…">` wrapper below is added, so the wrapper does not count against it.
 * Exported so a caller that builds a long variable (compaction's `transcript`) can size it to fit
 * instead of losing its tail here without anyone noticing.
 */
export const MAX_VARIABLE_LENGTH = 10_000;

/** Replace {{variableName}} placeholders with actual values. */
export function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.-]+)\}\}/g, (match: string, key: string): string => {
    if (variables[key] === undefined) return match;
    let value = String(variables[key]);
    if (value.length > MAX_VARIABLE_LENGTH) {
      value = value.slice(0, MAX_VARIABLE_LENGTH) + '... [truncated]';
    }
    return `<user_input name="${key}">${value}</user_input>`;
  });
}
