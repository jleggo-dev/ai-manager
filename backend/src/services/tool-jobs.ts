/**
 * Tool Jobs — expose processing jobs as model-callable tools on chat profiles.
 * When the model emits a tool.call for a registered tool job, AI Admin runs the
 * linked job internally and submits the result back to Devs.ai.
 */

import type { AiProfileRow, ProcessingJobRow } from '../types.ts';
import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { errorMessage } from '../lib/error-message.ts';

export interface ToolJobBinding {
  jobSlug: string;
  exposeAs: string;
  description?: string;
}

export interface PendingToolCall {
  toolCallId: string;
  name: string;
  arguments?: string | Record<string, unknown>;
  systemMessageId?: string;
}

/** Read toolJobs[] from ai_profiles.config. */
export function getToolJobsFromProfile(profile: AiProfileRow | null | undefined): ToolJobBinding[] {
  const config = profile?.config as { toolJobs?: ToolJobBinding[] } | undefined;
  if (!Array.isArray(config?.toolJobs)) return [];
  return config.toolJobs.filter((t) => t.jobSlug && t.exposeAs);
}

/** Build Devs.ai-compatible tool definitions from job input variables. */
export async function buildToolDefinitions(
  toolJobs: ToolJobBinding[],
): Promise<Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>> {
  const tools: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> = [];

  for (const binding of toolJobs) {
    try {
      const job = await getProcessingJobBySlug(binding.jobSlug);
      if (!job) {
        console.warn(`[tool-jobs] Job slug not found: ${binding.jobSlug}`);
        continue;
      }
      tools.push({
        type: 'function',
        function: {
          name: binding.exposeAs,
          description: binding.description || job.description || `Run ${job.name}`,
          parameters: buildParametersSchema(job),
        },
      });
    } catch (err) {
      console.warn(`[tool-jobs] Failed to build tool for ${binding.jobSlug}:`, errorMessage(err));
    }
  }

  return tools;
}

function buildParametersSchema(job: ProcessingJobRow): Record<string, unknown> {
  const variables = (job.config?.variables as Array<{ name: string; description?: string; required?: boolean }>) || [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const v of variables) {
    if (!v.name) continue;
    properties[v.name] = { type: 'string', description: v.description || v.name };
    if (v.required !== false) required.push(v.name);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Map exposeAs name → job slug for internal fulfillment. */
export function buildToolNameMap(toolJobs: ToolJobBinding[]): Map<string, ToolJobBinding> {
  const map = new Map<string, ToolJobBinding>();
  for (const t of toolJobs) map.set(t.exposeAs, t);
  return map;
}

/** Parse tool call arguments (string or object) into variables map. */
export function parseToolArguments(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { input: raw };
  } catch {
    return { input: raw };
  }
}
