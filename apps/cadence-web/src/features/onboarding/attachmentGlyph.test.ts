import { describe, it, expect } from 'vitest';
import { attachmentGlyph } from './attachmentGlyph.ts';

/** Positives and near-misses: a Word file must never wear "PDF" again, and an image chip has a
 *  thumbnail so its glyph is the placeholder. */
describe('attachmentGlyph', () => {
  it.each([
    ['bloodwork.pdf', 'document', 'PDF'],
    ['physio.docx', 'document', 'DOC'],
    ['PHYSIO.DOCX', 'document', 'DOC'],
    ['notes.txt', 'text', 'TXT'],
    ['log.csv', 'text', 'CSV'],
    ['plan.md', 'text', 'MD'],
    ['plan.markdown', 'text', 'MD'],
    ['no-extension', 'text', 'TXT'],
    ['photo.jpg', 'image', '…'],
  ] as const)('%s (%s) → %s', (name, kind, want) => {
    expect(attachmentGlyph(name, kind)).toBe(want);
  });
});
