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

const MAX_VARIABLE_LENGTH = 10_000;

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
