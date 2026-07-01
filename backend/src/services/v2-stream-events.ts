/**
 * Shared SSE event ingestion for devs-ai-v2 chat streams (initial + tool continuation).
 */

import type { PendingToolCall } from './tool-jobs.ts';

export interface ChatStreamAccum {
  fullContent: string;
  promptTokens: number | null;
  completionTokens: number | null;
  streamModel: string | null;
  pendingV2ResponseId?: string;
}

export interface IngestSseOptions {
  isV2Session: boolean;
  internalToolNames: Set<string>;
  pendingInternalToolCalls: PendingToolCall[];
  fulfilledCallIds: Set<string>;
  onV2Metadata?: (patch: {
    previous_response_id?: string;
    conversation_id?: string;
    last_sequence?: number;
  }) => void;
  onSystemMessageId?: (id: string) => void;
}

function upsertPendingCall(
  pending: PendingToolCall[],
  toolCallId: string,
  patch: Partial<PendingToolCall>,
): void {
  const existing = pending.find((t) => t.toolCallId === toolCallId);
  if (existing) {
    if (patch.name) existing.name = patch.name;
    if (patch.arguments !== undefined) existing.arguments = patch.arguments;
    if (patch.systemMessageId) existing.systemMessageId = patch.systemMessageId;
    return;
  }
  pending.push({
    toolCallId,
    name: patch.name || '',
    arguments: patch.arguments,
    systemMessageId: patch.systemMessageId,
  });
}

/** Extract function_call items from a v2 response.completed output array. */
export function extractFunctionCallsFromOutput(
  output: unknown,
): Array<{ toolCallId: string; name: string; arguments?: string }> {
  if (!Array.isArray(output)) return [];
  const calls: Array<{ toolCallId: string; name: string; arguments?: string }> = [];
  for (const raw of output) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as {
      type?: string;
      call_id?: string;
      id?: string;
      name?: string;
      arguments?: string;
    };
    if (item.type !== 'function_call') continue;
    const toolCallId = item.call_id || item.id;
    if (!toolCallId) continue;
    calls.push({
      toolCallId,
      name: item.name || '',
      arguments: item.arguments,
    });
  }
  return calls;
}

function ingestV2FunctionCallEvent(parsed: Record<string, unknown>, opts: IngestSseOptions): void {
  const type = String(parsed.type || '');

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = parsed.item as {
      type?: string;
      name?: string;
      call_id?: string;
      id?: string;
      arguments?: string;
    } | undefined;
    if (item?.type === 'function_call') {
      const toolCallId = item.call_id || item.id;
      if (toolCallId) {
        upsertPendingCall(opts.pendingInternalToolCalls, toolCallId, {
          name: item.name || '',
          arguments: item.arguments,
        });
      }
    }
    return;
  }

  if (type === 'response.function_call_arguments.done' || type === 'response.function_call_arguments.delta') {
    const name = parsed.name as string | undefined;
    const toolCallId = (parsed.call_id || parsed.item_id) as string | undefined;
    if (toolCallId) {
      upsertPendingCall(opts.pendingInternalToolCalls, toolCallId, {
        name: name || '',
        arguments: parsed.arguments as string | undefined,
      });
    }
  }
}

/** Merge assistant text from message.complete without duplicating streamed deltas. */
export function mergeCompleteText(current: string, completeText: string): string {
  const text = completeText.trim();
  if (!text) return current;
  if (!current) return completeText;
  if (current === completeText || current.endsWith(completeText)) return current;
  if (completeText.startsWith(current)) return completeText;
  return current + completeText;
}

/**
 * Update accumulators and pending tool calls from one parsed SSE data payload.
 * Returns true when the event was a terminal tool.call that should not forward.
 */
export function ingestParsedSseEvent(
  parsed: Record<string, unknown>,
  accum: ChatStreamAccum,
  opts: IngestSseOptions,
): boolean {
  if (parsed.type === 'message.complete') {
    accum.promptTokens =
      (parsed.inputTokens as number | null | undefined) ??
      (parsed.estimatedInputTokens as number | null | undefined) ??
      accum.promptTokens;
    accum.completionTokens =
      (parsed.outputTokens as number | null | undefined) ??
      (parsed.estimatedOutputTokens as number | null | undefined) ??
      accum.completionTokens;
    if (parsed.modelId) accum.streamModel = parsed.modelId as string;

    const completeText = String(parsed.text ?? parsed.content ?? parsed.delta ?? '');
    if (completeText) accum.fullContent = mergeCompleteText(accum.fullContent, completeText);

    if (opts.isV2Session && parsed.responseId) {
      accum.pendingV2ResponseId = parsed.responseId as string;
      opts.onV2Metadata?.({
        previous_response_id: parsed.responseId as string,
        conversation_id: (parsed.conversationId as string) || undefined,
        last_sequence: parsed.lastSequence != null ? Number(parsed.lastSequence) : undefined,
      });
    }

    const outputCalls = extractFunctionCallsFromOutput(parsed.output);
    for (const call of outputCalls) {
      if (opts.fulfilledCallIds.has(call.toolCallId)) continue;
      upsertPendingCall(opts.pendingInternalToolCalls, call.toolCallId, {
        name: call.name,
        arguments: call.arguments,
      });
    }
    return false;
  }

  if (opts.isV2Session && parsed.type === 'v2.response.created' && parsed.responseId) {
    accum.pendingV2ResponseId = parsed.responseId as string;
  }

  if (opts.isV2Session) ingestV2FunctionCallEvent(parsed, opts);

  if (parsed.type === 'tool.call' || parsed.type === 'tool_calls') {
    const toolName = parsed.name as string | undefined;
    const toolCallId = parsed.toolCallId as string | undefined;
    if (toolName && toolCallId && opts.internalToolNames.has(toolName)) {
      upsertPendingCall(opts.pendingInternalToolCalls, toolCallId, {
        name: toolName,
        arguments: parsed.arguments as string | Record<string, unknown> | undefined,
        systemMessageId: parsed.systemMessageId as string | undefined,
      });
      if (parsed.systemMessageId) opts.onSystemMessageId?.(parsed.systemMessageId as string);
    }
    return true;
  }

  if (parsed.type === 'tool.message') return true;

  const delta =
    (parsed.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content ||
    (parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content
      ?.parts?.[0]?.text ||
    (typeof parsed.content === 'object' && parsed.content !== null
      ? (parsed.content as { text?: string }).text
      : parsed.content) ||
    parsed.text ||
    parsed.delta ||
    '';
  if (delta && typeof delta === 'string') accum.fullContent += delta;

  return false;
}

/** Pending internal tool calls that are registered and not yet fulfilled this turn. */
export function selectUnfulfilledToolCalls(
  pending: PendingToolCall[],
  internalToolNames: Set<string>,
  fulfilledCallIds: Set<string>,
): PendingToolCall[] {
  return pending.filter(
    (call) => call.name && internalToolNames.has(call.name) && !fulfilledCallIds.has(call.toolCallId),
  );
}
