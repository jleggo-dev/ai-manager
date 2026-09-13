/**
 * Coach chat attachments — the Storage half (owner, 2026-09-11: files and photos on the chat).
 *
 * The bytes never touch cadence-api. The route mints a one-shot signed upload URL for a path it
 * chose (`<userId>/<date>/<uuid>.<ext>` — the same shape meal photos use, so purge stays one
 * folder walk), the browser PUTs straight to Supabase Storage, and the message carries only the
 * ref. That is what keeps a 4 MB PDF and a 4 MB photo off a platform whose functions refuse a
 * 4.5 MB body (`@cadence/shared` attachments.ts has the derivation and the Devs.ai ceiling).
 *
 * One PRIVATE bucket for every kind, with the byte cap and the MIME allowlist set ON THE BUCKET:
 * a signed token is bound to a path, not to a size, so the bucket is what stops a 200 MB upload
 * the composer never saw. Self-healing create on first use, like the photo buckets.
 *
 * Refs handed to the coach carry the bucket as a prefix (`coach-attachments/<path>`) so
 * `read_label` — built for meal photos — can re-sign a chat photo through the same
 * `signMealPhotoUrl` door without learning a second vocabulary.
 */
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIMES,
  IMAGE_UPLOAD_MIMES,
  TEXT_MIMES,
  type AttachmentKind,
} from '@cadence/shared';
import { cadenceServiceClient } from '../db/supabase.ts';

export const COACH_ATTACHMENTS_BUCKET = 'coach-attachments';
/** What a chat photo's `photo_ref` looks like to the coach and to read_label. */
export const COACH_ATTACHMENT_REF_PREFIX = `${COACH_ATTACHMENTS_BUCKET}/`;

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** The path a new upload gets. Pure, so the ownership check below can be tested against it. */
export function newAttachmentPath(userId: string, mime: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`no attachment extension for ${mime}`);
  return `${userId}/${today()}/${crypto.randomUUID()}.${ext}`;
}

/**
 * A ref the client sends back must be one WE minted for THIS user: their id as the first
 * segment, a date, a uuid, one of our extensions, nothing else. Anything shaped differently is
 * refused before Storage is asked — a `../` or another user's prefix never reaches a query.
 */
export function ownsAttachment(userId: string, ref: string): boolean {
  if (!userId || ref.length > 300) return false;
  const exts = Object.values(EXT_BY_MIME).join('|');
  const re = new RegExp(`^${escapeRe(userId)}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}\\.(${exts})$`);
  return re.test(ref);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBucketMissing(message: string): boolean {
  return /bucket/i.test(message) && /not.*found/i.test(message);
}

const BUCKET_CONFIG = {
  public: false,
  fileSizeLimit: DOCUMENT_MAX_BYTES,
  allowedMimeTypes: [...IMAGE_UPLOAD_MIMES, ...DOCUMENT_MIMES, ...TEXT_MIMES],
};

async function ensureBucket(): Promise<void> {
  await cadenceServiceClient()
    .storage.createBucket(COACH_ATTACHMENTS_BUCKET, BUCKET_CONFIG)
    .catch(() => {}); // race-safe: the loser's "already exists" is fine
}

/**
 * The allowlist lives ON the bucket, and a bucket created under an older list keeps it — so
 * widening `DOCUMENT_MIMES` (Word, 2026-09-13) would have left a live bucket refusing .docx with
 * no code path ever re-stating the list. Re-applied once per process, before the first sign, so
 * a deploy that changes the list is enough. Best-effort: a failure here just means the bucket's
 * own list stands, which the sign itself will surface as a refused upload.
 */
let bucketConfigApplied: Promise<void> | null = null;
function ensureBucketConfig(): Promise<void> {
  bucketConfigApplied ??= cadenceServiceClient()
    .storage.updateBucket(COACH_ATTACHMENTS_BUCKET, BUCKET_CONFIG)
    .then(() => undefined)
    .catch(() => undefined);
  return bucketConfigApplied;
}

/**
 * Mint the one-shot upload the browser will use. Returns the ref (the storage path) and the
 * token `uploadToSignedUrl` needs; the bucket name rides in the route's response so the client
 * never hardcodes it.
 */
export async function signCoachUpload(userId: string, mime: string): Promise<{ ref: string; token: string }> {
  const ref = newAttachmentPath(userId, mime);
  const storage = cadenceServiceClient().storage;
  await ensureBucketConfig();
  const sign = () => storage.from(COACH_ATTACHMENTS_BUCKET).createSignedUploadUrl(ref);
  let { data, error } = await sign();
  if (error && isBucketMissing(error.message)) {
    await ensureBucket();
    ({ data, error } = await sign());
  }
  if (error || !data?.token) throw new Error(`attachment sign failed: ${error?.message ?? 'no token'}`);
  return { ref, token: data.token };
}

/** What Storage actually holds at a ref — the size the bucket enforced and the type the client
 *  declared — or null when nothing is there (the upload never finished, or the ref is invented). */
export async function statAttachment(ref: string): Promise<{ size: number; contentType: string } | null> {
  const { data, error } = await cadenceServiceClient().storage.from(COACH_ATTACHMENTS_BUCKET).info(ref);
  if (error || !data) return null;
  return { size: Number(data.size ?? 0), contentType: String(data.contentType ?? '') };
}

/** A short-lived read URL — what a vision content part carries. */
export async function signAttachmentUrl(ref: string, ttlSeconds = 600): Promise<string> {
  const { data, error } = await cadenceServiceClient()
    .storage.from(COACH_ATTACHMENTS_BUCKET)
    .createSignedUrl(ref, ttlSeconds);
  if (error || !data?.signedUrl) throw new Error(`attachment sign failed: ${error?.message ?? 'no url'}`);
  return data.signedUrl;
}

/** The bytes, server-side (no body limit on the way OUT of Storage), bounded by `maxBytes`. */
export async function downloadAttachment(ref: string, maxBytes: number): Promise<Buffer> {
  const { data, error } = await cadenceServiceClient().storage.from(COACH_ATTACHMENTS_BUCKET).download(ref);
  if (error || !data) throw new Error(`attachment download failed: ${error?.message ?? 'no data'}`);
  if (data.size > maxBytes) throw new Error(`attachment is too large (${data.size} bytes)`);
  return Buffer.from(await data.arrayBuffer());
}

/** Remove every attachment the user owns — the start-over promise, same walk as meal photos. */
export async function purgeCoachAttachments(userId: string): Promise<void> {
  const storage = cadenceServiceClient().storage;
  const { data: days } = await storage.from(COACH_ATTACHMENTS_BUCKET).list(userId);
  for (const day of days ?? []) {
    const prefix = `${userId}/${day.name}`;
    const { data: files } = await storage.from(COACH_ATTACHMENTS_BUCKET).list(prefix);
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) await storage.from(COACH_ATTACHMENTS_BUCKET).remove(paths);
  }
}

/** The kind a stored content type belongs to, for the turn's "is it what the client said" check. */
export function kindOfMime(mime: string): AttachmentKind | null {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if ((IMAGE_UPLOAD_MIMES as readonly string[]).includes(m)) return 'image';
  if ((DOCUMENT_MIMES as readonly string[]).includes(m)) return 'document';
  if ((TEXT_MIMES as readonly string[]).includes(m)) return 'text';
  return null;
}
