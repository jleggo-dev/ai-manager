/**
 * How many pages a PDF has — the cost gate for documents on the chat (100 pages, owner
 * 2026-09-11; `@cadence/shared` DOCUMENT_MAX_PAGES has the derivation).
 *
 * pdf-lib rather than a regex over `/Type /Page`: most PDFs written this decade keep their page
 * objects inside compressed object streams, where a regex counts zero. Encryption is ignored on
 * purpose — a password-protected file still has a page count, and the model (not this step) is
 * the one that will fail to read it, with a better message.
 */
import { PDFDocument } from 'pdf-lib';

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    throw new Error('the PDF could not be read', { cause: e });
  }
  return doc.getPageCount();
}
