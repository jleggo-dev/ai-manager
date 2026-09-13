import type { ChatFileInput, ChatMessage, ContentPart } from '../types.ts';

/**
 * Helpers for multimodal message content (types.ts `ContentPart`). Text-only messages stay
 * plain strings everywhere; these helpers are the single seam where providers and the job
 * pipeline reason about parts.
 */

/** Plain-text view of message content — image and file parts contribute nothing. */
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
  return withAttachmentParts(text, imageUrls, []);
}

/**
 * The label a text-bearing file gets when it is spliced into a turn as prose. The same `--- name
 * ---` framing `resolveAttachmentsAsText` has always used for template jobs, so a model that has
 * seen one has seen both.
 */
export function textFileBlock(file: { filename: string; text: string }): string {
  return `--- ${file.filename} ---\n${file.text}`;
}

/**
 * Compose one turn's content: the text, then images, then documents. Text-bearing files become
 * their own text part (a `.csv` is prose to every provider), PDFs become `file` parts by id or
 * inline data, and a file with neither id nor data nor text is dropped — there is nothing to
 * send. Stays a plain string when there is nothing but the text.
 */
export function withAttachmentParts(text: string, imageUrls: string[], files: ChatFileInput[]): ChatMessage['content'] {
  const parts: ContentPart[] = [];
  for (const url of imageUrls) parts.push({ type: 'image_url', url });
  for (const f of files) {
    if (typeof f.text === 'string') {
      parts.push({ type: 'text', text: textFileBlock({ filename: f.filename, text: f.text }) });
    } else if (f.fileId || f.data) {
      parts.push({
        type: 'file',
        filename: f.filename,
        mimeType: f.mimeType,
        ...(f.fileId ? { fileId: f.fileId } : {}),
        ...(f.data ? { data: f.data } : {}),
      });
    }
  }
  if (parts.length === 0) return text;
  return [{ type: 'text', text }, ...parts];
}

/**
 * Map canonical messages to the OpenAI chat-completions wire dialect
 * (`{type:'text'}` / `{type:'image_url', image_url:{url}}` / `{type:'file', file:{...}}`) used
 * by the Devs.ai v1 compat endpoint. String content passes through untouched.
 */
export function toOpenAiWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (typeof m.content === 'string') return m as unknown as Record<string, unknown>;
    return {
      role: m.role,
      content: m.content.map((p) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image_url') return { type: 'image_url', image_url: { url: p.url } };
        return {
          type: 'file',
          file: {
            filename: p.filename,
            ...(p.fileId ? { file_id: p.fileId } : {}),
            ...(p.data ? { file_data: `data:${p.mimeType};base64,${p.data}` } : {}),
          },
        };
      }),
    };
  });
}
