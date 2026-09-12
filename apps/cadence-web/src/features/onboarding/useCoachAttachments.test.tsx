/**
 * The tray (owner, 2026-09-11). Pinned: a pick starts its upload at once and the chip walks
 * preparing → uploading → ready; a file the gate refuses stays as a chip with the words on it;
 * a fifth file is refused by count; Send takes only what is ready and clears everything; and
 * removing a chip mid-flight means its upload result is dropped, not resurrected.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AttachmentRef } from '@cadence/shared';
import type { PreparedAttachment } from '../../lib/attachments/prepare.ts';
import { useCoachAttachments } from './useCoachAttachments.ts';

const file = (name: string, type = 'image/jpeg') => new File(['x'], name, { type });

function prepared(name: string, kind: PreparedAttachment['kind'] = 'image'): PreparedAttachment {
  return {
    kind,
    name,
    mime: kind === 'image' ? 'image/jpeg' : 'application/pdf',
    blob: new Blob(['x']),
    previewUrl: null,
  };
}
function refFor(p: PreparedAttachment): AttachmentRef {
  return { ref: `u/2026-09-11/${p.name}`, kind: p.kind, name: p.name, mime: p.mime, size: 1 };
}

/** A gate that lets everything through and an upload that resolves when told to. */
function deps(overrides: { prepare?: (f: File) => Promise<PreparedAttachment | { error: string }> } = {}) {
  const resolvers: Array<(r: AttachmentRef) => void> = [];
  const upload = vi.fn(
    (p: PreparedAttachment) =>
      new Promise<AttachmentRef>((resolve) => {
        resolvers.push(() => resolve(refFor(p)));
      }),
  );
  const prepare = vi.fn(overrides.prepare ?? (async (f: File) => prepared(f.name)));
  return { prepare, upload, finish: (i = 0) => resolvers[i]?.(refFor(prepared('')) as never) };
}

describe('useCoachAttachments', () => {
  it('a pick uploads at once and the chip walks preparing → uploading → ready', async () => {
    const d = deps();
    const { result } = renderHook(() => useCoachAttachments(d));
    act(() => void result.current.add([file('plate.jpg')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));
    expect(result.current.busy).toBe(true);
    expect(result.current.ready).toBe(false);
    act(() => d.finish(0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    expect(result.current.busy).toBe(false);
    expect(result.current.ready).toBe(true);
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it('a refused file stays as a chip with the words, and never uploads', async () => {
    const d = deps({ prepare: async () => ({ error: "I can't read clip.mp4 — photos, PDFs, and plain text work." }) });
    const { result } = renderHook(() => useCoachAttachments(d));
    act(() => void result.current.add([file('clip.mp4', 'video/mp4')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0]?.error).toMatch(/can't read clip\.mp4/);
    expect(d.upload).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });

  it('a fifth file is refused by count, with the words on a chip', async () => {
    const d = deps();
    const { result } = renderHook(() => useCoachAttachments(d));
    act(() => void result.current.add([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg'), file('5.jpg')]));
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    expect(result.current.items[4]).toMatchObject({ status: 'failed', name: '5.jpg' });
    expect(result.current.items[4]?.error).toMatch(/more than 4 files/);
    expect(d.prepare).toHaveBeenCalledTimes(4);
  });

  it('Send takes only what is ready and empties the tray', async () => {
    const d = deps();
    const { result } = renderHook(() => useCoachAttachments(d));
    act(() => void result.current.add([file('a.jpg'), file('b.jpg')]));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await waitFor(() => expect(d.upload).toHaveBeenCalledTimes(2));
    act(() => d.finish(0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    let taken: ReturnType<typeof result.current.take> | undefined;
    act(() => {
      taken = result.current.take();
    });
    expect(taken?.labels).toEqual(['a.jpg']);
    expect(taken?.refs.map((r) => r.name)).toEqual(['a.jpg']);
    expect(result.current.items).toEqual([]);
  });

  it('a chip removed mid-upload is not resurrected when the upload lands', async () => {
    const d = deps();
    const { result } = renderHook(() => useCoachAttachments(d));
    act(() => void result.current.add([file('gone.jpg')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));
    const id = result.current.items[0]!.id;
    act(() => result.current.remove(id));
    expect(result.current.items).toEqual([]);
    act(() => d.finish(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.items).toEqual([]);
  });
});
