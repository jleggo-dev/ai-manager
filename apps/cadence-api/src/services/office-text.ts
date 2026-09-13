import { inflateRawSync } from 'node:zlib';

/**
 * The words in a Word document, for `read_document` (owner, 2026-09-13: Word joins the accepted
 * types — Devs.ai reads a .docx on the turn it rides; this is how she reads it AGAIN later, from
 * our own Storage copy).
 *
 * A .docx is a zip; the body is `word/document.xml`; a paragraph is `<w:p>`, its text the `<w:t>`
 * runs inside it. That is all this reads — no styles, no tables beyond their cell text (cells are
 * paragraphs too), no images. Written by hand rather than pulling a library for one file: the zip
 * walk is the local-file-header chain (deflate or stored), which is what every Office writer
 * produces, and the XML is a regex over two tags. Anything else throws, and the tool reports it
 * as a fault rather than "nothing in the file".
 */
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  packed: Buffer;
}

/** Walk the local-file-header chain. Enough for an Office package; a data-descriptor entry
 *  (sizes after the data) is resolved through the central directory. */
function zipEntries(zip: Buffer): ZipEntry[] {
  // Sizes from the central directory first: writers that stream (flag bit 3) leave the local
  // header's sizes at zero and the truth lives only here.
  const central = new Map<string, { method: number; packed: number; offset: number }>();
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd >= 0) {
    let at = zip.readUInt32LE(eocd + 16);
    const count = zip.readUInt16LE(eocd + 10);
    for (let i = 0; i < count && at + 46 <= zip.length && zip.readUInt32LE(at) === CENTRAL_HEADER; i += 1) {
      const nameLen = zip.readUInt16LE(at + 28);
      const extraLen = zip.readUInt16LE(at + 30);
      const commentLen = zip.readUInt16LE(at + 32);
      const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
      central.set(name, {
        method: zip.readUInt16LE(at + 10),
        packed: zip.readUInt32LE(at + 20),
        offset: zip.readUInt32LE(at + 42),
      });
      at += 46 + nameLen + extraLen + commentLen;
    }
  }
  const out: ZipEntry[] = [];
  for (const [name, c] of central) {
    const at = c.offset;
    if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL_HEADER) continue;
    const nameLen = zip.readUInt16LE(at + 26);
    const extraLen = zip.readUInt16LE(at + 28);
    const start = at + 30 + nameLen + extraLen;
    out.push({ name, method: c.method, packed: zip.subarray(start, start + c.packed) });
  }
  return out;
}

function unzipEntry(zip: Buffer, name: string): Buffer | null {
  const entry = zipEntries(zip).find((e) => e.name === name);
  if (!entry) return null;
  if (entry.method === 0) return Buffer.from(entry.packed);
  if (entry.method === 8) return inflateRawSync(entry.packed);
  throw new Error(`docx: unsupported zip method ${entry.method} for ${name}`);
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Paragraph text, one string per `<w:p>` that holds any words. Tabs and breaks become spaces
 *  and newlines so a table row or an address block still reads as one. */
export function docxParagraphs(bytes: Buffer): string[] {
  const xml = unzipEntry(bytes, 'word/document.xml');
  if (!xml) throw new Error('docx: no word/document.xml — not a Word document');
  const body = xml.toString('utf8');
  const paragraphs: string[] = [];
  for (const p of body.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    // A tab or a line break is a run of its own once it is text — spliced in as one so the
    // `<w:t>` walk below picks it up in order with the words around it.
    const inner = p[1]!.replace(/<w:tab\b[^>]*\/>/g, '<w:t> </w:t>').replace(/<w:br\b[^>]*\/>/g, '<w:t>\n</w:t>');
    const runs = [...inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((r) => decodeXml(r[1]!));
    const text = runs.join('').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}
