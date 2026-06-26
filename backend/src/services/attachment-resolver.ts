/**
 * Attachment Resolver
 * -------------------
 * Downloads files from signed URLs, validates them, uploads to Devs.ai,
 * and returns IdMessageContent entries for ComplexMessageContent payloads.
 */

import { getSetting } from '../models/app-settings.ts';
import type { Attachment } from '../types.ts';
import type { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { validateSafeUrl } from '../lib/url-validator.ts';

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB (Devs.ai chat file limit)

const MIME_TO_DEVS_AI_TYPE: Record<string, string> = {
  'image/': 'image',
  'audio/': 'audio',
  'video/': 'video',
};

/**
 * Map a MIME type to the Devs.ai FileMessageContentType enum.
 * Falls back to "document" for PDFs, CSV, JSON, plain text, etc.
 */
function resolveDevsAiFileType(mimeType: string): string {
  for (const [prefix, type] of Object.entries(MIME_TO_DEVS_AI_TYPE)) {
    if (mimeType.startsWith(prefix)) return type;
  }
  return 'document';
}

/**
 * Load the configurable attachment settings (cached per-call, not in-memory forever).
 */
async function loadAttachmentSettings(): Promise<{ maxSizeBytes: number; allowedDomains: string[] }> {
  const sizeSetting = await getSetting('max_attachment_size_bytes');
  const domainSetting = await getSetting('allowed_attachment_domains');
  return {
    maxSizeBytes: ((sizeSetting?.value as Record<string, unknown>)?.value as number) ?? DEFAULT_MAX_SIZE,
    allowedDomains: ((domainSetting?.value as Record<string, unknown>)?.value as string[]) ?? [],
  };
}

/**
 * Download a file from a signed URL with size validation.
 * Returns { buffer, mimeType } — the mimeType from the response (may differ from declared).
 */
async function downloadFile(url: string, maxSizeBytes: number): Promise<{ buffer: Buffer; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download attachment (${res.status}): ${url}`);
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > maxSizeBytes) {
      throw new Error(`Attachment exceeds size limit (${contentLength} > ${maxSizeBytes} bytes): ${url}`);
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxSizeBytes) {
      throw new Error(`Attachment exceeds size limit (${arrayBuf.byteLength} > ${maxSizeBytes} bytes): ${url}`);
    }

    return {
      buffer: Buffer.from(arrayBuf),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve an array of attachments for a Devs.ai chat session.
 *
 * For each attachment: validates URL, downloads content, uploads to Devs.ai
 * chat files endpoint, returns an IdMessageContent entry.
 */
export async function resolveAttachments(
  chatId: string,
  attachments: Attachment[],
  devsAiClient: DevsAiClient,
): Promise<Array<{ type: string; id: string }>> {
  if (!attachments?.length) return [];

  const { maxSizeBytes, allowedDomains } = await loadAttachmentSettings();
  const results: Array<{ type: string; id: string }> = [];

  for (const att of attachments) {
    await validateSafeUrl(att.url, { allowedDomains });

    const { buffer } = await downloadFile(att.url, maxSizeBytes);
    const fileType = resolveDevsAiFileType(att.mimeType);

    const uploaded = await devsAiClient.uploadChatFile(chatId, buffer, att.fileName, att.mimeType);
    results.push({ type: fileType, id: uploaded.id });
  }

  return results;
}

/**
 * Resolve attachments as text content for template-based processing jobs.
 * Downloads text-based files and returns their content as strings.
 * Binary files are skipped with a warning.
 */
export async function resolveAttachmentsAsText(
  attachments: Attachment[],
): Promise<Array<{ fileName: string; content: string }>> {
  if (!attachments?.length) return [];

  const { maxSizeBytes, allowedDomains } = await loadAttachmentSettings();
  const textTypes = ['text/', 'application/json', 'application/xml', 'application/csv'];
  const results: Array<{ fileName: string; content: string }> = [];

  for (const att of attachments) {
    await validateSafeUrl(att.url, { allowedDomains });

    const isText = textTypes.some((t) => att.mimeType.startsWith(t));
    if (!isText) {
      console.warn(
        `[attachment-resolver] Skipping binary file "${att.fileName}" (${att.mimeType}) — only text files supported for job templates`,
      );
      continue;
    }

    const { buffer } = await downloadFile(att.url, maxSizeBytes);
    results.push({ fileName: att.fileName, content: buffer.toString('utf-8') });
  }

  return results;
}
