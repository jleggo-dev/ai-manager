/**
 * Pure helpers for AI Admin Test Chat streaming / tool-auth UI.
 * Extracted from TestChatPanel (FE-11) so SSE-adjacent logic can be unit-tested
 * without mounting the Mantine panel.
 */

import type { AiProfile } from '../types/api';

export interface TestChatMessage {
  id?: string;
  role: string;
  content?: string;
  streaming?: boolean;
  meta?: {
    duration?: number;
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  toolEvent?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  status?: string;
  output?: string | Record<string, unknown>;
  requiresAuth?: boolean;
  requiresUserAction?: boolean;
  messageId?: string;
}

export interface PendingAuth {
  toolCallId: string;
  messageId: string;
  authUrl: string | null;
}

export interface TestChatApiResult {
  content: string;
  durationMs?: number;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** Friendly tool name extracted from MCP tool type like mcp__<id>__listFiles */
export function friendlyToolName(toolType: string | null | undefined): string {
  if (!toolType) return 'unknown tool';
  const parts = toolType.split('__');
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    return last || toolType;
  }
  return toolType;
}

/** Mark the last streaming assistant message as complete. */
export function finalizeStreamingMessages(messages: TestChatMessage[]): TestChatMessage[] {
  const updated = [...messages];
  let lastIdx = -1;
  for (let i = updated.length - 1; i >= 0; i--) {
    const msg = updated[i];
    if (msg && msg.role === 'assistant' && msg.streaming) {
      lastIdx = i;
      break;
    }
  }
  const target = lastIdx >= 0 ? updated[lastIdx] : undefined;
  if (lastIdx >= 0 && target) updated[lastIdx] = { ...target, streaming: false };
  return updated;
}

/** Drop empty streaming placeholders and append an error bubble. */
export function appendStreamError(messages: TestChatMessage[], content: string): TestChatMessage[] {
  const cleaned = messages.filter((m) => !(m.role === 'assistant' && m.streaming && !m.content));
  return [...cleaned, { role: 'error', content }];
}

/** Apply a text delta onto the trailing streaming assistant message (or create one). */
export function applyAssistantDelta(messages: TestChatMessage[], assistantContent: string): TestChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.streaming) {
    const updated = [...messages];
    updated[updated.length - 1] = {
      ...last,
      content: assistantContent,
    };
    return updated;
  }
  return [...messages, { role: 'assistant', content: assistantContent, streaming: true }];
}

/** Build the "Test Tools Preset" prompt from a profile's provider + runtime options. */
export function buildToolsPresetPrompt(profile: AiProfile | null | undefined): string {
  const providerType = String(profile?.provider?.type || '')
    .trim()
    .toLowerCase();
  const rtOpts = profile?.runtime_options ?? {};
  const devsAiRaw = rtOpts.devs_ai;
  const devsAiOptions = (devsAiRaw && typeof devsAiRaw === 'object' ? devsAiRaw : {}) as Record<string, unknown>;
  const geminiRaw = rtOpts.google_gemini;
  const geminiOptions = (geminiRaw && typeof geminiRaw === 'object' ? geminiRaw : {}) as Record<string, unknown>;
  const enabledToolIds: string[] = Array.isArray(devsAiOptions.built_in_tools)
    ? (devsAiOptions.built_in_tools as unknown[]).map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  if (providerType === 'devs-ai') {
    const toolList = enabledToolIds.length > 0 ? enabledToolIds.join(', ') : 'none';
    return [
      'Run a runtime-tools smoke test for this profile.',
      `Enabled tools configured on this profile: ${toolList}.`,
      'If web_search is enabled, run one web lookup and include at least one source URL.',
      'If python is enabled, run a tiny calculation (e.g., 37*19) and include the result.',
      'If spreadsheet is enabled, show a tiny 2-row table transformed into CSV.',
      'If memory is enabled, store a short key/value and confirm it was saved.',
      'If sandbox is enabled, run a trivial sandbox action and summarize outcome.',
      'Return compact JSON with: toolsDetected, toolsUsed, checks, and notes.',
    ].join('\n');
  }

  if (providerType === 'google-gemini') {
    const grounding = geminiOptions?.grounding_with_google_search === true;
    return grounding
      ? [
          'Run a grounding smoke test.',
          'Use Google Search grounding to answer: "What is the latest official news about Gemini API pricing?"',
          'Include citation URLs and state that grounding was used.',
        ].join('\n')
      : [
          'Run a non-grounded response smoke test.',
          'Answer this from model knowledge only: "Summarize what grounding in Gemini means in 3 bullets."',
          'Do not use web lookups.',
        ].join('\n');
  }

  return [
    'Run a basic tool/runtime smoke test for this profile.',
    'Describe whether any provider runtime options seem active in this response.',
  ].join('\n');
}

/** Extract text delta from OpenAI / Gemini / generic SSE payload shapes. */
export function extractTextDelta(parsed: Record<string, unknown>): string {
  const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
  const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const content = parsed.content;

  return (
    choices?.[0]?.delta?.content ||
    candidates?.[0]?.content?.parts?.[0]?.text ||
    (typeof content === 'string' ? content : (content as { text?: string } | undefined)?.text) ||
    ''
  );
}
