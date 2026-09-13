import type { AttachmentKind } from '@cadence/shared';

/**
 * The three-letter glyph on an attachment chip that has no thumbnail. It used to read "PDF" for
 * every document, which was true until Word joined the accepted types (2026-09-13) and then
 * labelled a .docx "PDF". A router that decides what the user sees gets a table test
 * (`attachmentGlyph.test.ts`), so the extension decides and the kind is only the fallback.
 */
export function attachmentGlyph(name: string, kind: AttachmentKind): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (kind === 'document') return ext === 'docx' ? 'DOC' : 'PDF';
  if (kind === 'text') return ext === 'csv' ? 'CSV' : ext === 'md' || ext === 'markdown' ? 'MD' : 'TXT';
  return '…';
}
