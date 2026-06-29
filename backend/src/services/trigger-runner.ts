/**
 * Service – Trigger execution
 * Runs a job or opens a workflow session when a trigger fires.
 */

import { executeJob, openChatSession } from '../ai-manager/index.ts';
import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { getWorkflowBySlug } from '../models/workflows.ts';
import type { TriggerRow } from '../types.ts';
import { errorMessage } from '../lib/error-message.ts';

export interface TriggerRunResult {
  triggerSlug: string;
  targetType: string;
  targetSlug: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
}

export async function runTrigger(
  trigger: TriggerRow,
  options: { variables?: Record<string, unknown>; callingApplication?: string; userId?: string } = {},
): Promise<TriggerRunResult> {
  const callingApplication = options.callingApplication || `trigger:${trigger.slug}`;
  const variables = options.variables || (trigger.config?.defaultVariables as Record<string, unknown>) || {};

  try {
    if (trigger.target_type === 'job') {
      const job = await getProcessingJobBySlug(trigger.target_slug);
      if (!job) throw new Error(`Job "${trigger.target_slug}" not found`);
      const result = await executeJob(trigger.target_slug, { callingApplication, variables });
      return {
        triggerSlug: trigger.slug,
        targetType: 'job',
        targetSlug: trigger.target_slug,
        status: 'success',
        result: { formatted: result.formatted, raw: result.raw, usage: result.metadata.usage },
      };
    }

    if (trigger.target_type === 'workflow') {
      const wf = await getWorkflowBySlug(trigger.target_slug);
      if (!wf) throw new Error(`Workflow "${trigger.target_slug}" not found`);
      const session = await openChatSession(wf.ai_profile_id || trigger.target_slug, {
        workflowSlug: trigger.target_slug,
        userId: options.userId || 'trigger-system',
        callingApplication,
      });
      return {
        triggerSlug: trigger.slug,
        targetType: 'workflow',
        targetSlug: trigger.target_slug,
        status: 'success',
        result: { sessionId: session.sessionId, steps: session.steps },
      };
    }

    throw new Error(`Unsupported target_type: ${trigger.target_type}`);
  } catch (err) {
    return {
      triggerSlug: trigger.slug,
      targetType: trigger.target_type,
      targetSlug: trigger.target_slug,
      status: 'error',
      error: errorMessage(err),
    };
  }
}
