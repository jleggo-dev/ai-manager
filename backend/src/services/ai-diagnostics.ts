/**
 * Service – AI Diagnostics
 * --------------------------
 * Manages diagnostic logging for AI processing jobs.
 * Captures:
 *   - Calling application identity
 *   - Request payload received
 *   - Supabase call timing
 *   - LLM call timing and payloads
 *   - Formatting timing
 *   - Overall status and duration
 *
 * Usage:
 *   const diag = new DiagnosticSession(jobId, 'company-prospector');
 *   diag.logRequestPayload({ variables, promptTemplate });
 *   diag.startSupabaseTimer();
 *   // ... supabase call ...
 *   diag.endSupabaseTimer('resolve-ai-client', true);
 *   diag.startLlmTimer();
 *   // ... llm call ...
 *   diag.endLlmTimer(requestData, responseData);
 *   await diag.complete('success');
 */

import {
  createDiagnosticLog,
  // updateDiagnosticLog is available for future incremental log updates
} from '../models/diagnostic-logs.ts';
import { errorMessage } from '../lib/error-message.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import type { ChatSessionRow } from '../types.ts';

interface SupabaseTimingEntry {
  operation: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  success: boolean;
  error: string | null;
}

interface LlmTimingEntry {
  startMs: number;
  endMs: number;
  durationMs: number;
  model?: string;
  provider?: string;
}

interface FormattingTimingEntry {
  startMs: number;
  endMs: number;
  durationMs: number;
  rulesApplied: number;
}

interface ChatSessionStats {
  messageCount: number;
  assistantMessageCount: number;
  avgResponseMs: number | null;
  avgFirstTokenMs: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

/**
 * Represents a single diagnostic session for one AI processing call.
 * Data is accumulated in memory and persisted when complete() is called.
 */
export class DiagnosticSession {
  processingJobId: string;
  callingApplication: string;
  persist: boolean;
  workspaceId: string | null;
  chatSessionId: string | null;
  startTime: number;
  dbRecordId: string | null;

  userId: string | null;
  authMode: string | null;
  apiKeyId: string | null;

  requestPayload: Record<string, unknown> | null;
  supabaseTiming: SupabaseTimingEntry[];
  llmTiming: LlmTimingEntry | null;
  llmRequest: Record<string, unknown> | null;
  llmResponse: Record<string, unknown> | null;
  formattingTiming: FormattingTimingEntry | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;

  private _supabaseStart: number | null;
  private _llmStart: number | null;
  private _formattingStart: number | null;

  constructor(
    processingJobId: string,
    callingApplication: string,
    persist: boolean = true,
    workspaceId: string | null = null,
    chatSessionId: string | null = null,
  ) {
    this.processingJobId = processingJobId;
    this.callingApplication = callingApplication;
    this.persist = persist;
    this.workspaceId = workspaceId;
    this.chatSessionId = chatSessionId;
    this.startTime = Date.now();
    this.dbRecordId = null;

    /* Auth identity — captured once at construction from AsyncLocalStorage */
    const ctx = getAuthContext();
    this.userId = effectiveUserId(ctx);
    this.authMode = ctx?.mode || null;
    this.apiKeyId = ctx?.mode === 'api_key' ? ctx.apiKeyId : null;

    /* Accumulated data */
    this.requestPayload = null;
    this.supabaseTiming = [];
    this.llmTiming = null;
    this.llmRequest = null;
    this.llmResponse = null;
    this.formattingTiming = null;
    this.metadata = {};
    this.errorMessage = null;

    /* Active timers */
    this._supabaseStart = null;
    this._llmStart = null;
    this._formattingStart = null;
  }

  /** Record the request payload received from the calling application. */
  logRequestPayload(payload: Record<string, unknown>): void {
    this.requestPayload = payload;
  }

  /* ── Supabase timing ─────────────────────────────────────── */

  /** Start timing a Supabase operation (e.g. resolving AI client). */
  startSupabaseTimer(): void {
    this._supabaseStart = Date.now();
  }

  /**
   * End the Supabase timer and record the result.
   */
  endSupabaseTimer(operation: string, success: boolean, error: string | null = null): void {
    if (this._supabaseStart === null || this._supabaseStart === undefined) return;
    const endTime = Date.now();
    this.supabaseTiming.push({
      operation,
      startMs: this._supabaseStart - this.startTime,
      endMs: endTime - this.startTime,
      durationMs: endTime - this._supabaseStart,
      success,
      error,
    });
    this._supabaseStart = null;
  }

  /* ── LLM timing ─────────────────────────────────────────── */

  /** Start timing the LLM call. */
  startLlmTimer(): void {
    this._llmStart = Date.now();
  }

  /**
   * End the LLM timer and record request/response data.
   */
  endLlmTimer(request: Record<string, unknown>, response: Record<string, unknown>): void {
    if (this._llmStart === null || this._llmStart === undefined) return;
    const endTime = Date.now();
    this.llmTiming = {
      startMs: this._llmStart - this.startTime,
      endMs: endTime - this.startTime,
      durationMs: endTime - this._llmStart,
      model: request?.model as string | undefined,
      provider: request?.provider as string | undefined,
    };
    this.llmRequest = request;
    this.llmResponse = response;
    this._llmStart = null;
  }

  /* ── Formatting timing ──────────────────────────────────── */

  /** Start timing formatting rules application. */
  startFormattingTimer(): void {
    this._formattingStart = Date.now();
  }

