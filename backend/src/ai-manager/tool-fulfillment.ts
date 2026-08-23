/**
 * AI Manager — Tool-Call Plumbing
 * ================================
 * Two related concerns for chat-mode AI profiles that expose processing jobs
 * as model-callable tools:
 *   - extractAndAccumulateOutputs: parse an assistant JSON reply and merge
 *     mapped fields into a chat session's workflow_variables.
 *   - fulfillPendingToolJobCalls / resolveProfileToolDefinitions: run the
 *     linked processing jobs for pending tool.call events and build the
 *     tool definitions Devs.ai needs to offer them to the model.
 */

import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { requireWorkspaceId } from '../db/tenant.ts';
import { resolveJsonPath } from '../lib/json-path.ts';
import { errorMessage } from '../lib/error-message.ts';
import {
  buildToolDefinitions,
  buildToolNameMap,
  getToolJobsFromProfile,
  parseToolArguments,
  type PendingToolCall,
  type ToolJobBinding,
} from '../services/tool-jobs.ts';
import { executeJobById } from './job-execution.ts';
import { boundToolOutput, resolveToolOutputChars } from '../services/tool-output-bounds.ts';
import type { AiProfileRow } from '../types.ts';

/**
 * After an LLM response, attempt to parse it as JSON and extract fields
 * according to outputMappings. Uses an atomic JSONB merge (Postgres ||)
 * to prevent lost-update race conditions under concurrent step execution.
 * Best-effort: logs warnings but never throws.
 */
export async function extractAndAccumulateOutputs(
  sessionId: string,
  assistantContent: string,
  outputMappings: Record<string, string>,
): Promise<Record<string, unknown>> {
  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = assistantContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    const toParse = jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : assistantContent.trim();
    parsed = JSON.parse(toParse);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[workflow-vars] LLM response is not a JSON object, skipping output extraction');
      return {};
    }
  } catch {
    console.warn('[workflow-vars] LLM response is not valid JSON, skipping output extraction');
    return {};
  }

  const newVars: Record<string, unknown> = {};
  for (const [outputField, workflowVar] of Object.entries(outputMappings)) {
    const value = resolveJsonPath(parsed, outputField);
    if (value !== undefined) {
      newVars[workflowVar] = value;
    }
  }

  if (Object.keys(newVars).length === 0) return {};

  try {
    const { data, error } = await getServiceSupabase().rpc('merge_workflow_variables', {
      p_session_id: sessionId,
      p_new_vars: newVars,
      p_workspace_id: requireWorkspaceId(),
    });
    if (error) {
      console.warn('[workflow-vars] Atomic merge failed:', error.message);
      return newVars;
    }
    return (data as Record<string, unknown>) ?? newVars;
  } catch (err) {
    console.warn('[workflow-vars] Failed to persist workflow_variables:', errorMessage(err));
    return newVars;
  }
}

/** Resolve Devs.ai tool definitions from profile.config.toolJobs. */
export async function resolveProfileToolDefinitions(
  profile: AiProfileRow | null | undefined,
): Promise<unknown[] | undefined> {
  const toolJobs = getToolJobsFromProfile(profile);
  if (toolJobs.length === 0) return undefined;
  const defs = await buildToolDefinitions(toolJobs);
  return defs.length > 0 ? defs : undefined;
}

/**
 * Fulfill pending internal tool-job calls by running linked processing jobs.
 * Returns outputs ready for submitChatToolOutputs.
 */
export async function fulfillPendingToolJobCalls(
  pending: PendingToolCall[],
  profile: AiProfileRow | null | undefined,
  callingApplication: string,
): Promise<Array<{ toolCallId: string; output: string }>> {
  const toolJobs = getToolJobsFromProfile(profile);
  const nameMap = buildToolNameMap(toolJobs);
  const outputs: Array<{ toolCallId: string; output: string }> = [];

  for (const call of pending) {
    const binding = nameMap.get(call.name);
    if (!binding) continue;

    try {
      const job = await getProcessingJobBySlug(binding.jobSlug);
      if (!job) throw new Error(`Tool job "${binding.jobSlug}" not found`);
      const args = parseToolArguments(call.arguments);
      const result = await executeJobById(job.id, {
        callingApplication,
        variables: args,
      });

      /**
       * The result is whatever an LLM wrote, and it goes straight into the next request beside
       * every earlier round's exchange. Bound it before it becomes prompt — structured payloads
       * are replaced wholesale rather than cut, because half a JSON object is worse than none
       * (see tool-output-bounds.ts).
       */
      const raw = result.formatted || result.raw || JSON.stringify({ ok: true });
      const limit = await resolveToolOutputChars({ binding, profile });
      const bound = boundToolOutput(raw, { limit, job, tool: call.name });

      outputs.push({ toolCallId: call.toolCallId, output: bound.output });
      console.info('[ai-manager] fulfilled internal tool job', {
        exposeAs: call.name,
        jobSlug: binding.jobSlug,
        ...(bound.bounded ? { bounded: bound.strategy, originalBytes: bound.originalBytes, limit } : {}),
      });
      if (bound.bounded) {
        console.warn(
          `[tool-jobs] "${call.name}" returned ${bound.originalBytes} chars over a ${limit} limit — ` +
            `${bound.strategy === 'replaced' ? 'discarded (structured payload, never cut)' : 'truncated at a line boundary'}. ` +
            "Bound the job's expectedSchema or narrow the tool description if this is routine.",
        );
      }
    } catch (err) {
      outputs.push({
        toolCallId: call.toolCallId,
        output: JSON.stringify({ error: errorMessage(err), verified: false }),
      });
    }
  }

  return outputs;
}

export { getToolJobsFromProfile, buildToolNameMap, type PendingToolCall, type ToolJobBinding };
