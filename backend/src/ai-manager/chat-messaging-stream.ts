/**
 * Open the provider SSE stream for an already-resolved chat send.
 */
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import { resolveAttachments, resolveAttachmentsAsText } from '../services/attachment-resolver.ts';
import { resolveProfileToolDefinitions } from './tool-fulfillment.ts';
import { buildCompactedHistory, getSummarizerConfig } from '../services/session-compaction.ts';
import { listChatMessages } from '../models/chat-sessions.ts';
import type {
  Attachment,
  ChatMessage,
  ChatSessionRow,
  FormattingRule,
  LlmClient,
  ProcessingJobRow,
  ProviderRow,
  AiProfileRow,
} from '../types.ts';

interface JobConfig {
  systemPrompt?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
  expectedResponseFormat?: string | null;
  expectedSchema?: ExpectedSchemaInput | null;
  applyFormattingRules?: boolean;
  advanced?: Record<string, unknown>;
}

export async function openChatSendStream(args: {
  sessionId: string;
  session: ChatSessionRow;
  refreshedSession: ChatSessionRow;
  client: LlmClient;
  provider: ProviderRow;
  profile: AiProfileRow;
  providerType: string;
  resolvedMessage: string;
  resolvedJob: ProcessingJobRow | null;
  attachments: Attachment[];
  timeoutMs: number;
}): Promise<globalThis.Response> {
  const {
    sessionId,
    session,
    refreshedSession,
    client,
    provider,
    profile,
    providerType,
    resolvedMessage,
    resolvedJob,
    attachments,
    timeoutMs,
  } = args;

  if (providerType === 'devs-ai' && session.external_chat_id) {
    let prompt: string | unknown[];
    const textContent =
      session.message_count === 0 && session.system_prompt
        ? `${session.system_prompt}\n\n---\n\n${resolvedMessage}`
        : resolvedMessage;

    if (attachments.length > 0) {
      const fileRefs = await resolveAttachments(session.external_chat_id, attachments, client as DevsAiClient);
      prompt = [{ type: 'text', text: textContent }, ...fileRefs];
    } else {
      prompt = textContent;
    }

    return (client as DevsAiClient).messageChatSession(session.external_chat_id, prompt, {
      timeoutMs,
      tools: await resolveProfileToolDefinitions(refreshedSession.ai_profile),
    });
  }

  if (typeof client.chatCompletionStream === 'function') {
    let enrichedContent = resolvedMessage;
    if (attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles.map((f) => `--- ${f.fileName} ---\n${f.content}`).join('\n\n');
        enrichedContent = `${fileBlock}\n\n---\n\n${enrichedContent}`;
      }
    }
    const historyRaw = await listChatMessages(sessionId);
    const historyMessages = buildCompactedHistory(refreshedSession, historyRaw, getSummarizerConfig(refreshedSession));
    const chatMessages: ChatMessage[] = historyMessages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
    if (enrichedContent !== resolvedMessage && chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg) lastMsg.content = enrichedContent;
    }
    const chatOptions = buildProviderChatOptions(provider.type, profile?.runtime_options || {}, {
      previousResponseId: (
        refreshedSession.provider_metadata as {
          previous_response_id?: string;
        } | null
      )?.previous_response_id,
      conversationId: (
        refreshedSession.provider_metadata as {
          conversation_id?: string;
        } | null
      )?.conversation_id,
      expectedSchema:
        providerType === 'devs-ai-v2' ? (resolvedJob?.config as JobConfig | undefined)?.expectedSchema : undefined,
    });
    const profileTools = await resolveProfileToolDefinitions(refreshedSession.ai_profile);
    const mergedTools = [
      ...(Array.isArray(chatOptions.tools) ? (chatOptions.tools as unknown[]) : []),
      ...(Array.isArray(profileTools) ? profileTools : []),
    ];
    const modelId = String(profile?.external_ai_id || '').trim();
    return client.chatCompletionStream(modelId, chatMessages, {
      ...chatOptions,
      ...(mergedTools.length > 0 ? { tools: mergedTools } : {}),
      timeoutMs,
    });
  }

  throw new Error(`Unsupported provider type "${providerType}" for chat streaming`);
}
