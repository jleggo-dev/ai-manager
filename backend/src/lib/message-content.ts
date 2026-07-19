import type { ChatMessage, ContentPart } from '../types.ts';

/**
 * Helpers for multimodal message content (types.ts `ContentPart`). Text-only messages stay
 * plain strings everywhere; these helpers are the single seam where providers and the job
 * pipeline reason about parts.
 */

/** Plain-text view of message content — image parts contribute nothing. */
export function contentText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** True when the content carries at least one image part. */
export function hasImageParts(content: ChatMessage['content']): boolean {
  return typeof content !== 'string' && content.some((p) => p.type === 'image_url');
}

/** Compose text + image URLs into message content; stays a plain string when no images. */
export function withImageParts(text: string, imageUrls: string[]): ChatMessage['content'] {
  if (imageUrls.length === 0) return text;
  return [{ type: 'text', text }, ...imageUrls.map((url) => ({ type: 'image_url', url }) as ContentPart)];
}

/**
 * Map canonical messages to the OpenAI chat-completions wire dialect
 * (`{type:'text'}` / `{type:'image_url', image_url:{url}}`) used by the Devs.ai v1
 * compat endpoint. String content passes through untouched.
 */
export function toOpenAiWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (typeof m.content === 'string') return m as unknown as Record<string, unknown>;
    return {
      role: m.role,
      content: m.content.map((p) =>
        p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.url } },
      ),
    };
  });
}
