import type { AttachmentRef } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';
import { supabase } from '../supabase.ts';
import type { PreparedAttachment } from '../attachments/prepare.ts';

/**
 * The upload, in two calls and no body (owner, 2026-09-11): ask the API to mint a one-shot signed
 * upload for this file, then PUT the bytes straight to Supabase Storage on that token. The
 * message that follows carries only the ref. That is what lets a 20 MB PDF through a platform
 * whose functions refuse a 4.5 MB body — `@cadence/shared` attachments.ts has the derivation.
 */

interface SignedUpload {
  ref: string;
  token: string;
  bucket: string;
  kind: AttachmentRef['kind'];
  mime: string;
}

/** Ask for the upload slot. A 400 carries the server's own words (same classifier as ours). */
export async function signCoachUpload(name: string, mime: string, size: number): Promise<SignedUpload> {
  const res = await fetch(`${BASE}/coach/attachments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name, mime, size }),
    signal: timeoutSignal(15_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `could not prepare the upload (${res.status})`);
  }
  return res.json();
}

/** Sign, then PUT. Returns the ref the message carries. */
export async function uploadCoachAttachment(prepared: PreparedAttachment): Promise<AttachmentRef> {
  const signed = await signCoachUpload(prepared.name, prepared.mime, prepared.blob.size);
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.ref, signed.token, prepared.blob, { contentType: signed.mime, upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { ref: signed.ref, kind: signed.kind, name: prepared.name, mime: signed.mime, size: prepared.blob.size };
}
