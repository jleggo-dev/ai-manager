/**
 * LIVE PROBE: what does Devs.ai actually read when a document rides a coach turn by file id?
 *
 * Owner, 2026-09-13: "I think devs accepts/converts microsoft docs already. just test it." And
 * PR #416's own honesty note: the `input_file` shape was pinned to the published spec and never
 * rehearsed against a live provider — the first real PDF turn is the acceptance test. This is
 * that turn, run on purpose, for four files: a PDF (the acceptance), a .docx, an .xlsx and a
 * .pptx (the owner's question). Each file carries one distinctive sentence; the coach is asked
 * to quote it back. A quote means the provider read the file; a refusal at upload, or a reply
 * that cannot see it, means it did not.
 *
 * The SANCTIONED path, in-process: scratch account-1 → openCoachSession → uploadCoachFile (the
 * engine's own upload, POST /api/v1/files on Devs.ai) → sendCoachMessage with a `files` part →
 * the same relay the route uses. Nothing here bypasses AI Admin. The files are built by hand
 * (Office documents are zips of XML; the smallest package Word/Excel/PowerPoint themselves open)
 * so the probe needs no library and no fixture.
 *
 * Run:  npm -w apps/cadence-api run probe:office
 *       ONLY=docx npm -w apps/cadence-api run probe:office
 *       MODE=inline npm -w apps/cadence-api run probe:office     # bytes as file_data, no upload
 *
 * VERDICT (2026-09-13, three runs — upload ×2, inline ×1, gpt-class model behind devs-ai-v2):
 *   pdf   READ      by file id. The acceptance test PR #416 owed.
 *   docx  READ      by file id AND inline — Devs.ai converts Word itself.
 *   xlsx  NOT SEEN  accepted at upload (an id comes back UPLOADED), "I cannot see the file" both ways.
 *   pptx  NOT SEEN  same.
 * So Word joined DOCUMENT_MIMES and the other two did not. The fixture caveat (smallest valid
 * packages, not files Excel wrote) was closed the same day: the owner's own 142 KB Excel export
 * (`FILE=… Cloud_Marketplace_TAM_2020-2025.xlsx`), by file id and inline, "I cannot see the file"
 * both times. Excel is out until the provider reads it.
 *
 * Leaves the scratch account's session behind — `npm run cleanup:test-data` sweeps it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cadenceConfig } from '../src/config.ts';
import { ensureUser } from '../src/repos/users.ts';
import { openCoachSession, sendCoachMessage, uploadCoachFile } from '../src/ai/aim.ts';
import { relayCoachTurnWithTools } from '../src/services/coach-tool-loop.ts';

/* ── a stored-or-deflated zip, by hand (Office packages are zips) ─────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data, 'utf8');
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ── the four files, each carrying one sentence ───────────────────────────────────────────── */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(sentence: string): Buffer {
  return zip([
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${sentence}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ]);
}

