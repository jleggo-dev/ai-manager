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

/** Devs.ai's own ceiling on a multipart upload — it goes through a Vercel Function (spec:
 *  "limited to about 4.5MB"). Above it the only route is the chat-scoped Blob flow, which needs
 *  a v1 chat id the v2 Responses path does not have — so this is the honest cap for now. */
export const DEVS_AI_MULTIPART_MAX_BYTES = 4.5 * 1024 * 1024;

/** How long we wait for a just-uploaded file to reach UPLOADED before referencing it. */
const UPLOAD_POLL_MS = 500;
const UPLOAD_POLL_LIMIT = 20;

/**
 * Upload a standalone file (`POST /api/v1/files`, multipart) and wait until Devs.ai reports it
 * `UPLOADED` — the spec says to poll before referencing a file in a message, and a multipart
 * upload usually lands already-uploaded, so the poll is normally zero rounds. Returns the id a
 * `file` content part references (`input_file.file_id` on the v2 Responses path).
 *
 * Shared by the v1 and v2 clients: same endpoint, same bearer key, same record.
 */
export async function uploadStandaloneFile(
  client: DevsAiHttp,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<{ fileId: string }> {
  if (file.buffer.length > DEVS_AI_MULTIPART_MAX_BYTES) {
    throw new Error(
      `Devs.ai takes files up to about 4.5 MB on this path; "${file.filename}" is ${file.buffer.length} bytes`,
    );
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);

  const headers = client._headers();
  delete headers['Content-Type']; // fetch sets the multipart boundary itself
  const res = await fetch(`${client.baseUrl}/api/v1/files`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`Devs.ai file upload failed (${res.status}): ${await res.text()}`);
  const created = (await res.json()) as { id?: string; status?: string; data?: { id?: string; status?: string } };
  const fileId = created.id ?? created.data?.id;
  if (!fileId) throw new Error('Devs.ai file upload returned no id');

  let status = (created.status ?? created.data?.status ?? '').toUpperCase();
  for (let i = 0; status !== 'UPLOADED' && i < UPLOAD_POLL_LIMIT; i += 1) {
    await new Promise((r) => setTimeout(r, UPLOAD_POLL_MS));
    const record = await client._request<{ status?: string; data?: { status?: string } }>(
      'GET',
      `/api/v1/files/${fileId}`,
    );
    status = (record?.status ?? record?.data?.status ?? '').toUpperCase();
    if (status === 'FAILED' || status === 'ERROR') throw new Error(`Devs.ai file ${fileId} failed to process`);
  }
  if (status !== 'UPLOADED') throw new Error(`Devs.ai file ${fileId} did not finish uploading (status ${status})`);
  return { fileId };
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
