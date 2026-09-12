/**
 * The turn's attach step (owner, 2026-09-11). What is pinned: a photo becomes a signed URL and a
 * `photo_ref` she can hand to read_label; a PDF becomes a provider file id ONLY after the page
 * gate; a text file becomes prose; and every failure — a ref that is not the user's, a PDF past
 * 100 pages, a provider that refuses the upload — is one line in the note and never a thrown
 * turn. The note itself goes through injectCoachContext exactly once per message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttachmentRef } from '@cadence/shared';

const injectCoachContext = vi.fn(async (..._a: unknown[]) => {});
const uploadCoachFile = vi.fn();
vi.mock('../ai/aim.ts', () => ({
  injectCoachContext: (...a: unknown[]) => injectCoachContext(...a),
  uploadCoachFile: (...a: unknown[]) => uploadCoachFile(...a),
}));

const statAttachment = vi.fn();
const signAttachmentUrl = vi.fn();
const downloadAttachment = vi.fn();
vi.mock('./coach-attachments.ts', async (importActual) => {
  const actual = await importActual<typeof import('./coach-attachments.ts')>();
  return {
    ...actual,
    statAttachment: (...a: unknown[]) => statAttachment(...a),
    signAttachmentUrl: (...a: unknown[]) => signAttachmentUrl(...a),
    downloadAttachment: (...a: unknown[]) => downloadAttachment(...a),
  };
});
const countPdfPages = vi.fn();
vi.mock('./pdf-pages.ts', () => ({ countPdfPages: (...a: unknown[]) => countPdfPages(...a) }));
vi.mock('./meal-photos.ts', () => ({ putMealPhoto: vi.fn(), signMealPhotoUrl: vi.fn() }));

const { attachToTurn } = await import('./coach-attach-turn.ts');

const uid = '11111111-1111-4111-8111-111111111111';
const ref = (ext: string) => `${uid}/2026-09-11/00000000-0000-4000-8000-000000000000.${ext}`;
const att = (kind: AttachmentRef['kind'], ext: string, name: string, mime: string): AttachmentRef => ({
  ref: ref(ext),
  kind,
  name,
  mime,
  size: 100,
});

const noteText = (): string => String(injectCoachContext.mock.calls[0]?.[2] ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  signAttachmentUrl.mockResolvedValue('https://signed/photo');
  uploadCoachFile.mockResolvedValue({ fileId: 'file_9' });
});

describe('attachToTurn', () => {
  it('is a no-op for a bare message: nothing injected, nothing attached', async () => {
    expect(await attachToTurn(uid, 's1', { photo: null, attachments: [] })).toEqual({ images: [], files: [] });
    expect(injectCoachContext).not.toHaveBeenCalled();
  });

  it('a photo rides as a signed URL and the note carries a bucket-prefixed photo_ref for read_label', async () => {
    statAttachment.mockResolvedValue({ size: 500_000, contentType: 'image/jpeg' });
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('image', 'jpg', 'plate.jpg', 'image/jpeg')],
    });
    expect(out).toEqual({ images: ['https://signed/photo'], files: [] });
    expect(injectCoachContext).toHaveBeenCalledTimes(1);
    expect(noteText()).toContain(`photo_ref: "coach-attachments/${ref('jpg')}"`);
    expect(noteText()).toContain('read_label');
    expect(injectCoachContext.mock.calls[0]?.[3]).toMatchObject({ source: 'attachments' });
  });

  it('a PDF is page-gated, then uploaded to the provider and referenced by id', async () => {
    statAttachment.mockResolvedValue({ size: 3_000_000, contentType: 'application/pdf' });
    downloadAttachment.mockResolvedValue(Buffer.from('%PDF'));
    countPdfPages.mockResolvedValue(12);
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('document', 'pdf', 'labs.pdf', 'application/pdf')],
    });
    expect(out.files).toEqual([{ filename: 'labs.pdf', mimeType: 'application/pdf', fileId: 'file_9' }]);
    expect(uploadCoachFile).toHaveBeenCalledWith(uid, 's1', {
      buffer: Buffer.from('%PDF'),
      filename: 'labs.pdf',
      mimeType: 'application/pdf',
    });
    expect(noteText()).toContain('"labs.pdf" (12 pages)');
  });

  it('a PDF past 100 pages never reaches the provider, and she is told why', async () => {
    statAttachment.mockResolvedValue({ size: 3_000_000, contentType: 'application/pdf' });
    downloadAttachment.mockResolvedValue(Buffer.from('%PDF'));
    countPdfPages.mockResolvedValue(240);
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('document', 'pdf', 'scan.pdf', 'application/pdf')],
    });
    expect(out).toEqual({ images: [], files: [] });
    expect(uploadCoachFile).not.toHaveBeenCalled();
    expect(noteText()).toContain('"scan.pdf" did not come through');
    expect(noteText()).toContain('runs past 100 pages');
    expect(injectCoachContext.mock.calls[0]?.[3]).toMatchObject({ source: 'attachments-failed' });
  });

  it('a text file is decoded and spliced as prose', async () => {
    statAttachment.mockResolvedValue({ size: 12, contentType: 'text/csv' });
    downloadAttachment.mockResolvedValue(Buffer.from('a,b\n1,2'));
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('text', 'csv', 'log.csv', 'text/csv')],
    });
    expect(out.files).toEqual([{ filename: 'log.csv', mimeType: 'text/csv', text: 'a,b\n1,2' }]);
    expect(uploadCoachFile).not.toHaveBeenCalled();
  });

  it('a ref that is not this user’s, or never finished uploading, fails alone — the rest still ride', async () => {
    statAttachment.mockImplementation(async (r: string) =>
      r.endsWith('.png') ? { size: 10, contentType: 'image/png' } : null,
    );
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [
        {
          ...att('image', 'jpg', 'theirs.jpg', 'image/jpeg'),
          ref: '22222222-2222-4222-8222-222222222222/2026-09-11/00000000-0000-4000-8000-000000000000.jpg',
        },
        att('image', 'gif', 'ghost.gif', 'image/gif'),
        att('image', 'png', 'ok.png', 'image/png'),
      ],
    });
    expect(out.images).toEqual(['https://signed/photo']);
    expect(statAttachment).toHaveBeenCalledTimes(2); // the foreign ref never reached Storage
    expect(noteText()).toContain('"theirs.jpg" did not come through: the upload reference was not valid.');
    expect(noteText()).toContain('"ghost.gif" did not come through: the upload never finished.');
    expect(noteText()).toContain('"ok.png" is attached');
  });

  it('a kind the client claimed that Storage contradicts is refused as unsupported', async () => {
    statAttachment.mockResolvedValue({ size: 10, contentType: 'application/pdf' });
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('image', 'jpg', 'fake.jpg', 'image/jpeg')],
    });
    expect(out.images).toEqual([]);
    expect(noteText()).toContain("I can't read fake.jpg");
  });

  it('a provider that refuses the upload becomes a plain-words line, and the turn continues', async () => {
    statAttachment.mockResolvedValue({ size: 3_000_000, contentType: 'application/pdf' });
    downloadAttachment.mockResolvedValue(Buffer.from('%PDF'));
    countPdfPages.mockResolvedValue(4);
    uploadCoachFile.mockRejectedValue(new Error('Devs.ai takes files up to about 4.5 MB on this path'));
    const out = await attachToTurn(uid, 's1', {
      photo: null,
      attachments: [att('document', 'pdf', 'big.pdf', 'application/pdf')],
    });
    expect(out.files).toEqual([]);
    expect(noteText()).toContain('larger than I can take as a document right now');
  });
});