function xlsx(sentence: string): Buffer {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip([
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `${XML}<workbook xmlns="${main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `${XML}<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Note</t></is></c><c r="B1" t="inlineStr"><is><t>${sentence}</t></is></c></row></sheetData></worksheet>`,
    },
  ]);
}

function pptx(sentence: string): Buffer {
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relT = (t: string) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`;
  const shapes = (text: string) =>
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    (text
      ? `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
      : '') +
    `</p:spTree></p:cSld>`;
  return zip([
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="ppt/presentation.xml"/></Relationships>`,
    },
    {
      name: 'ppt/presentation.xml',
      data: `${XML}<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${relT('slideMaster')}" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${relT('slide')}" Target="slides/slide1.xml"/></Relationships>`,
    },
    {
      name: 'ppt/slides/slide1.xml',
      data: `${XML}<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}">${shapes(sentence)}</p:sld>`,
    },
    {
      name: 'ppt/slides/_rels/slide1.xml.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${relT('slideLayout')}" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: `${XML}<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" type="blank">${shapes('')}</p:sldLayout>`,
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${relT('slideMaster')}" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: `${XML}<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}">${shapes('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${relT('slideLayout')}" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${relT('theme')}" Target="../theme/theme1.xml"/></Relationships>`,
    },
    {
      name: 'ppt/theme/theme1.xml',
      data:
        `${XML}<a:theme xmlns:a="${a}" name="Plain"><a:themeElements><a:clrScheme name="Plain">` +
        ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
          .map((n) => `<a:${n}><a:srgbClr val="${n.startsWith('lt') ? 'FFFFFF' : '000000'}"/></a:${n}>`)
          .join('') +
        `</a:clrScheme><a:fontScheme name="Plain"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Plain"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
    },
  ]);
}

async function pdf(sentence: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(sentence, { x: 72, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

/* ── the probe ────────────────────────────────────────────────────────────────────────────── */

interface Case {
  key: string;
  filename: string;
  mimeType: string;
  sentence: string;
  /** Words that only the file could have told her — two of them in the reply means she read it. */
  keys: string[];
  build: () => Promise<Buffer> | Buffer;
}

const CASES: Case[] = [
  {
    key: 'pdf',
    filename: 'taper-notes.pdf',
    mimeType: 'application/pdf',
    sentence: 'The taper week keeps the Thursday tempo but drops the Sunday long run to ninety minutes.',
    keys: ['thursday', 'tempo', 'ninety', '90'],
    build: () => pdf('The taper week keeps the Thursday tempo but drops the Sunday long run to ninety minutes.'),
  },
  {
    key: 'docx',
    filename: 'physio-notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sentence: 'The physio cleared hill repeats from the third week of October onward.',
    keys: ['hill', 'october', 'third week'],
    build: () => docx('The physio cleared hill repeats from the third week of October onward.'),
  },
  {
    key: 'xlsx',
    filename: 'weigh-ins.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sentence: 'The scale read eighty two point four on the morning of the twelfth.',
    keys: ['eighty two', '82', 'twelfth', '12th'],
    build: () => xlsx('The scale read eighty two point four on the morning of the twelfth.'),
  },
  {
    key: 'pptx',
    filename: 'race-plan.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sentence: 'The race plan holds five minutes per kilometre until the final climb.',
    keys: ['five minutes', '5 min', 'kilometre', 'climb'],
    build: () => pptx('The race plan holds five minutes per kilometre until the final climb.'),
  },
];

/** Real usage, not a quoting drill: the first run asked for a verbatim quote and her persona
 *  refused on principle while plainly having read the PDF (it named the Thursday tempo and the
 *  ninety-minute run). The verdict is keyword-based for the same reason. */
const ASK =
  'I attached a file for you. In your own words, what does it say? Include the specific days, numbers ' +
  'and names it mentions. If you cannot see the file at all, say exactly: I cannot see the file.';

/** `upload` sends the file by provider id (the production path); `inline` sends the bytes as a
 *  data URL in the message itself (`file_data`) — the other shape the Responses spec allows. */
const MODE = process.env.MODE === 'inline' ? 'inline' : 'upload';

async function drain(userId: string, body: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  const r = await relayCoachTurnWithTools(userId, body, {
    toolNames: new Set(),
    execute: async () => [],
    submit: async () => null,
  });
  return (r.segments.length ? r.segments.join('\n\n') : r.content).trim();
}

/** `FILE=<path>` sends one real file instead of the fixtures — the "a real export is worth one
 *  more run" caveat, answered. The MIME comes from the extension; the ask is open-ended. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};
function realFileCase(file: string): Case {
  const filename = path.basename(file);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new Error(`no MIME for .${ext}`);
  return {
    key: ext,
    filename,
    mimeType,
    sentence: '',
    keys: [],
    build: () => readFileSync(file),
  };
}

const OPEN_ASK =
  'I attached a file. What is it about? Tell me what it contains — the sheets or sections, the ' +
  'names, the years, the numbers. If you cannot see the file at all, say exactly: I cannot see the file.';

async function main() {
  const userId = cadenceConfig.devAccounts['account-1']!;
  const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
  const real = process.env.FILE ? realFileCase(process.env.FILE) : null;
  await ensureUser(userId);
  const session = await openCoachSession(userId);
  console.log(`session ${session.sessionId} on ${session.providerType}\n`);

  console.log(`mode: ${MODE}\n`);
  const rows: Array<{ key: string; upload: string; reply: string; verdict: string }> = [];
  for (const c of real ? [real] : CASES) {
    if (!real && only.length && !only.includes(c.key)) continue;
    const buffer = Buffer.from(await c.build());
    let part: { filename: string; mimeType: string; fileId?: string; data?: string };
    let upload = 'inline';
    if (MODE === 'inline') {
      part = { filename: c.filename, mimeType: c.mimeType, data: buffer.toString('base64') };
    } else {
      try {
        const { fileId } = await uploadCoachFile(userId, session.sessionId, {
          buffer,
          filename: c.filename,
          mimeType: c.mimeType,
        });
        part = { filename: c.filename, mimeType: c.mimeType, fileId };
        upload = fileId;
        console.log(`[${c.key}] uploaded ${buffer.length} bytes → ${fileId}`);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        rows.push({ key: c.key, upload: `REFUSED — ${why.slice(0, 160)}`, reply: '', verdict: 'not accepted at upload' });
        console.log(`[${c.key}] upload refused: ${why}\n`);
        continue;
      }
    }
    try {
      const { response } = await sendCoachMessage(userId, session.sessionId, real ? OPEN_ASK : ASK, undefined, [], [part]);
      const reply = await drain(userId, response.body);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const hits = c.keys.filter((k) => norm(reply).includes(norm(k))).length;
      const cannot = /i cannot see the file/i.test(reply);
      const verdict = cannot ? 'NOT SEEN' : real ? 'SEEN (read the reply)' : hits >= 2 ? 'READ' : `unclear (${hits} keys)`;
      rows.push({ key: c.key, upload, reply: reply.slice(0, 200), verdict });
      console.log(`[${c.key}] reply:\n${real ? reply : reply.slice(0, 320)}\n`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      rows.push({ key: c.key, upload, reply: `TURN FAILED — ${why.slice(0, 160)}`, verdict: 'turn failed' });
      console.log(`[${c.key}] turn failed: ${why}\n`);
    }
  }

  console.log(`\n=== verdicts (${MODE}) ===`);
  for (const r of rows) console.log(`${r.key.padEnd(5)} ${r.verdict.padEnd(20)} upload=${r.upload.slice(0, 60)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
