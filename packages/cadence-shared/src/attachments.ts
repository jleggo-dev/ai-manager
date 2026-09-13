/**
 * Chat attachments — the ONE place the limits live (owner, 2026-09-11).
 *
 * The composer, the signed-upload route, and the turn's attach step all read these; a number
 * that lives twice is a number that drifts. Every limit here is derived from something real,
 * and the derivation is written down so the next person can re-check it rather than trust it:
 *
 *  - Vercel Functions cap a request BODY at 4.5 MB (cadence-api and Devs.ai both run on them),
 *    and base64 inflates bytes by a third. So nothing here ever rides a JSON body: bytes go from
 *    the browser straight to Storage on a signed upload URL, and only a small reference is sent
 *    with the message. The 4.5 MB ceiling is still the reason IMAGE_MAX_BYTES is 4 MB: an image
 *    reaches the model as a signed URL today, and 4 MB keeps a base64 fallback possible.
 *  - Claude downscales anything over 2576 px on its long edge, and the Devs.ai models in play
 *    cap lower; a phone photo re-encoded at 2048 px / JPEG 0.85 lands at 300 KB to 1 MB and
 *    loses nothing the model would have kept. The picker accepts the raw 20 MB shot; the
 *    composer shrinks it BEFORE upload and rejects only what is still over 4 MB afterwards.
 *  - PDFs cannot be compressed (they already are), so they get a byte cap AND a page cap: 100
 *    pages is the Claude limit on 200k-context models and roughly 150k to 300k tokens — the page
 *    cap is the cost gate, the byte cap is the transport gate. The byte cap is Devs.ai's: its
 *    standalone upload is multipart through a Vercel Function, about 4.5 MB, and Devs.ai is the
 *    main provider (owner, 2026-09-11) — so 4 MB, refused on the device rather than discovered as
 *    a provider error. Raise it when documents go through the Anthropic Files API (500 MB).
 *  - Text files are tokens, not bytes: 1 MB of CSV is ~250k tokens, already past what most of
 *    the models in the catalog take in one turn. 1 MB is the owner's ceiling; expect it to come
 *    down once a real one lands.
 */

export type AttachmentKind = 'image' | 'document' | 'text';

/** What the picker offers, by kind. HEIC/HEIF is accepted from the picker (every iPhone shoots
 *  it) and converted to JPEG on the device — no model reads HEIC. */
export const IMAGE_SOURCE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;
/** What actually goes up and reaches a model. */
export const IMAGE_UPLOAD_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/**
 * PDF and Word. Probed live against Devs.ai on 2026-09-13 (apps/cadence-api/scripts/
 * probe-devs-ai-office.ts): a .docx by file id AND inline is read back correctly; .xlsx and
 * .pptx are accepted at upload but the model reports it cannot see them, on either path. So
 * Word is in and the other two stay out until the provider reads them — "accept what Devs.ai
 * accepts" means what it can READ, not what its upload endpoint takes.
 */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_MIMES = ['application/pdf', DOCX_MIME] as const;
export const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/csv'] as const;

/** Extension → kind, for pickers and OSes that hand over a blank or wrong MIME type (Windows
 *  reports `.md` as nothing at all; Android reports `.csv` as `application/octet-stream`). */
