/**
 * The composer's tray: what is attached to the message being written, and where each file is on
 * its way up (owner, 2026-09-11: files and photos on the coach chat).
 *
 * Its own hook rather than more state in `useCoachChat`, which owns the conversation and sits
 * against the 150-line ceiling — and the split is honest: "hold and upload the files for the
 * next message" is a distinct responsibility from "run the turn", and it is the piece the meal
 * screen or a check-in would reuse without inheriting a chat.
 *
 * Uploads start the moment a file is picked, not on Send: a 4 MB PDF takes seconds to go up,
 * and doing that while the user is still typing is the difference between Send feeling instant
 * and Send feeling broken. Send waits only for what is still in flight (`busy`).
 *
 * A file that cannot go stays in the tray as a chip WITH WORDS on it (the shared rejection text,
 * the same the server would use) until it is dismissed — an attachment that silently vanishes is
 * a question the user cannot ask.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentRejectionText,
  type AttachmentKind,
  type AttachmentRef,
} from '@cadence/shared';
import { prepareAttachment } from '../../lib/attachments/prepare.ts';
import { uploadCoachAttachment } from '../../lib/api/coach-attachments.ts';

export type PendingStatus = 'preparing' | 'uploading' | 'ready' | 'failed';

export interface PendingAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  status: PendingStatus;
  /** A photo's thumbnail (object URL) — revoked when the chip goes. */
  previewUrl: string | null;
  /** The words on a failed chip. */
  error?: string;
  /** Set once the bytes are in Storage — what the message will carry. */
  ref?: AttachmentRef;
}

/** What Send takes off the tray: the refs the message carries, and the names its bubble shows. */
export interface TakenAttachments {
  refs: AttachmentRef[];
  labels: string[];
}

let seq = 0;
const nextId = (): string => `att-${Date.now().toString(36)}-${(seq += 1)}`;

/** Injectable for tests (default: the real prepare + upload pipeline). */
export interface CoachAttachmentDeps {
  prepare?: typeof prepareAttachment;
  upload?: typeof uploadCoachAttachment;
}

export function useCoachAttachments(deps: CoachAttachmentDeps = {}) {
  const prepare = deps.prepare ?? prepareAttachment;
  const upload = deps.upload ?? uploadCoachAttachment;
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // The live list, for the async chain: state is a snapshot, and two picks in a row must each
  // see the other's chip when the cap is counted.
  const live = useRef<PendingAttachment[]>([]);
  const commit = useCallback((next: PendingAttachment[]) => {
    live.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, up: Partial<PendingAttachment>) => {
      commit(live.current.map((it) => (it.id === id ? { ...it, ...up } : it)));
    },
    [commit],
  );

  const add = useCallback(
    async (picked: ArrayLike<File>) => {
      const files = Array.from(picked);
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS_PER_MESSAGE - live.current.length;
      const accepted = files.slice(0, Math.max(0, room));
      const chips: PendingAttachment[] = accepted.map((f) => ({
        id: nextId(),
        name: f.name,
        kind: 'image',
        status: 'preparing',
        previewUrl: null,
      }));
      if (files.length > accepted.length) {
        chips.push({
          id: nextId(),
          name: files[accepted.length]?.name ?? 'file',
          kind: 'image',
          status: 'failed',
          previewUrl: null,
          error: attachmentRejectionText('', { reason: 'too_many', limit: MAX_ATTACHMENTS_PER_MESSAGE }),
        });
      }
      commit([...live.current, ...chips]);

      await Promise.all(
        accepted.map(async (file, i) => {
          const id = chips[i]!.id;
          const prepared = await prepare(file);
          if (!live.current.some((it) => it.id === id)) return; // removed while preparing
          if ('error' in prepared) return patch(id, { status: 'failed', error: prepared.error });
          patch(id, { status: 'uploading', kind: prepared.kind, name: prepared.name, previewUrl: prepared.previewUrl });
          try {
            const ref = await upload(prepared);
            if (live.current.some((it) => it.id === id)) patch(id, { status: 'ready', ref });
          } catch (e) {
            patch(id, { status: 'failed', error: e instanceof Error ? e.message : 'upload failed' });
          }
        }),
      );
    },
    [commit, patch, prepare, upload],
  );

  const remove = useCallback(
    (id: string) => {
      const gone = live.current.find((it) => it.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      commit(live.current.filter((it) => it.id !== id));
    },
    [commit],
  );

  /** Send takes everything that is ready and clears the tray — failed chips go too; their words
   *  were on screen until this moment, and the message going out is the user's answer to them. */
  const take = useCallback((): TakenAttachments => {
    const ready = live.current.filter((it) => it.status === 'ready' && it.ref);
    for (const it of live.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    commit([]);
    return { refs: ready.map((it) => it.ref!), labels: ready.map((it) => it.name) };
  }, [commit]);

  // Unmount: nothing leaks. (The refs already in Storage are the server's to keep or purge.)
  useEffect(
    () => () => {
      for (const it of live.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    },
    [],
  );

  const busy = items.some((it) => it.status === 'preparing' || it.status === 'uploading');
  const ready = items.some((it) => it.status === 'ready');
  return { items, add, remove, take, busy, ready };
}

export type CoachAttachmentsTray = ReturnType<typeof useCoachAttachments>;
