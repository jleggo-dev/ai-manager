/**
 * Shared types for the ProcessingJobManager organism family.
 * Moved verbatim out of ProcessingJobManager.tsx as part of the FE-01 split —
 * no shape changes.
 */

import type { ProcessingJob, ProcessingJobGroup } from '../../../types/api';

export interface JobVariable {
  name: string;
  label?: string;
  description?: string;
  source?: string;
}

export interface ExpectedSchema {
  fields?: Record<string, SchemaFieldDefExtended>;
}

/** Catalogue entry from listFormattingRules — aliases the shared API type. */
export type { AvailableFormattingRule as FormattingRule } from '../../../types/api';

export interface AppliedRule {
  type: string;
  order: number;
  options: Record<string, unknown>;
}

export interface RuleSet {
  key: string;
  name: string;
  description: string;
  promptTemplate: string;
  variables: JobVariable[];
  expectedFormat: string;
  expectedSchema: ExpectedSchema | null;
  formattingRules: AppliedRule[];
  testData: Record<string, string>;
}

export interface SchemaFieldDefExtended {
  description?: string;
  type?: string;
  required?: boolean;
  items?: { type?: string; fields?: Record<string, SchemaFieldDefExtended> };
  allowedValues?: string[] | null;
  suggestedValues?: string[] | null;
}

export interface PickerState {
  type: 'profile' | 'group';
  targetIds: string[];
  value: string | null;
}

export interface TestResult {
  raw?: string;
  formatted?: string;
  durationMs?: number;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finishReason?: string;
  formattingSteps?: FormattingStepResult[];
}

export interface FormattingStepResult {
  type: string;
  label?: string;
  changed?: boolean;
  rolledBack?: boolean;
  before?: number;
  after?: number;
  error?: string;
  warning?: string;
}

export interface ValidationFieldResult {
  field: string;
  label: string;
  required: boolean;
  expectedType: string;
  present: boolean;
  value: unknown;
  status: 'pass' | 'warning' | 'error';
  issues: string[];
}

export interface ValidationResult {
  valid: boolean;
  parseError: string | null;
  fields: ValidationFieldResult[];
  summary: { total: number; passed: number; warnings: number; errors: number; missing: number };
  unexpectedFields: string[];
}

export interface SchemaFieldDetail {
  field: string;
  label: string;
  required: boolean;
  populated: boolean;
  typeCorrect: boolean;
  value: string | null;
}

export interface SchemaValidationResult {
  jsonValid: boolean;
  fieldsTotal: number;
  fieldsPopulated: number;
  fieldsCorrectType: number;
  requiredTotal: number;
  requiredPresent: number;
  unexpectedFields: number;
  fieldDetails: SchemaFieldDetail[];
}

export interface FieldFrequency {
  field: string;
  label: string;
  required: boolean;
  count: number;
  total: number;
  rate: number;
}

export interface ModelBreakdownRow {
  provider: string;
  model: string;
  calls: number;
  success: number;
  errors: number;
  failoverCalls: number;
  llmDurations: number[];
  totalDurations: number[];
  avgLlmMs: number | null;
  avgTotalMs: number | null;
  successRate: number;
}

export interface AnalyticsData {
  hasData: boolean;
  logCount?: number;
  avgLlm?: number | null;
  minLlm?: number | null;
  maxLlm?: number | null;
  avgTotal?: number | null;
  avgPromptTokens?: number | null;
  avgCompletionTokens?: number | null;
  llmDurations?: number[];
  avgFieldCoverage?: number | null;
  avgRequiredCoverage?: number | null;
  validationCount?: number;
  fieldBreakdown?: FieldFrequency[];
  scoredFieldCount?: number;
  jsonParseRate?: number | null;
  avgTypeConformance?: number | null;
  completionRate?: number | null;
  errorRate?: number;
  accuracyScore?: number | null;
  distinctModels?: number;
  modelBreakdown?: ModelBreakdownRow[];
  totalFailoverCalls?: number;
  failoverRate?: number;
}

export interface CallingAppEntry {
  appId: string;
  appName: string;
  isUnknown: boolean;
  jobs: ProcessingJob[];
  grouped: { group: ProcessingJobGroup; jobs: ProcessingJob[] }[];
  ungrouped: ProcessingJob[];
  totalJobs: number;
}

export interface LegacySchemaFieldDef {
  label: string;
  type: string;
  required: boolean;
  allowedValues: string[] | null;
  suggestedValues?: string[] | null;
}

export interface ProcessingJobConfig {
  systemPrompt?: string;
  promptTemplate?: string;
  variables?: JobVariable[];
  testData?: Record<string, string>;
  expectedSchema?: ExpectedSchema;
  formattingRules?: AppliedRule[];
  ruleSets?: RuleSet[];
  advanced?: {
    diagnostics?: { enabled?: boolean; mode?: string };
    timeout?: { llmTimeoutMs?: number; totalTimeoutMs?: number };
    retries?: { enabled?: boolean; maxRetries?: number; retryDelayMs?: number };
    caching?: { enabled?: boolean; ttlSeconds?: number };
  };
  analytics?: { contentFields?: string[] };
  subgroupId?: string | null;
  [key: string]: unknown;
}

export function getJobConfig(job: ProcessingJob | null): ProcessingJobConfig {
  return (job?.config ?? {}) as ProcessingJobConfig;
}

export interface AdvancedConfig {
  diagnostics: { enabled: boolean; mode: string };
  timeout: { llmTimeoutMs: number; totalTimeoutMs: number };
  retries: { enabled: boolean; maxRetries: number; retryDelayMs: number };
  caching: { enabled: boolean; ttlSeconds: number };
}

export interface ProcessingJobFormData {
  name: string;
  slug: string;
  description: string;
  ai_profile_id: string | null;
  is_active: boolean;
  calling_application_id: string | null;
}
