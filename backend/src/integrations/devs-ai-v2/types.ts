/** Devs.ai Responses API v2 — subset of types used by AI Admin. */

export interface V2ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface V2OutputTextPart {
  type: 'output_text';
  text: string;
}

export interface V2OutputMessage {
  id?: string;
  type: 'message';
  role?: string;
  status?: string;
  content?: V2OutputTextPart[];
}

export interface V2ResponseObject {
  id: string;
  object?: string;
  status: string;
  model?: string;
  output?: V2OutputMessage[];
  usage?: V2ResponseUsage;
  error?: { code?: string; message?: string };
  previous_response_id?: string | null;
  selection_metadata?: Record<string, unknown>;
}

export interface V2StreamEvent {
  type: string;
  sequence_number?: number;
  delta?: string;
  text?: string;
  response?: Partial<V2ResponseObject>;
  usage?: V2ResponseUsage;
}

/**
 * Body item for POST /api/v2/responses/{id}/resume `toolOutputs`.
 * Devs.ai extension schema (camelCase) — not OpenAI `function_call_output` / `tool_outputs`.
 * @see https://docs.devs.ai/api-spec — Resume a response
 */
export type V2ResumeToolOutputStatus = 'success' | 'error' | 'cancelled';

export interface V2ResumeToolOutput {
  toolCallId: string;
  output: string;
  status?: V2ResumeToolOutputStatus;
}

export interface V2ResumeRequestBody {
  reason?: string;
  toolOutputs?: V2ResumeToolOutput[];
}
