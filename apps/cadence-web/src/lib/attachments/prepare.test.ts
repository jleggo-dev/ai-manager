/**
 * The device-side gate (owner, 2026-09-11). `describeFile` is a router — which pipeline a picked
 * file enters — and a wrong branch fails silently (a PDF sent as text is garbage the coach reads
 * politely), so it gets positives AND near-misses; `fitWithin` / `canPassThrough` are the
 * arithmetic behind the compression the owner asked for.
 */
import { describe, it, expect } from 'vitest';
import { IMAGE_MAX_EDGE_PX, IMAGE_PASSTHROUGH_MAX_BYTES, IMAGE_SOURCE_MAX_BYTES } from '@cadence/shared';
import { canPassThrough, describeFile, fitWithin, jpegName } from './prepare.ts';

describe('describeFile', () => {
  it.each([
    ['IMG_0001.HEIC', '', 8_000_000, 'image', 'image/heic'],
    ['photo.jpg', 'image/jpeg', 19 * 1024 * 1024, 'image', 'image/jpeg'],
    ['bloodwork.pdf', 'application/pdf', 3 * 1024 * 1024, 'document', 'application/pdf'],
    ['notes.md', '', 2000, 'text', 'text/markdown'],
    ['export.csv', 'application/octet-stream', 500_000, 'text', 'text/csv'],
  ])('%s goes (%s, %d bytes)', (name, mime, size, kind, norm) => {
    expect(describeFile(name, mime, size)).toEqual({ ok: true, kind, mime: norm });
  });

  it('a raw photo over the 20 MB source cap is refused before any decoding', () => {
    const d = describeFile('huge.jpg', 'image/jpeg', IMAGE_SOURCE_MAX_BYTES + 1);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.text).toContain('huge.jpg');
  });

  it('documents and text are gated at their own caps, in the shared words', () => {
    const pdf = describeFile('scan.pdf', 'application/pdf', 5 * 1024 * 1024);
    expect(pdf.ok).toBe(false);
    if (!pdf.ok) expect(pdf.text).toMatch(/over 4 MB/);
    const txt = describeFile('dump.txt', 'text/plain', 2 * 1024 * 1024);
    expect(txt.ok).toBe(false);
    if (!txt.ok) expect(txt.text).toMatch(/over 1 MB/);
  });

  it.each([
    ['clip.mov', 'video/quicktime'],
    ['memo.m4a', 'audio/mp4'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['icon.svg', 'image/svg+xml'],
  ])('%s is refused with the list of what works', (name, mime) => {
    const d = describeFile(name, mime, 10);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.text).toMatch(/photos, PDFs, and plain text/);
  });
});

describe('the shrink arithmetic', () => {
  it('fitWithin caps the long edge at 2048 and keeps the aspect', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
    expect(IMAGE_MAX_EDGE_PX).toBe(2048);
  });

  it('a small JPEG/PNG/WebP within the edge cap passes through untouched; a GIF or a big one does not', () => {
    expect(canPassThrough('image/png', 400_000, 1920, 1080)).toBe(true);
    expect(canPassThrough('image/jpeg', IMAGE_PASSTHROUGH_MAX_BYTES + 1, 1000, 1000)).toBe(false);
    expect(canPassThrough('image/jpeg', 100, 4032, 3024)).toBe(false);
    expect(canPassThrough('image/gif', 100, 100, 100)).toBe(false);
    expect(canPassThrough('image/heic', 100, 100, 100)).toBe(false);
  });

  it('a re-encoded photo is named for its bytes', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegName('plate')).toBe('plate.jpg');
  });
});
