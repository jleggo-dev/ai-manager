/**
 * What happens to a picked file BEFORE it leaves the device (owner, 2026-09-11: files and photos
 * on the coach chat). Two halves, split so the pure one is table-tested and the browser one is
 * thin:
 *
 *  - `describeFile` decides what the file is and whether it can go at all — the shared
 *    classifier and limits from `@cadence/shared`, so the composer, the sign route, and the turn
 *    all refuse the same things in the same words.
 *  - `shrinkImage` is the compression the owner asked for: a phone photo (HEIC included, where
 *    the browser can decode it) is drawn onto a canvas at 2048 px on its long edge and re-encoded
 *    as JPEG 0.85, which turns a 6 MB shot into a few hundred KB and loses nothing a model would
 *    have kept. Small screenshots pass through untouched — re-encoding only softens their text.
 *
 * Documents are never compressed (a PDF already is); they are checked and sent as they are.
 */
import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_EDGE_PX,
  IMAGE_PASSTHROUGH_MAX_BYTES,
  IMAGE_SOURCE_MAX_BYTES,
  IMAGE_UPLOAD_MIMES,
  attachmentRejectionText,
  checkAttachmentSize,
  classifyAttachment,
  type AttachmentKind,
  type AttachmentRejection,
} from '@cadence/shared';

/** A file that passed every device-side check and is ready to upload. */
export interface PreparedAttachment {
  kind: AttachmentKind;
  /** The user's own filename — what the coach and the transcript call it. */
  name: string;
  /** The type that goes up (a HEIC becomes image/jpeg here). */
  mime: string;
  blob: Blob;
  /** Object URL for a photo's thumbnail in the tray; revoke it when the chip goes. */
  previewUrl: string | null;
}

export type Described =
  { ok: true; kind: AttachmentKind; mime: string } | { ok: false; reason: AttachmentRejection; text: string };

/**
 * The pure gate. `size` is the file's size as picked — for an image that is the SOURCE size
 * (raw photos may be 20 MB; they get shrunk next), for everything else the final size.
 */
export function describeFile(name: string, mime: string, size: number): Described {
  const c = classifyAttachment(name, mime);
  if (!c) {
    const reason: AttachmentRejection = { reason: 'unsupported_type' };
    return { ok: false, reason, text: attachmentRejectionText(name, reason) };
  }
  const rejection =
    c.kind === 'image'
      ? size > IMAGE_SOURCE_MAX_BYTES
        ? ({ reason: 'too_large', kind: 'image', limitBytes: IMAGE_SOURCE_MAX_BYTES } as const)
        : null
      : checkAttachmentSize(c.kind, size);
  if (rejection) return { ok: false, reason: rejection, text: attachmentRejectionText(name, rejection) };
  return { ok: true, kind: c.kind, mime: c.mime };
}

/** The canvas size for a source, pure: longest edge capped, aspect kept, never below 1 px. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = IMAGE_MAX_EDGE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether an image can skip the canvas: a JPEG/PNG/WebP already small and within the edge cap. */
export function canPassThrough(mime: string, size: number, width: number, height: number): boolean {
  return (
    (IMAGE_UPLOAD_MIMES as readonly string[]).includes(mime) &&
    mime !== 'image/gif' &&
    size <= IMAGE_PASSTHROUGH_MAX_BYTES &&
    Math.max(width, height) <= IMAGE_MAX_EDGE_PX
  );
}

/** The user-facing filename after a re-encode: the extension follows the bytes. */
export function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation (a phone photo taken sideways stays upright) and
  // decodes HEIC where the platform can (Safari); the Image fallback covers the rest.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the Image path */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

/**
 * Shrink a picked image for the wire. Throws `unreadable image` when the browser cannot decode it
 * (a HEIC on Chrome, a corrupt file) — the caller turns that into a chip with words on it.
 */
export async function shrinkImage(file: File, mime: string): Promise<{ blob: Blob; mime: string; name: string }> {
  const source = await decode(file);
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (canPassThrough(mime, file.size, width, height)) return { blob: file, mime, name: file.name };

  const dims = fitWithin(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, dims.width, dims.height);
  if ('close' in source) source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY));
  if (!blob) throw new Error('unreadable image');
  return { blob, mime: 'image/jpeg', name: jpegName(file.name) };
}

/**
 * Everything the composer does to one picked file, in order: classify, shrink if it is an image,
 * check the size that will actually go up. Resolves to the prepared file or the words to show.
 */
export async function prepareAttachment(file: File): Promise<PreparedAttachment | { error: string }> {
  const d = describeFile(file.name, file.type, file.size);
  if (!d.ok) return { error: d.text };
  if (d.kind !== 'image') {
    return { kind: d.kind, name: file.name, mime: d.mime, blob: file, previewUrl: null };
  }
  let shrunk: { blob: Blob; mime: string; name: string };
  try {
    shrunk = await shrinkImage(file, d.mime);
  } catch {
    return { error: `${file.name} could not be read as a photo — a JPEG or a screenshot will work.` };
  }
  const tooBig = checkAttachmentSize('image', shrunk.blob.size);
  if (tooBig) return { error: attachmentRejectionText(file.name, tooBig) };
  return {
    kind: 'image',
    name: shrunk.name,
    mime: shrunk.mime,
    blob: shrunk.blob,
    previewUrl: URL.createObjectURL(shrunk.blob),
  };
}
