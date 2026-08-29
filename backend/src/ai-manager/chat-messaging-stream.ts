/**
 * Open the provider SSE stream for an already-resolved chat send.
 */
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { buildProviderChatOptions, v2ThreadingEnabled } from '../services/ai-profile-runtime-options.ts';
import { resolveAttachments, resolveAttachmentsAsText } from '../services/attachment-resolver.ts';
import { contentText, withImageParts } from '../lib/message-content.ts';
import { resolveProfileToolDefinitions } from './tool-fulfillment.ts';
import { buildSessionChatMessages } from './chat-history.ts';
import { sliceForThread } from './thread-mode.ts';
import { updateV2ProviderMetadata } from './v2-metadata.ts';
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
  /** https URLs (short-lived signed Storage URLs) — spliced onto THIS turn's message as real
   *  `image_url` content parts, never persisted. See `SendChatMessageOptions.images`. */
  images: string[];
  timeoutMs: number;
  /** Caller-supplied tool definitions merged beside the profile's toolJobs — the in-process
   *  consumer's door into function calling (Cadence's coach registry tools ride here). The
   *  caller that supplies them owns their fulfillment; the engine only offers them upstream. */
  extraTools?: unknown[];
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
    images,
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

    const v1Tools = [
      ...((await resolveProfileToolDefinitions(refreshedSession.ai_profile)) ?? []),
      ...(args.extraTools ?? []),
    ];
    return (client as DevsAiClient).messageChatSession(session.external_chat_id, prompt, {
      timeoutMs,
      ...(v1Tools.length > 0 ? { tools: v1Tools } : {}),
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
    const fullHistory: ChatMessage[] = await buildSessionChatMessages(sessionId, refreshedSession);
    if (enrichedContent !== resolvedMessage && fullHistory.length > 0) {
      const lastMsg = fullHistory[fullHistory.length - 1];
      if (lastMsg) lastMsg.content = enrichedContent;
    }

    /**
     * Vision (MP13): splice the photo onto THIS turn's message as a real `input_image` content
     * part — the same shape job execution already sends (job-execution.ts `imageUrls`,
     * request-builder.ts:105-111 `messagesToV2Request`) — so the model actually SEES it, not just
     * a text mention of it. In-memory only, exactly like the text-attachment splice above: the DB
     * row was already written (with the plain resolvedMessage) before this function ran, so a
     * later turn rebuilding history from scratch never resends a signed URL that has likely
     * expired by then. Independent of the attachments-as-text block above — both can apply.
     */
    if (images.length > 0 && fullHistory.length > 0) {
      const lastMsg = fullHistory[fullHistory.length - 1];
      if (lastMsg) lastMsg.content = withImageParts(contentText(lastMsg.content), images);
    }

    /**
     * One mode or the other, never both. Threaded (flag on + a completed response to hang off):
     * `previous_response_id` + only what the server thread has not seen — the spec's ThreadWorkflow
     * holds the rest, and re-sending it is not belt-and-braces, it is how injected context gets
     * silently ignored (measured 2026-08-16: the thread wins and input items are dropped).
     * Stateless (everyone else, and v2 by default): full history, NO thread pointer — which also
     * retires a latent hazard, because the SSE scanner has always persisted response ids into
     * provider_metadata and this code used to hand them straight back to the provider while still
     * sending the full transcript.
     */
    const threading = v2ThreadingEnabled(provider.type, profile?.runtime_options || {});
    const meta = refreshedSession.provider_metadata as {
      previous_response_id?: string;
      conversation_id?: string;
    } | null;
    const prevResponseId = threading ? meta?.previous_response_id : undefined;
    const chatMessages = prevResponseId ? sliceForThread(fullHistory) : fullHistory;

    const chatOptions = buildProviderChatOptions(provider.type, profile?.runtime_options || {}, {
      previousResponseId: prevResponseId,
      conversationId: threading ? meta?.conversation_id : undefined,
      expectedSchema:
        providerType === 'devs-ai-v2' ? (resolvedJob?.config as JobConfig | undefined)?.expectedSchema : undefined,
    });
    const profileTools = await resolveProfileToolDefinitions(refreshedSession.ai_profile);
    const mergedTools = [
      ...(Array.isArray(chatOptions.tools) ? (chatOptions.tools as unknown[]) : []),
      ...(Array.isArray(profileTools) ? profileTools : []),
      ...(args.extraTools ?? []),
    ];
    const modelId = String(profile?.external_ai_id || '').trim();
    const toolsOpt = mergedTools.length > 0 ? { tools: mergedTools } : {};

    let upstream = await client.chatCompletionStream(modelId, chatMessages, {
      ...chatOptions,
      ...toolsOpt,
      timeoutMs,
    });

    /**
     * A thread is a cache, and caches expire: the id may be gone (workflow retention), the run it
     * names may have failed, or threading may have just been switched on against a stale id. Any
     * of those answers 4xx/5xx here — so fall back to one stateless full-history send, clear the
     * pointer, and let the capture below re-anchor the thread on this turn's response. The user
     * pays full price for one turn instead of losing it.
     */
    if (prevResponseId && !upstream.ok) {
      console.warn(`[thread-mode] threaded send failed (${upstream.status}) — falling back to stateless full history`);
      await updateV2ProviderMetadata(sessionId, { previous_response_id: null }).catch(() => {});
      const { previous_response_id: _p, conversation: _c, ...statelessOptions } = chatOptions;
      upstream = await client.chatCompletionStream(modelId, fullHistory, {
        ...statelessOptions,
        ...toolsOpt,
        timeoutMs,
      });
    }

    /**
     * Anchor the NEXT turn: the spec puts the response id in the `x-response-id` header at
     * creation, on streaming responses too. Captured engine-side so the in-process consumer
     * (Cadence's coach, which never touches the HTTP route where the SSE scanner lives) gets it
     * as well. Harmless when the flag is off — the id is recorded and simply never sent.
     */
    if (providerType === 'devs-ai-v2' && upstream.ok) {
      const responseId = upstream.headers.get('x-response-id');
      if (responseId) {
        await updateV2ProviderMetadata(sessionId, { previous_response_id: responseId }).catch((err) =>
          console.warn('[thread-mode] response-id capture failed:', err),
        );
      }
    }

    return upstream;
  }

  throw new Error(`Unsupported provider type "${providerType}" for chat streaming`);
}