const EXT_KINDS: Readonly<Record<string, { kind: AttachmentKind; mime: string }>> = {
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
  heic: { kind: 'image', mime: 'image/heic' },
  heif: { kind: 'image', mime: 'image/heif' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  docx: { kind: 'document', mime: DOCX_MIME },
  txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/markdown' },
  markdown: { kind: 'text', mime: 'text/markdown' },
  csv: { kind: 'text', mime: 'text/csv' },
};

/** The picker's `accept` attribute — MIME types plus extensions, since Safari matches on one and
 *  Android on the other. */
export const ATTACHMENT_ACCEPT = [
  ...IMAGE_SOURCE_MIMES,
  ...DOCUMENT_MIMES,
  ...TEXT_MIMES,
  ...Object.keys(EXT_KINDS).map((ext) => `.${ext}`),
].join(',');

/* ── Limits ──────────────────────────────────────────────────────────────────────────────── */

/** A raw phone photo, before the composer shrinks it. */
export const IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** An image after the composer's re-encode — the number that goes on the wire. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Longest edge after re-encode. Claude keeps up to 2576 px; 2048 is the same visual budget
 *  with a comfortable margin under every transport limit. */
export const IMAGE_MAX_EDGE_PX = 2048;
export const IMAGE_JPEG_QUALITY = 0.85;
/** Under this size AND within the edge cap, a JPEG/PNG/WebP goes up untouched — re-encoding a
 *  small screenshot only softens its text. */
export const IMAGE_PASSTHROUGH_MAX_BYTES = 1024 * 1024;

/** Devs.ai's multipart ceiling is ~4.5 MB (`DEVS_AI_MULTIPART_MAX_BYTES` in the engine); 4 MB
 *  keeps a clean margin under it. The owner's 20 MB waits on the Anthropic Files API path. */
export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_MAX_PAGES = 100;

export const TEXT_MAX_BYTES = 1024 * 1024;

/** Per message. Four is what the gym-photo route allows for one gym, and one turn that needs
 *  more than four attachments is a turn that should be two. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export const ATTACHMENT_MAX_BYTES: Readonly<Record<AttachmentKind, number>> = {
  image: IMAGE_MAX_BYTES,
  document: DOCUMENT_MAX_BYTES,
  text: TEXT_MAX_BYTES,
};

/* ── Classification ──────────────────────────────────────────────────────────────────────── */

export interface ClassifiedAttachment {
  kind: AttachmentKind;
  /** The MIME type the server should trust — normalized from the extension when the picker's
   *  own type is blank, generic, or lies. */
  mime: string;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Decide what a picked file IS, or null when it is nothing we take. MIME first (a `.txt` that is
 * really a PDF stays a PDF); extension when the MIME is absent or a generic octet-stream; and a
 * MIME/extension DISAGREEMENT on a known extension is resolved in the MIME's favour — the bytes
 * are what the model reads.
 */
export function classifyAttachment(name: string, mime: string | null | undefined): ClassifiedAttachment | null {
  const m = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if ((IMAGE_SOURCE_MIMES as readonly string[]).includes(m)) return { kind: 'image', mime: m };
  if ((DOCUMENT_MIMES as readonly string[]).includes(m)) return { kind: 'document', mime: m };
  if ((TEXT_MIMES as readonly string[]).includes(m)) return { kind: 'text', mime: m };
  // `text/x-markdown` and friends: any text/* the extension vouches for.
  const byExt = EXT_KINDS[extOf(name)];
  if (!byExt) return null;
  if (!m || m === 'application/octet-stream' || (m.startsWith('text/') && byExt.kind === 'text')) return byExt;
  return null;
}

/* ── Checks ──────────────────────────────────────────────────────────────────────────────── */

export type AttachmentRejection =
  | { reason: 'unsupported_type' }
  | { reason: 'too_large'; kind: AttachmentKind; limitBytes: number }
  | { reason: 'too_many_pages'; limitPages: number }
  | { reason: 'too_many'; limit: number };

/** Bytes as the user would say them — "4 MB", "512 KB". */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The words the composer shows and the coach is told. One phrasing, warm and specific (BRAND.md:
 * plain kind words, say what happened). `name` is the file the user picked.
 */
export function attachmentRejectionText(name: string, r: AttachmentRejection): string {
  switch (r.reason) {
    case 'unsupported_type':
      return `I can't read ${name} — photos, PDFs, Word documents, and plain text (.txt, .md, .csv) work.`;
    case 'too_large':
      return r.kind === 'image'
        ? `${name} is still over ${humanBytes(r.limitBytes)} after shrinking — try a screenshot or a smaller crop.`
        : `${name} is over ${humanBytes(r.limitBytes)} — I can take files up to that size.`;
    case 'too_many_pages':
      return `${name} runs past ${r.limitPages} pages — I can read up to ${r.limitPages}. Could you send the part that matters?`;
    case 'too_many':
      return `That's more than ${r.limit} files for one message — send the rest in the next one.`;
  }
}

/** The size gate for a kind, after the composer has done its shrinking. Pure, so the route and
 *  the composer agree by construction. */
export function checkAttachmentSize(kind: AttachmentKind, bytes: number): AttachmentRejection | null {
  const limit = ATTACHMENT_MAX_BYTES[kind];
  return bytes > limit ? { reason: 'too_large', kind, limitBytes: limit } : null;
}

/** A reference to a file already in Storage — what a message actually carries. */
export interface AttachmentRef {
  /** Storage path, userId-scoped by construction (`<userId>/<date>/<uuid>.<ext>`). */
  ref: string;
  kind: AttachmentKind;
  /** The user's own filename, for the coach and the transcript. */
  name: string;
  mime: string;
  size: number;
}
