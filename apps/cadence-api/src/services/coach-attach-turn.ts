/**
 * Turn a chat message's attachments into what the rest of the turn needs (owner, 2026-09-11:
 * files and photos on the coach chat). Succeeds MP13's `coach-photo-attach.ts`, whose one photo
 * is now one of up to four refs — and whose two outputs are kept exactly:
 *
 *  (a) what rides THIS turn as real content parts — `images` (signed URLs, vision) and `files`
 *      (a PDF by provider file id, a text file as prose) — through sendCoachMessage →
 *      chat-messaging.ts → openChatSendStream;
 *  (b) a durable, transcript-invisible `<context>` note via injectCoachContext, filtered by the
 *      same isRealTurn/APP_AUTHORED rule as every other one, so she can still name the photo_ref
 *      to read_label on a later turn even though the URL in (a) has long expired.
 *
 * Soft-fails PER ATTACHMENT on purpose: a PDF that turns out to be 240 pages must not sink a
 * turn that also carries a photo and a real question — but she is told exactly what did not come
 * through, in the same words the composer would have used, rather than left to guess.
 *
 * The bytes reach a provider only for documents, and only server-side: Storage → here → the
 * engine's `uploadChatSessionFile` (its own upload call, never the JSON that carries the
 * conversation). Images stay URLs; text is decoded and spliced as prose.
 */
import { DOCUMENT_MAX_PAGES, attachmentRejectionText, checkAttachmentSize, type AttachmentRef } from '@cadence/shared';
import { injectCoachContext, uploadCoachFile, type ChatFileInput } from '../ai/aim.ts';
import {
  COACH_ATTACHMENT_REF_PREFIX,
  downloadAttachment,
  kindOfMime,
  ownsAttachment,
  signAttachmentUrl,
  statAttachment,
} from './coach-attachments.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { countPdfPages } from './pdf-pages.ts';

export interface TurnAttachmentsInput {
  /** MP13's data-URL photo — still honoured for any caller that sends one. */
  photo: string | null;
  attachments: AttachmentRef[];
}

export interface TurnAttachments {
  images: string[];
  files: ChatFileInput[];
}

interface Resolved {
  image?: string;
  file?: ChatFileInput;
  /** One line of the note — what she is told about this attachment. */
  line: string;
}

const READ_LABEL_HINT =
  'For an exact, structured read — the printed numbers on a nutrition panel, or a product name ' +
  'and brand — call read_label with this exact photo_ref rather than transcribing it from what you see.';

/** The reach-back (owner, 2026-09-13): the file rides THIS turn; on any later one she reads it
 *  again through read_document, from our own copy — the same way photo_ref → read_label works. */
const READ_DOCUMENT_HINT =
  'On a later turn, when they ask about it and it is no longer in front of you, call read_document with this ' +
  'exact doc_ref to read it again.';

function photoLine(name: string, photoRef: string): string {
  return `- Photo "${name}" is attached (shown to you directly, above). photo_ref: "${photoRef}". ${READ_LABEL_HINT}`;
}

function failedLine(name: string, why: string): string {
  return `- "${name}" did not come through: ${why} If it matters, tell the user.`;
}

