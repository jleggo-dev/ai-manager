import type { ProcessingJob, ProcessingJobConfig, WorkflowStepConfig } from '../../../types/api';
import { applyInputMappings, extractPlaceholders, interpolateTemplate } from '../../../lib/interpolate';
import type { StepState, WorkflowStepInfo } from './types';

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const stored = localStorage.getItem('supabase.auth.token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const token = parsed?.currentSession?.access_token;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      /* ignore */
    }
  }
  return headers;
}

export function buildStepStates(sorted: WorkflowStepInfo[], jobMap: Map<string, ProcessingJob>): StepState[] {
  const accumulated: Record<string, string> = {};

  return sorted.map((s) => {
    const job = s.processing_job ?? jobMap.get(s.processing_job_id) ?? null;
    const config = (job?.config ?? {}) as ProcessingJobConfig;
    const stepConfig = (s.config ?? {}) as WorkflowStepConfig;
    const template = (stepConfig.promptTemplate as string | undefined) ?? config.promptTemplate ?? '';
    const placeholders = extractPlaceholders(template);
    const testData = config.testData ?? {};
    const iMappings = stepConfig.inputMappings ?? {};
    const oMappings = stepConfig.outputMappings ?? {};

    const mappedVars = applyInputMappings(iMappings, accumulated, {});
    const vars: Record<string, string> = {};
    placeholders.forEach((k) => {
      vars[k] = mappedVars[k] ?? testData[k] ?? '';
    });

    const result = interpolateTemplate(template, vars);

    const outputFields = Object.keys(config.expectedSchema?.fields ?? {});
    for (const field of outputFields) {
      const wfVar = oMappings[field];
      if (wfVar && testData[field]) {
        accumulated[wfVar] = testData[field];
      }
    }

    return {
      stepKey: s.step_key,
      stepName: s.name,
      jobName: job?.name ?? '(unknown)',
      template,
      variables: vars,
      placeholders,
      interpolated: result.text,
      missingKeys: result.missingKeys,
      inputMappings: iMappings,
      outputMappings: oMappings,
      accumulatedAfter: { ...accumulated },
      status: 'ready' as const,
    };
  });
}

export async function readStreamResponse(res: Response): Promise<string> {
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    if (reader) {
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.content) fullText += parsed.content;
                else if (parsed.formatted) fullText = parsed.formatted;
                else if (parsed.raw) fullText = parsed.raw;
              } catch {
                /* non-JSON data line */
              }
            }
          }
        }
      }
    }
    return fullText;
  }

  const body = await res.json();
  return body.formatted || body.raw || body.content || JSON.stringify(body);
}
