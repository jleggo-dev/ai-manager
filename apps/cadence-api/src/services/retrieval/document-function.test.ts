/**
 * `read_document` (owner, 2026-09-13): the door back to a file attached on an earlier turn. What
 * must hold: only the user's own refs reach Storage; a missing file and a scan with no text layer
 * read as different facts from each other and from a fault; pages come back numbered and bounded;
 * `from_page` continues past a cut; and a bare call is usage, not an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const statAttachment = vi.fn();
const downloadAttachment = vi.fn();
const extractDocumentText = vi.fn();

vi.mock('../coach-attachments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../coach-attachments.ts')>()),
  statAttachment: (...a: unknown[]) => statAttachment(...a),
  downloadAttachment: (...a: unknown[]) => downloadAttachment(...a),
}));
vi.mock('../document-text.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../document-text.ts')>()),
  extractDocumentText: (...a: unknown[]) => extractDocumentText(...a),
}));

const { READ_DOCUMENT } = await import('./document-function.ts');

const uid = '11111111-1111-4111-8111-111111111111';
const path = `${uid}/2026-09-13/00000000-0000-4000-8000-000000000000.pdf`;
const ref = `coach-attachments/${path}`;

beforeEach(() => {
  vi.clearAllMocks();
  statAttachment.mockResolvedValue({ size: 1234, contentType: 'application/pdf' });
  downloadAttachment.mockResolvedValue(Buffer.from('%PDF'));
  extractDocumentText.mockResolvedValue({ pages: ['Week one: easy runs.', 'Week two: add hills.'] });
});

describe('read_document — run', () => {
  it('reads the user’s own ref back, page by page, through our Storage copy', async () => {
    const r = (await READ_DOCUMENT.run(uid, { doc_ref: ref })) as { pages: string[]; totalPages: number };
    expect(statAttachment).toHaveBeenCalledWith(path);
    expect(downloadAttachment).toHaveBeenCalledWith(path, expect.any(Number));
    expect(r.totalPages).toBe(2);
    expect(r.pages).toEqual(['Week one: easy runs.', 'Week two: add hills.']);
  });

  it('accepts the bare path as well as the bucket-prefixed ref', async () => {
    const r = (await READ_DOCUMENT.run(uid, { doc_ref: path })) as { totalPages: number };
    expect(r.totalPages).toBe(2);
  });

  it('refuses a ref that is not this user’s before Storage is asked', async () => {
    const theirs = `coach-attachments/22222222-2222-4222-8222-222222222222/2026-09-13/00000000-0000-4000-8000-000000000000.pdf`;
    await expect(READ_DOCUMENT.run(uid, { doc_ref: theirs })).rejects.toThrow(/not an attachment of this user/);
    expect(statAttachment).not.toHaveBeenCalled();
  });

  it('a bare call returns null (usage), never a fault', async () => {
    expect(await READ_DOCUMENT.run(uid, {})).toBeNull();
    expect(await READ_DOCUMENT.run(uid, { doc_ref: '   ' })).toBeNull();
  });

  it('nothing at the ref any more is "missing", not a fault', async () => {
    statAttachment.mockResolvedValue(null);
    expect(await READ_DOCUMENT.run(uid, { doc_ref: ref })).toEqual({ missing: true });
  });

  it('a type with no reader is a fault (an image, an Office file for now)', async () => {
    statAttachment.mockResolvedValue({ size: 10, contentType: 'image/png' });
    await expect(READ_DOCUMENT.run(uid, { doc_ref: ref })).rejects.toThrow(/no text reader/);
  });

  it('from_page skips ahead and is clamped to 1', async () => {
    const r = (await READ_DOCUMENT.run(uid, { doc_ref: ref, from_page: 2 })) as { pages: string[]; fromPage: number };
    expect(r.fromPage).toBe(2);
    expect(r.pages).toEqual(['Week two: add hills.']);
    const r0 = (await READ_DOCUMENT.run(uid, { doc_ref: ref, from_page: -3 })) as { fromPage: number };
    expect(r0.fromPage).toBe(1);
  });
});

describe('read_document — render', () => {
  it('numbers the pages and names the file', async () => {
    const out = READ_DOCUMENT.render(await READ_DOCUMENT.run(uid, { doc_ref: ref }));
    expect(out).toContain('--- page 1 of 2 ---');
    expect(out).toContain('Week one: easy runs.');
    expect(out).toContain('--- page 2 of 2 ---');
  });

  it('a scan with no text layer says so, and does not read as an empty file', async () => {
    extractDocumentText.mockResolvedValue({ pages: ['', ''] });
    const out = READ_DOCUMENT.render(await READ_DOCUMENT.run(uid, { doc_ref: ref }));
    expect(out).toMatch(/no text layer/);
    expect(out).toContain('read_label');
  });

  it('a page past the end is named as such', async () => {
    const out = READ_DOCUMENT.render(await READ_DOCUMENT.run(uid, { doc_ref: ref, from_page: 5 }));
    expect(out).toContain('there is no page 5');
  });

  it('missing, usage and fault are three different texts', async () => {
    const missing = READ_DOCUMENT.render({ missing: true });
    const usage = READ_DOCUMENT.render(null);
    const fault = READ_DOCUMENT.render(undefined);
    expect(usage).toContain('doc_ref');
    expect(new Set([missing, usage, fault]).size).toBe(3);
  });

  it('a long document is cut on a line and says so', async () => {
    extractDocumentText.mockResolvedValue({ pages: Array.from({ length: 40 }, (_, i) => `page ${i + 1} `.repeat(60)) });
    const out = READ_DOCUMENT.render(await READ_DOCUMENT.run(uid, { doc_ref: ref }));
    expect(out.length).toBeLessThan(9_000);
    expect(out).not.toContain('--- page 40 of 40 ---');
  });
});

describe('read_document — rows', () => {
  it('counts pages with words, and nothing for a miss', async () => {
    expect(READ_DOCUMENT.rows(await READ_DOCUMENT.run(uid, { doc_ref: ref }))).toBe(2);
    expect(READ_DOCUMENT.rows({ missing: true })).toBe(0);
    expect(READ_DOCUMENT.rows(null)).toBe(0);
  });
});
