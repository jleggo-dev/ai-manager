import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { countPdfPages } from './pdf-pages.ts';

/** The page gate reads REAL PDFs (pdf-lib both writes and reads them here), so an object-stream
 *  PDF, the shape a regex counter gets wrong, is what these are. */
async function pdfWithPages(n: number, objectStreams = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]);
  return doc.save({ useObjectStreams: objectStreams });
}

describe('countPdfPages', () => {
  it('counts pages in object-stream and classic PDFs alike', async () => {
    expect(await countPdfPages(await pdfWithPages(3))).toBe(3);
    expect(await countPdfPages(await pdfWithPages(3, false))).toBe(3);
    expect(await countPdfPages(await pdfWithPages(101))).toBe(101);
  });

  it('names an unreadable file as such rather than leaking a parser stack', async () => {
    await expect(countPdfPages(new TextEncoder().encode('not a pdf'))).rejects.toThrow(/could not be read/);
  });
});
