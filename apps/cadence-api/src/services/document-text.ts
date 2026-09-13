import { DOCX_MIME } from '@cadence/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import { docxParagraphs } from './office-text.ts';

/**
 * The words in a document, page by page — what `read_document` hands the coach when she reaches
 * back for a file attached earlier (owner, 2026-09-13: "as a user, I kind of expect that the AI
 * will have continued access to a file I upload").
 *
 * A PDF's text layer via unpdf (pdf.js without a DOM, built for serverless — cadence-api runs on
 * Vercel functions); a Word document's paragraphs (office-text.ts) as one page, since a .docx
 * has no pages until it is laid out; a text file as it is. A scanned PDF has no text layer and
 * comes back as empty pages, which the tool says plainly rather than reporting "nothing in the
 * file". Excel and PowerPoint are not accepted at all (the provider cannot read them either —
 * the 2026-09-13 probe, scripts/probe-devs-ai-office.ts).
 */
export interface DocumentText {
  /** One entry per page (a text file or a Word document is one page). Empty strings are pages
   *  with no text layer. */
  pages: string[];
}

const PDF_MIME = 'application/pdf';

export function canExtractText(mime: string): boolean {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return m === PDF_MIME || m === DOCX_MIME || m.startsWith('text/');
}

export async function extractDocumentText(bytes: Buffer, mime: string): Promise<DocumentText> {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (m.startsWith('text/')) return { pages: [bytes.toString('utf8')] };
  if (m === DOCX_MIME) return { pages: [docxParagraphs(bytes).join('\n')] };
  if (m !== PDF_MIME) throw new Error(`no text reader for ${m || 'an unknown type'}`);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return { pages: text.map((t) => t.replace(/[ \t]+\n/g, '\n').trim()) };
}
