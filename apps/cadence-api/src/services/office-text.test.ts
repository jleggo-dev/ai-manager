/**
 * The Word reader behind `read_document` (2026-09-13). The fixtures are built here, by hand, the
 * way an Office writer lays a package out — a local-file-header chain plus a central directory —
 * stored and deflated both, since real writers use either. What must hold: paragraphs come back
 * in order with their runs joined, entities decoded, tabs and breaks as spaces and newlines,
 * empty paragraphs dropped; and a zip that is not a Word document is a fault, not an empty file.
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { docxParagraphs } from './office-text.ts';

function zip(entries: Array<{ name: string; data: string }>, deflate: boolean): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.data);
    const packed = deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const doc = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const docx = (body: string, deflate = true) =>
  zip(
    [
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: doc(body) },
    ],
    deflate,
  );

describe('docxParagraphs', () => {
  const BODY =
    '<w:p><w:r><w:t>The physio </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>cleared</w:t></w:r><w:r><w:t xml:space="preserve"> hills.</w:t></w:r></w:p>' +
    '<w:p/>' +
    '<w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>&#x2014; week 3</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell one</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  it('joins the runs of each paragraph, in order, and drops the empty one', () => {
    expect(docxParagraphs(docx(BODY))).toEqual(['The physio cleared hills.', 'Tom & Jerry — week 3', 'cell one']);
  });

  it('reads a stored (uncompressed) package the same way', () => {
    expect(docxParagraphs(docx(BODY, false))).toEqual([
      'The physio cleared hills.',
      'Tom & Jerry — week 3',
      'cell one',
    ]);
  });

  it('a line break inside a paragraph stays a line', () => {
    const out = docxParagraphs(docx('<w:p><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>'));
    expect(out).toEqual(['line one\nline two']);
  });

  it('a zip that is not a Word document is a fault, never an empty document', () => {
    const notWord = zip([{ name: 'xl/workbook.xml', data: '<workbook/>' }], true);
    expect(() => docxParagraphs(notWord)).toThrow(/not a Word document/);
    expect(() => docxParagraphs(Buffer.from('%PDF-1.4'))).toThrow(/not a Word document/);
  });
});
