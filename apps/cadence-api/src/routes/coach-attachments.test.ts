/**
 * POST /coach/attachments — the trust boundary for what a file IS and how big it may be
 * (owner, 2026-09-11). The composer checks the same things first, but the composer is not the
 * server; these pin that the route refuses on its own, in the same words, and that a ref it
 * mints is one `ownsAttachment` will later accept for THIS user and no other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { IMAGE_MAX_BYTES } from '@cadence/shared';

const signCoachUpload = vi.fn();
vi.mock('../services/coach-attachments.ts', async (importActual) => {
  const actual = await importActual<typeof import('../services/coach-attachments.ts')>();
  return { ...actual, signCoachUpload: (...a: unknown[]) => signCoachUpload(...a) };
});
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: routes } = await import('./coach-attachments.ts');
const { newAttachmentPath, ownsAttachment } = await import('../services/coach-attachments.ts');

const app = express();
app.use(express.json());
app.use('/coach', routes);

async function post(body: unknown) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/coach/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  signCoachUpload.mockResolvedValue({ ref: 'u1/2026-09-11/00000000-0000-4000-8000-000000000000.jpg', token: 'tok' });
});

describe('POST /coach/attachments', () => {
  it('mints an upload for a photo, naming the bucket and the normalized kind', async () => {
    const r = await post({ name: 'IMG_1.HEIC', mime: '', size: 900_000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token: 'tok', bucket: 'coach-attachments', kind: 'image', mime: 'image/heic' });
    expect(signCoachUpload).toHaveBeenCalledWith('u1', 'image/heic');
  });

  it('refuses a type it cannot read, in the composer’s own words', async () => {
    const r = await post({ name: 'clip.mp4', mime: 'video/mp4', size: 10 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/can't read clip\.mp4/);
    expect(signCoachUpload).not.toHaveBeenCalled();
  });

  it('refuses an image still over 4 MB after shrinking, and a 5 MB PDF (the Devs.ai ceiling)', async () => {
    const img = await post({ name: 'big.jpg', mime: 'image/jpeg', size: IMAGE_MAX_BYTES + 1 });
    expect(img.status).toBe(400);
    expect(String(img.body.error)).toMatch(/still over 4 MB after shrinking/);
    const pdf = await post({ name: 'scan.pdf', mime: 'application/pdf', size: 5 * 1024 * 1024 });
    expect(pdf.status).toBe(400);
    expect(String(pdf.body.error)).toMatch(/over 4 MB/);
  });

  it('400s a body with no name or size, before any Storage call', async () => {
    expect((await post({ mime: 'image/jpeg', size: 1 })).status).toBe(400);
    expect((await post({ name: 'a.pdf' })).status).toBe(400);
    expect(signCoachUpload).not.toHaveBeenCalled();
  });
});

/** The ref grammar: minted paths pass for their owner; anything else — another user's prefix,
 *  a traversal, a bare uuid, an unknown extension — is refused before Storage is asked. */
describe('ownsAttachment', () => {
  const uid = '11111111-1111-4111-8111-111111111111';
  it('accepts every path newAttachmentPath mints for the same user', () => {
    for (const mime of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain',
      'text/csv',
    ]) {
      expect(ownsAttachment(uid, newAttachmentPath(uid, mime))).toBe(true);
    }
  });
  it.each([
    ['another user', '22222222-2222-4222-8222-222222222222/2026-09-11/00000000-0000-4000-8000-000000000000.jpg'],
    ['traversal', `${uid}/../${uid}/2026-09-11/00000000-0000-4000-8000-000000000000.jpg`],
    ['no date segment', `${uid}/00000000-0000-4000-8000-000000000000.jpg`],
    ['unknown extension', `${uid}/2026-09-11/00000000-0000-4000-8000-000000000000.exe`],
    ['prefix only', `${uid}/`],
    [
      'bucket-prefixed (the coach’s form, not the client’s)',
      `coach-attachments/${uid}/2026-09-11/00000000-0000-4000-8000-000000000000.jpg`,
    ],
  ])('refuses %s', (_label, ref) => {
    expect(ownsAttachment(uid, ref)).toBe(false);
  });
  it('refuses an empty user', () => {
    expect(ownsAttachment('', '/2026-09-11/00000000-0000-4000-8000-000000000000.jpg')).toBe(false);
  });
});
