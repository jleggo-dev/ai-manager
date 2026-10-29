/**
 * The request body one Vercel AI Gateway call sends — built from the shared OpenAI Responses
 * shape, minus everything only Devs.ai understands, plus the strict-schema decision.
 *
 * Kept apart from the client so the shape is a pure function with a table test
 * (`backend/test/vercel-ai-gateway-request.test.ts`): Devs.ai-only fields absent, `store: false`
 * always, the model id untouched (the gateway's ids are `vendor/model`, e.g.
 * `openai/gpt-4.1-mini`), and the schema closed or sent non-strict.
 */
import type { ChatMessage } from '../../types.ts';
import { buildResponsesRequest, type ResponsesCreateBody } from '../openai-responses/request-builder.ts';
import { closeSchemaForStrictMode } from '../../services/strict-json-schema.ts';

/**
 * Options the engine may hand any client but that mean nothing here. `chat_mode` /
 * `thread_mode` are Devs.ai extensions; `previous_response_id` / `conversation` are server-side
 * threading, which `store: false` rules out. Dropped, never forwarded.
 */
export const DEVS_AI_ONLY_OPTIONS = ['chat_mode', 'thread_mode', 'previous_response_id', 'conversation'] as const;

export interface GatewayRequest {
  body: ResponsesCreateBody;
  /** Set when the body carries a json_schema format: whether it went out strict, and why not. */
  schema: { strict: boolean; openPaths: string[] } | null;
}

export function buildGatewayRequest(
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): GatewayRequest {
  const clean: Record<string, unknown> = { ...options };
  for (const key of DEVS_AI_ONLY_OPTIONS) delete clean[key];
  delete clean.timeoutMs;

  const body = buildResponsesRequest(model, messages, { ...clean, stream: false, store: false });
  body.store = false;

  let schema: GatewayRequest['schema'] = null;
  const format = (body.text as { format?: Record<string, unknown> } | undefined)?.format;
  if (format && format.type === 'json_schema' && format.schema && typeof format.schema === 'object') {
    const closed = closeSchemaForStrictMode(format.schema as Record<string, unknown>);
    body.text = { ...body.text, format: { ...format, schema: closed.schema, strict: closed.strict } };
    schema = { strict: closed.strict, openPaths: closed.openPaths };
  }

  return { body, schema };
}
