/**
 * Chat Completions — non-streaming and streaming OpenAI-compat completions.
 */

import type { ChatMessage, ChatCompletionResponse } from '../../types.ts';
import { toOpenAiWireMessages } from '../../lib/message-content.ts';
import type { DevsAiHttp, DevsAiRawCompletion } from './types.ts';
import { openSseStream } from './request.ts';

/** Send a chat completion request. */
export async function chatCompletion(
  client: DevsAiHttp,
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): Promise<ChatCompletionResponse> {
  const { timeoutMs, ...chatBody } = options;
  const data = await client._request<DevsAiRawCompletion>(
    'POST',
    '/api/v1/chat/completions',
    {
      model,
      // Multimodal parts are mapped to the OpenAI-compat wire dialect; plain text passes through.
      messages: toOpenAiWireMessages(messages),
      stream: false,
      ...chatBody,
    },
    { timeoutMs },
  );

  if (!data.usage) {
    console.debug(
      '[DevsAiClient] chatCompletion response has no usage field — token tracking unavailable for this call',
    );
  } else {
    data.usage = {
      prompt_tokens: data.usage.prompt_tokens ?? null,
      completion_tokens: data.usage.completion_tokens ?? null,
      total_tokens:
        data.usage.total_tokens ?? ((data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0) || null),
    };
  }

  return data as ChatCompletionResponse;
}

/**
 * Send a streaming chat completion request and return the raw Response
 * for SSE consumption. Used for model-type profiles in chat workflows.
 */
export async function chatCompletionStream(
  client: DevsAiHttp,
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): Promise<globalThis.Response> {
  const { timeoutMs, ...chatBody } = options;
  return openSseStream(
    `${client.baseUrl}/api/v1/chat/completions`,
    client._headers(),
    {
      model,
      messages: toOpenAiWireMessages(messages),
      stream: true,
      ...chatBody,
    },
    {
      timeoutMs: timeoutMs as number | undefined,
      timeoutLabel: 'streaming completion',
      errorLabel: 'streaming completion',
    },
  );
}