/** One ref → one content part (or nothing) and one line for the note. Never throws. */
async function resolveOne(userId: string, sessionId: string, a: AttachmentRef): Promise<Resolved> {
  const name = a.name || a.ref.split('/').pop() || 'attachment';
  try {
    if (!ownsAttachment(userId, a.ref)) return { line: failedLine(name, 'the upload reference was not valid.') };
    const stat = await statAttachment(a.ref);
    if (!stat) return { line: failedLine(name, 'the upload never finished.') };
    // The bucket enforced the byte cap and the MIME allowlist; what is checked here is that the
    // KIND the client claimed matches the type Storage recorded, and the per-kind size.
    const kind = kindOfMime(stat.contentType);
    if (!kind || kind !== a.kind)
      return { line: failedLine(name, attachmentRejectionText(name, { reason: 'unsupported_type' })) };
    const tooBig = checkAttachmentSize(kind, stat.size);
    if (tooBig) return { line: failedLine(name, attachmentRejectionText(name, tooBig)) };

    if (kind === 'image') {
      const url = await signAttachmentUrl(a.ref);
      return { image: url, line: photoLine(name, `${COACH_ATTACHMENT_REF_PREFIX}${a.ref}`) };
    }
    const bytes = await downloadAttachment(a.ref, stat.size);
    const docRef = `${COACH_ATTACHMENT_REF_PREFIX}${a.ref}`;
    if (kind === 'text') {
      const text = bytes.toString('utf8');
      return {
        file: { filename: name, mimeType: stat.contentType, text },
        line: `- Text file "${name}" is attached; its full contents are in this message. doc_ref: "${docRef}". ${READ_DOCUMENT_HINT}`,
      };
    }
    // The page cap is a PDF fact (the cost gate; pdf-lib counts real pages). A Word document has
    // no page count until it is laid out — its gate is the byte cap alone, already applied above.
    const isPdf = stat.contentType.split(';')[0]?.trim().toLowerCase() === 'application/pdf';
    const pages = isPdf ? await countPdfPages(bytes) : null;
    if (pages != null && pages > DOCUMENT_MAX_PAGES) {
      const why = attachmentRejectionText(name, { reason: 'too_many_pages', limitPages: DOCUMENT_MAX_PAGES });
      return { line: failedLine(name, why) };
    }
    const { fileId } = await uploadCoachFile(userId, sessionId, {
      buffer: bytes,
      filename: name,
      mimeType: stat.contentType,
    });
    const shape = pages != null ? `${pages} page${pages === 1 ? '' : 's'}` : 'Word document';
    return {
      file: { filename: name, mimeType: stat.contentType, fileId },
      line: `- Document "${name}" (${shape}) is attached; read it directly from this message. doc_ref: "${docRef}". ${READ_DOCUMENT_HINT}`,
    };
  } catch (e) {
    console.error('[coach attach]', name, e);
    const why =
      e instanceof Error && /4\.5 MB/.test(e.message)
        ? 'it is larger than I can take as a document right now (about 4 MB).'
        : 'it could not be read.';
    return { line: failedLine(name, why) };
  }
}

/** MP13's data-URL photo, unchanged in behaviour: meal-photos bucket, same note, same soft-fail. */
async function resolveLegacyPhoto(userId: string, photo: string): Promise<Resolved> {
  try {
    const photoRef = await putMealPhoto(userId, new Date().toISOString().slice(0, 10), photo);
    return { image: await signMealPhotoUrl(photoRef), line: photoLine('photo', photoRef) };
  } catch (e) {
    console.error('[coach photo attach]', e);
    return { line: failedLine('photo', 'it failed to upload, so nothing came through.') };
  }
}

/**
 * Resolve everything attached to this message. Returns `{ images: [], files: [] }` for a bare
 * message and never throws — every failure becomes a line in the note instead.
 */
export async function attachToTurn(
  userId: string,
  sessionId: string,
  input: TurnAttachmentsInput,
): Promise<TurnAttachments> {
  const resolved: Resolved[] = [];
  if (input.photo) resolved.push(await resolveLegacyPhoto(userId, input.photo));
  for (const a of input.attachments) resolved.push(await resolveOne(userId, sessionId, a));
  if (resolved.length === 0) return { images: [], files: [] };

  const note = ['Attached to this message:', ...resolved.map((r) => r.line)].join('\n');
  await injectCoachContext(userId, sessionId, note, {
    source: resolved.some((r) => r.image || r.file) ? 'attachments' : 'attachments-failed',
    version: 2,
  }).catch((e) => console.error('[injectCoachContext attachments]', e));

  return {
    images: resolved.flatMap((r) => (r.image ? [r.image] : [])),
    files: resolved.flatMap((r) => (r.file ? [r.file] : [])),
  };
}
