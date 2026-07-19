/**
 * Chat Files — multipart upload, list, and standalone file records.
 */

import type { ChatFileRecord, DevsAiEntity, DevsAiHttp } from './types.ts';

/**
 * Upload a file to a Devs.ai chat session (multipart).
 * After uploading, reference the returned `id` in ComplexMessageContent.
 */
export async function uploadChatFile(
  client: DevsAiHttp,
  chatId: string,
  fileData: Buffer | Blob,
  fileName: string,
  mimeType: string,
): Promise<{
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  status: string;
}> {
  const blob = fileData instanceof Blob ? fileData : new Blob([new Uint8Array(fileData)], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('source', 'USER');

  return client._request('POST', `/api/v1/chats/${chatId}/files`, form, {
    rawBody: true,
  });
}

/** List all files (USER-uploaded and SYSTEM-generated) in a chat session. */
export async function listChatFiles(client: DevsAiHttp, chatId: string): Promise<ChatFileRecord[]> {
  const payload = await client._request<{ data?: ChatFileRecord[] }>('GET', `/api/v1/chats/${chatId}/files`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

/** Create a standalone file record (or upload directly). */
export async function createFileRecord(
  client: DevsAiHttp,
  fileInfo: {
    filename: string;
    size: number;
    mimeType: string;
    metadata?: Record<string, unknown>;
  },
): Promise<DevsAiEntity> {
  return client._request('POST', '/api/v1/files', fileInfo);
}
