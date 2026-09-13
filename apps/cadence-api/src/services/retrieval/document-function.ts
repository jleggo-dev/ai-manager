/**
 * `read_document` — reach back to a file attached to the chat (owner, 2026-09-13: "as a user, I
 * kind of expect that the AI will have continued access to a file I upload").
 *
 * A document rides the turn it was attached to as a provider file part; on every later turn the
 * conversation carries only the note coach-attach-turn.ts wrote, which names the file and its
 * `doc_ref`. This is the door back: the ref → our own Storage copy (kept for as long as the
 * account is — never the provider's file id, which we do not rely on outliving the turn) → the
 * words, page by page, bounded. She calls it when they ask about something in a file that is
 * not in front of her; the note tells her the ref, the same way `photo_ref` tells her which photo
 * `read_label` should read.
 *
 * Only their own refs: the same `ownsAttachment` rule the upload route and the turn apply, so a
 * ref shaped like someone else's path never reaches Storage. A scanned PDF (no text layer) is
 * reported as such — "no words on these pages" is a different fact from "nothing on file".
 */
import { DOCUMENT_MAX_BYTES } from '@cadence/shared';
import {
  COACH_ATTACHMENT_REF_PREFIX,
  downloadAttachment,
  ownsAttachment,
  statAttachment,
} from '../coach-attachments.ts';
import { canExtractText, extractDocumentText } from '../document-text.ts';
import { boundToolResponse, toolEmptyText, toolFaultText } from '../tool-response.ts';
import type { RetrievalFunction } from './types.ts';

interface DocumentRead {
  ref: string;
  name: string;
  totalPages: number;
  fromPage: number;
  pages: string[];
  /** The file is there but has no text layer (a scan, an image-only PDF). */
  noText: boolean;
}

/** `null` from run(): nothing at that ref (the upload never finished, or it was purged). */
type RunResult = DocumentRead | { missing: true } | null;

export const READ_DOCUMENT: RetrievalFunction = {
  name: 'read_document',
  description:
    'Reads back a document or text file they attached to the chat — on this turn or any earlier one — and returns its words page by page. Use it when they ask about something in a file they sent that is not in front of you. Pass {"doc_ref": "coach-attachments/..."} from the attachment note; add {"from_page": 3} to continue past a cut (default 1). A photo is read_label, not this. It only reads; nothing is changed.',
  domains: ['files', 'documents'],

  async run(userId, params) {
    const raw = typeof params?.doc_ref === 'string' ? params.doc_ref.trim() : '';
    if (!raw) return null;
    const path = raw.startsWith(COACH_ATTACHMENT_REF_PREFIX) ? raw.slice(COACH_ATTACHMENT_REF_PREFIX.length) : raw;
    if (!ownsAttachment(userId, path)) throw new Error(`read_document: not an attachment of this user (${raw})`);
    const fromPage = Math.max(1, Math.trunc(Number(params?.from_page ?? 1)) || 1);

    const stat = await statAttachment(path);
    if (!stat) return { missing: true } satisfies RunResult;
    if (!canExtractText(stat.contentType)) {
      throw new Error(`read_document: no text reader for ${stat.contentType || 'this type'}`);
    }
    const bytes = await downloadAttachment(path, DOCUMENT_MAX_BYTES);
    const { pages } = await extractDocumentText(bytes, stat.contentType);
    const name = path.split('/').pop() ?? path;
    return {
      ref: raw,
      name,
      totalPages: pages.length,
      fromPage,
      pages: pages.slice(fromPage - 1),
      noText: pages.every((p) => p.length === 0),
    } satisfies RunResult;
  },

  render(result) {
    // `undefined` = run() threw (not their ref, storage error, unreadable type) → a fault, never
    // an empty result. `null` = no doc_ref given → usage.
    if (result === undefined) return toolFaultText('That document');
    if (result === null) {
      return 'read_document: pass {"doc_ref": "coach-attachments/..."} — the ref from the attachment note. There is nothing to read without it.';
    }
    const r = result as Exclude<RunResult, null>;
    if ('missing' in r) return toolEmptyText('that document — nothing is stored at that ref any more');
    if (r.noText) {
      return (
        `"${r.name}" is there (${r.totalPages} page${r.totalPages === 1 ? '' : 's'}) but has no text layer — a scan or an ` +
        'image-only PDF. Nothing here can read it; ask them for the text, or for a photo of the page to read_label.'
      );
    }
    if (r.fromPage > r.totalPages) {
      return `"${r.name}" has ${r.totalPages} page${r.totalPages === 1 ? '' : 's'}; there is no page ${r.fromPage}.`;
    }
    const body = r.pages
      .map((p, i) => `--- page ${r.fromPage + i} of ${r.totalPages} ---\n${p || '(no text on this page)'}`)
      .join('\n');
    return boundToolResponse(`"${r.name}":\n${body}`);
  },

  rows(result) {
    if (!result || typeof result !== 'object' || 'missing' in (result as object)) return 0;
    return (result as DocumentRead).pages.filter((p) => p.length > 0).length;
  },
};
