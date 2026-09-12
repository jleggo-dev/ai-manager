/**
 * The attachment router — what a picked file IS — decides which pipeline it enters, and a wrong
 * answer fails silently: a PDF classified as text gets inlined as garbage, a HEIC classified as
 * unsupported never reaches the converter. So it gets the table treatment (CLAUDE.md: positives
 * AND near-misses), and the limits are pinned to the numbers the owner set on 2026-09-11.
 */
import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_PAGES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE_PX,
  MAX_ATTACHMENTS_PER_MESSAGE,
  TEXT_MAX_BYTES,
  attachmentRejectionText,
  checkAttachmentSize,
  classifyAttachment,
  humanBytes,
} from './attachments.ts';

describe('classifyAttachment', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'image', 'image/jpeg'],
    ['IMG_0123.HEIC', 'image/heic', 'image', 'image/heic'],
    ['IMG_0123.HEIC', '', 'image', 'image/heic'],
    ['shot.png', 'image/png', 'image', 'image/png'],
    ['anim.gif', 'image/gif', 'image', 'image/gif'],
    ['bloodwork.pdf', 'application/pdf', 'document', 'application/pdf'],
    ['bloodwork.pdf', '', 'document', 'application/pdf'],
    ['bloodwork.pdf', 'application/octet-stream', 'document', 'application/pdf'],
    ['notes.txt', 'text/plain', 'text', 'text/plain'],
    ['plan.md', '', 'text', 'text/markdown'],
    ['plan.md', 'text/x-markdown', 'text', 'text/markdown'],
    ['export.csv', 'application/octet-stream', 'text', 'text/csv'],
    ['export.csv', 'text/csv; charset=utf-8', 'text', 'text/csv'],
  ])('%s (%s) → %s', (name, mime, kind, normalized) => {
    expect(classifyAttachment(name, mime)).toEqual({ kind, mime: normalized });
  });

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['voice.m4a', 'audio/mp4'],
    ['archive.zip', 'application/zip'],
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['logo.svg', 'image/svg+xml'],
    ['noext', ''],
    ['noext', 'application/octet-stream'],
    // A known extension with a KNOWN, different type: the bytes win, and they are not ours.
    ['notes.txt', 'application/pdf-x'],
    ['photo.jpg', 'video/mp4'],
  ])('rejects %s (%s)', (name, mime) => {
    expect(classifyAttachment(name, mime)).toBeNull();
  });
});

describe('the limits the owner set (2026-09-11)', () => {
  it('images: 4 MB after shrinking, 2048 px long edge', () => {
    expect(IMAGE_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(IMAGE_MAX_EDGE_PX).toBe(2048);
  });
  it('documents: 20 MB and 100 pages; text: 1 MB; four per message', () => {
    expect(DOCUMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(DOCUMENT_MAX_PAGES).toBe(100);
    expect(TEXT_MAX_BYTES).toBe(1024 * 1024);
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(4);
  });
  it('checkAttachmentSize is inclusive at the limit and rejects one byte over', () => {
    expect(checkAttachmentSize('image', IMAGE_MAX_BYTES)).toBeNull();
    expect(checkAttachmentSize('image', IMAGE_MAX_BYTES + 1)).toEqual({
      reason: 'too_large',
      kind: 'image',
      limitBytes: IMAGE_MAX_BYTES,
    });
    expect(checkAttachmentSize('document', DOCUMENT_MAX_BYTES + 1)?.reason).toBe('too_large');
    expect(checkAttachmentSize('text', TEXT_MAX_BYTES + 1)?.reason).toBe('too_large');
  });
  it('the picker accepts both MIME types and extensions (Safari vs Android)', () => {
    expect(ATTACHMENT_ACCEPT).toContain('image/heic');
    expect(ATTACHMENT_ACCEPT).toContain('.heic');
    expect(ATTACHMENT_ACCEPT).toContain('application/pdf');
    expect(ATTACHMENT_ACCEPT).toContain('.csv');
    expect(ATTACHMENT_ACCEPT).not.toContain('video');
  });
});

describe('the words', () => {
  it('humanBytes speaks in MB and KB, no decimals on whole numbers', () => {
    expect(humanBytes(4 * 1024 * 1024)).toBe('4 MB');
    expect(humanBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(humanBytes(512 * 1024)).toBe('512 KB');
    expect(humanBytes(10)).toBe('1 KB');
  });
  it('names the file and the limit, and never says "captured" or an abbreviation to decode', () => {
    const t = attachmentRejectionText('scan.pdf', { reason: 'too_many_pages', limitPages: 100 });
    expect(t).toContain('scan.pdf');
    expect(t).toContain('100 pages');
    const big = attachmentRejectionText('IMG_1.jpg', {
      reason: 'too_large',
      kind: 'image',
      limitBytes: IMAGE_MAX_BYTES,
    });
    expect(big).toContain('4 MB');
    expect(big).toContain('shrinking');
    expect(attachmentRejectionText('x.zip', { reason: 'unsupported_type' })).toContain('.csv');
    expect(attachmentRejectionText('x', { reason: 'too_many', limit: 4 })).toContain('4 files');
  });
});