  /**
   * End the formatting timer.
   */
  endFormattingTimer(rulesApplied: number): void {
    if (this._formattingStart === null || this._formattingStart === undefined) return;
    const endTime = Date.now();
    this.formattingTiming = {
      startMs: this._formattingStart - this.startTime,
      endMs: endTime - this.startTime,
      durationMs: endTime - this._formattingStart,
      rulesApplied,
    };
    this._formattingStart = null;
  }

  /** Add arbitrary metadata. */
  addMetadata(key: string, value: unknown): void {
    this.metadata[key] = value;
  }

  /**
   * Finalise the diagnostic session and persist to the database.
   */
  async complete(
    status: 'success' | 'error' | 'timeout',
    errMsg: string | null = null,
  ): Promise<Record<string, unknown> | null> {
    const totalDurationMs = Date.now() - this.startTime;
    this.errorMessage = errMsg;

    const MAX_CONTENT_LENGTH = 50_000;
    const truncate = (s: unknown) =>
      typeof s === 'string' && s.length > MAX_CONTENT_LENGTH ? s.slice(0, MAX_CONTENT_LENGTH) + '…[truncated]' : s;

    const sanitizedRequest = this.llmRequest
      ? { ...this.llmRequest, promptContent: truncate(this.llmRequest.promptContent) }
      : null;
    const sanitizedResponse = this.llmResponse
      ? { ...this.llmResponse, rawContent: truncate(this.llmResponse.rawContent) }
      : null;
    const redactedPayload = this.requestPayload
      ? { ...this.requestPayload, promptOverride: this.requestPayload.promptOverride ? '[REDACTED]' : false }
      : null;

    const jobId = this.processingJobId || null;
    if (!jobId) {
      console.warn('[DiagnosticSession] processing_job_id is empty — log will have NULL job reference');
    }

    const logData: Record<string, unknown> = {
      processing_job_id: jobId,
      ...(this.workspaceId ? { workspace_id: this.workspaceId } : {}),
      ...(this.chatSessionId ? { chat_session_id: this.chatSessionId } : {}),
      calling_application: this.callingApplication,
      user_id: this.userId,
      auth_mode: this.authMode,
      api_key_id: this.apiKeyId || null,
      request_payload: redactedPayload,
      supabase_timing: this.supabaseTiming.length > 0 ? this.supabaseTiming : null,
      llm_timing: this.llmTiming,
      llm_request: sanitizedRequest,
      llm_response: sanitizedResponse,
      formatting_timing: this.formattingTiming,
      total_duration_ms: totalDurationMs,
      status,
      error_message: errMsg,
      metadata: Object.keys(this.metadata).length > 0 ? this.metadata : null,
    };

    if (!this.persist) {
      /* Return the data without saving (useful for one-time diagnostics) */
      return { ...logData, id: null, created_at: new Date().toISOString() };
    }

    try {
      const row = await createDiagnosticLog(logData);
      this.dbRecordId = row.id as string | null;
      return row as unknown as Record<string, unknown>;
    } catch (err: unknown) {
      /* Don't let diagnostic logging failure break the main flow */
      console.error('Failed to persist diagnostic log:', errorMessage(err));
      return { ...logData, id: null, persist_error: errorMessage(err) };
    }
  }

  /**
   * Get a summary of the current diagnostic state (for real-time reporting).
   */
  getSummary(): Record<string, unknown> {
    return {
      processingJobId: this.processingJobId,
      callingApplication: this.callingApplication,
      elapsedMs: Date.now() - this.startTime,
      supabaseOps: this.supabaseTiming.length,
      llmCallComplete: !!this.llmTiming,
      formattingComplete: !!this.formattingTiming,
      status: this.errorMessage ? 'error' : 'running',
    };
  }
}

/**
 * Builds a chat session diagnostic summary from chat_sessions + chat_messages.
 * Used for the Analytics tab in ProcessingJobManager for chat-mode jobs.
 */
export function buildChatDiagnosticSummary(session: ChatSessionRow, stats: ChatSessionStats): Record<string, unknown> {
  const sessionDurationMs = session.updated_at
    ? new Date(session.updated_at).getTime() - new Date(session.created_at).getTime()
    : null;

  return {
    sessionId: session.id,
    aiProfileId: session.ai_profile_id,
    providerType: session.provider_type,
    status: session.status,
    userId: session.user_id,
    callingApplication: session.calling_application,
    messageCount: stats.messageCount,
    assistantMessageCount: stats.assistantMessageCount,
    avgResponseMs: stats.avgResponseMs,
    avgFirstTokenMs: stats.avgFirstTokenMs,
    totalPromptTokens: stats.totalPromptTokens,
    totalCompletionTokens: stats.totalCompletionTokens,
    totalTokens: stats.totalTokens,
    sessionDurationMs,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

/**
 * Check if diagnostics should be run for a given job config.
 */
export function shouldRunDiagnostics(advancedConfig: Record<string, unknown> | null): {
  enabled: boolean;
  persist: boolean;
} {
  const diagnostics = (advancedConfig as Record<string, Record<string, unknown>> | null)?.diagnostics;
  if (!diagnostics) {
    return { enabled: true, persist: true };
  }
  if (!diagnostics.enabled) {
    return { enabled: false, persist: false };
  }
  const mode = (diagnostics.mode as string) || 'always';
  return {
    enabled: true,
    persist: mode === 'always',
  };
}
