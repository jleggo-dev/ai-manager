/**
 * Resolve free-form / workflow-step / rule-set invocation for sendChatMessage.
 */
import { getProcessingJob } from '../models/processing-jobs.ts';
import { getWorkflowStepByKey } from '../models/workflows.ts';
import { interpolateTemplate } from './job-execution-utils.ts';
import { getCompletedWorkflowSteps } from './chat-session-lifecycle.ts';
import type { FormattingRule, ProcessingJobRow, WorkflowStepConfig, ChatSessionRow } from '../types.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';

interface JobConfig {
  systemPrompt?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
  expectedResponseFormat?: string | null;
  expectedSchema?: ExpectedSchemaInput | null;
  applyFormattingRules?: boolean;
  advanced?: Record<string, unknown>;
  ruleSets?: RuleSetConfig[];
}

interface RuleSetConfig {
  key: string;
  name: string;
  description?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
}

export interface ResolvedChatInvocation {
  resolvedMessage: string;
  workflowStepId: string | null;
  stepFormattingRules: FormattingRule[] | null;
  stepOutputMappings: Record<string, string> | null;
  ruleSetKey: string | null;
  resolvedJob: ProcessingJobRow | null;
}

export async function resolveChatInvocation(
  session: ChatSessionRow,
  sessionId: string,
  message: string | null,
  options: {
    stepKey?: string;
    ruleSetKey?: string;
    variables?: Record<string, unknown>;
  },
): Promise<ResolvedChatInvocation> {
  let resolvedMessage = message;
  let workflowStepId: string | null = null;
  let stepFormattingRules: FormattingRule[] | null = null;
  let stepOutputMappings: Record<string, string> | null = null;
  let ruleSetKey: string | null = null;
  let resolvedJob: ProcessingJobRow | null = null;

  if (options.stepKey && session.workflow_id) {
    const step = await getWorkflowStepByKey(session.workflow_id, options.stepKey);
    if (!step) throw new Error(`Workflow step "${options.stepKey}" not found`);

    /**
     * An input step's answer comes from the person, not the model. Sending it down this path would
     * spend a call to ask a question the app can ask itself — so refuse, and say where to go. The
     * error names the endpoint because this is the kind of mistake that otherwise surfaces as a
     * confusing 500 three layers down.
     */
    if (step.step_type === 'input') {
      throw new Error(
        `Workflow step "${options.stepKey}" is an input step: it collects an answer from the user. ` +
          `Submit it with POST /api/chat-sessions/${sessionId}/workflow-steps/${options.stepKey}/input instead of sending a message.`,
      );
    }

    const job = step.processing_job;
    if (!job) throw new Error(`Workflow step "${options.stepKey}" has no linked processing job`);

    const template: string | undefined = (job.config as JobConfig | undefined)?.promptTemplate;
    if (!template) throw new Error(`Processing job "${job.name}" has no prompt template configured`);

    if (step.depends_on && step.depends_on.length > 0) {
      const completedSteps = await getCompletedWorkflowSteps(sessionId, session.workflow_id);
      const unmet = step.depends_on.filter((dep: string) => !completedSteps.has(dep));
      if (unmet.length > 0) {
        throw new Error(`Step "${options.stepKey}" depends on incomplete steps: ${unmet.join(', ')}`);
      }
    }

    const stepConfig = (step.config || {}) as WorkflowStepConfig;
    const inputMappings = stepConfig.inputMappings || {};
    const accumulated = (session.workflow_variables || {}) as Record<string, unknown>;

    const mergedVars: Record<string, unknown> = {};
    for (const [jobVar, workflowVar] of Object.entries(inputMappings)) {
      if (accumulated[workflowVar] !== undefined) {
        mergedVars[jobVar] = accumulated[workflowVar];
      }
    }
    Object.assign(mergedVars, options.variables || {});

    resolvedMessage = interpolateTemplate(template, mergedVars);
    workflowStepId = step.id;
    stepFormattingRules = (job.config as JobConfig | undefined)?.formattingRules ?? null;
    stepOutputMappings =
      stepConfig.outputMappings && Object.keys(stepConfig.outputMappings).length > 0 ? stepConfig.outputMappings : null;
    resolvedJob = job;
  } else if (options.ruleSetKey) {
    const job = session.processing_job_id ? await getProcessingJob(session.processing_job_id) : null;
    if (!job) {
      throw new Error(
        'ruleSetKey requires the chat session to be opened with a processing job (use jobSlug or jobId when opening the session).',
      );
    }

    const ruleSets: RuleSetConfig[] | undefined = (job.config as JobConfig | undefined)?.ruleSets;
    if (!Array.isArray(ruleSets) || ruleSets.length === 0) {
      throw new Error(`Processing job "${job.name}" has no rule sets configured.`);
    }

    const ruleSet = ruleSets.find((rs) => rs.key === options.ruleSetKey);
    if (!ruleSet) {
      throw new Error(
        `Rule set "${options.ruleSetKey}" not found in job "${job.name}". Available: ${ruleSets.map((rs) => rs.key).join(', ')}`,
      );
    }

    if (!ruleSet.promptTemplate?.trim()) {
      throw new Error(`Rule set "${options.ruleSetKey}" has no prompt template configured.`);
    }

    resolvedMessage = interpolateTemplate(ruleSet.promptTemplate, options.variables || {});
    ruleSetKey = ruleSet.key;
    stepFormattingRules = ruleSet.formattingRules || null;
    resolvedJob = job;
  } else if (session.processing_job_id) {
    try {
      resolvedJob = await getProcessingJob(session.processing_job_id);
    } catch {
      /* non-fatal — diagnostics just won't fire */
    }
  }

  if (!resolvedMessage) {
    throw new Error('No message content resolved — provide a message, stepKey, or ruleSetKey');
  }

  return {
    resolvedMessage,
    workflowStepId,
    stepFormattingRules,
    stepOutputMappings,
    ruleSetKey,
    resolvedJob,
  };
}
