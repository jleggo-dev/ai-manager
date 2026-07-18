/**
 * Model – Diagnostic Logs
 * -------------------------
 * CRUD operations for the `diagnostic_logs` table in the AI Manager Supabase.
 * Tracks detailed timing and payload information for each AI processing call.
 */

import type { DiagnosticFilters, DiagnosticLogRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';
import { getSetting } from './app-settings.ts';

const TABLE = 'diagnostic_logs';

/** Create a new diagnostic log entry. */
export async function createDiagnosticLog(data: Partial<DiagnosticLogRow>): Promise<DiagnosticLogRow> {
  const { data: row, error } = await tenantFrom(TABLE).insert(tenantInsertPayload(data)).select().single();
  if (error) throw new Error(`Diagnostic log insert error: ${error.message}`);
  return row;
}

/** Update an existing diagnostic log entry. */
export async function updateDiagnosticLog(id: string, updates: Partial<DiagnosticLogRow>): Promise<DiagnosticLogRow> {
  const { data: row, error } = await tenantFrom(TABLE).update(updates).eq('id', id).select().single();
  if (error) throw new Error(`Diagnostic log update error: ${error.message}`);
  return row;
}

/**
 * List diagnostic logs with optional filters and cursor-based pagination.
 */
export async function listDiagnosticLogs(
  filters: DiagnosticFilters & { cursor?: string } = {},
): Promise<DiagnosticLogRow[]> {
  const limit = filters.limit || 50;
  let query = tenantFrom(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (filters.processingJobId) {
    query = query.eq('processing_job_id', filters.processingJobId);
  }
  if (filters.chatSessionId) {
    query = query.eq('chat_session_id', filters.chatSessionId);
  }
  if (filters.callingApplication) {
    query = query.eq('calling_application', filters.callingApplication);
  }
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.userId) {
    query = query.eq('user_id', filters.userId);
  }
  if (filters.authMode) {
    query = query.eq('auth_mode', filters.authMode);
  }
  if (filters.cursor) {
    query = query.lt('created_at', filters.cursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Diagnostic log list error: ${error.message}`);
  return data;
}

/** Get a single diagnostic log by id. */
export async function getDiagnosticLog(id: string): Promise<DiagnosticLogRow> {
  const { data: row, error } = await tenantFrom(TABLE).select('*').eq('id', id).single();
  if (error) throw new Error(`Diagnostic log get error: ${error.message}`);
  return row;
}

/** Delete a diagnostic log by id. */
export async function deleteDiagnosticLog(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Diagnostic log delete error: ${error.message}`);
}

/** Delete all diagnostic logs for a specific processing job. */
export async function clearDiagnosticLogs(processingJobId: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('processing_job_id', processingJobId);
  if (error) throw new Error(`Diagnostic log clear error: ${error.message}`);
}

interface TokenUsageBucket {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  withUsage: number;
  provider?: string;
  model?: string;
}

interface TokenUsageStats {
  sampleSize: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  byJob: Record<string, TokenUsageBucket>;
  byModel: Record<string, TokenUsageBucket>;
  byUser: Record<string, TokenUsageBucket>;
  warnings?: Array<{ type: string; message: string; userId?: string; callingApplication?: string }>;
}

/**
 * Aggregate token usage stats from diagnostic_logs.
 * Extracts usage from llm_response JSONB and groups by job/model/provider.
 */
export async function getDiagTokenUsageStats(filters: DiagnosticFilters = {}): Promise<TokenUsageStats> {
  const limit = filters.limit ?? 1000;

  let query = tenantFrom(TABLE)
    .select(
      'processing_job_id,calling_application,user_id,llm_timing,llm_response,total_duration_ms,status,metadata,created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters.processingJobId) {
    query = query.eq('processing_job_id', filters.processingJobId);
  }
  if (filters.callingApplication) {
    query = query.eq('calling_application', filters.callingApplication);
  }
  if (filters.userId) {
    query = query.eq('user_id', filters.userId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Diagnostic token stats error: ${error.message}`);

  const rows = data ?? [];
  const byJob: Record<string, TokenUsageBucket> = {};
  const byModel: Record<string, TokenUsageBucket> = {};
  const byUser: Record<string, TokenUsageBucket> = {};
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokensAll = 0;
  let callsWithUsage = 0;
  let callsWithoutUsage = 0;

  for (const row of rows) {
    const llmResponse = row.llm_response as Record<string, unknown> | null;
    const llmTiming = row.llm_timing as Record<string, unknown> | null;
    const metadata = row.metadata as Record<string, unknown> | null;
    const usage = llmResponse?.usage as Record<string, number | null> | undefined;
    const model = (llmTiming?.model || metadata?.primaryModel || 'unknown') as string;
    const provider = (llmTiming?.provider || 'unknown') as string;
    const jobId = (row.processing_job_id || 'unknown') as string;
    const userId = (row.user_id || 'unknown') as string;
    const hasUsage = usage && (usage.total_tokens != null || usage.prompt_tokens != null);

    if (hasUsage) {
      callsWithUsage += 1;
      totalPrompt += usage.prompt_tokens || 0;
      totalCompletion += usage.completion_tokens || 0;
      totalTokensAll += usage.total_tokens || 0;
    } else {
      callsWithoutUsage += 1;
    }

    if (!byJob[jobId]) byJob[jobId] = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, withUsage: 0 };
    byJob[jobId].calls += 1;
    if (hasUsage) {
      byJob[jobId].withUsage += 1;
      byJob[jobId].promptTokens += usage.prompt_tokens || 0;
      byJob[jobId].completionTokens += usage.completion_tokens || 0;
      byJob[jobId].totalTokens += usage.total_tokens || 0;
    }

    const modelKey = `${provider}::${model}`;
    if (!byModel[modelKey])
      byModel[modelKey] = {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        withUsage: 0,
        provider,
        model,
      };
    byModel[modelKey].calls += 1;
    if (hasUsage) {
      byModel[modelKey].withUsage += 1;
      byModel[modelKey].promptTokens += usage.prompt_tokens || 0;
      byModel[modelKey].completionTokens += usage.completion_tokens || 0;
      byModel[modelKey].totalTokens += usage.total_tokens || 0;
    }

    if (!byUser[userId])
      byUser[userId] = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, withUsage: 0 };
    byUser[userId].calls += 1;
    if (hasUsage) {
      byUser[userId].withUsage += 1;
      byUser[userId].promptTokens += usage.prompt_tokens || 0;
      byUser[userId].completionTokens += usage.completion_tokens || 0;
      byUser[userId].totalTokens += usage.total_tokens || 0;
    }
  }

  const warnings = await checkTokenBudgetWarnings(byUser, filters.callingApplication);

  return {
    sampleSize: rows.length,
    callsWithUsage,
    callsWithoutUsage,
    totals: { promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens: totalTokensAll },
    byJob,
    byModel,
    byUser,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** Soft budget thresholds stored in app_settings under token_budgets. */
async function checkTokenBudgetWarnings(
  byUser: Record<string, TokenUsageBucket>,
  callingApplication?: string | null,
): Promise<Array<{ type: string; message: string; userId?: string; callingApplication?: string }>> {
  const warnings: Array<{ type: string; message: string; userId?: string; callingApplication?: string }> = [];
  try {
    const setting = await getSetting('token_budgets');
    const budgets = setting?.value as
      | {
          perUser?: Record<string, number>;
          perCallingApplication?: Record<string, number>;
          defaultPerUser?: number;
        }
      | undefined;
    if (!budgets) return warnings;

    for (const [userId, bucket] of Object.entries(byUser)) {
      if (userId === 'unknown') continue;
      const limit = budgets.perUser?.[userId] ?? budgets.defaultPerUser;
      if (limit != null && bucket.totalTokens > limit) {
        warnings.push({
          type: 'user_budget_exceeded',
          userId,
          message: `User ${userId} exceeded token budget (${bucket.totalTokens} > ${limit})`,
        });
      }
    }

    if (callingApplication && budgets.perCallingApplication?.[callingApplication]) {
      const appLimit = budgets.perCallingApplication[callingApplication];
      const appTotal = Object.values(byUser).reduce((sum, b) => sum + b.totalTokens, 0);
      if (appTotal > appLimit) {
        warnings.push({
          type: 'calling_application_budget_exceeded',
          callingApplication,
          message: `Calling application ${callingApplication} exceeded token budget (${appTotal} > ${appLimit})`,
        });
      }
    }
  } catch (err) {
    console.warn('[diagnostic-logs] token budget check failed:', err);
  }
  return warnings;
}
