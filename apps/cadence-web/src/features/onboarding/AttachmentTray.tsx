import { useRef } from 'react';
import { ATTACHMENT_ACCEPT } from '@cadence/shared';
import type { CoachAttachmentsTray, PendingAttachment } from './useCoachAttachments.ts';

/**
 * The two visible halves of attaching something to a message (owner, 2026-09-11): the paperclip
 * beside the mic, and the chips that ride above the field while the files go up. Its own file
 * because the composer has its own size budget and a distinct responsibility gets its own file.
 *
 * A chip says what state the file is in — going up, ready, or the words for why it cannot go —
 * and every chip can be dismissed. A photo shows its own thumbnail; a document shows its name.
 */

const ClipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path
      className="stroke"
      d="M10.5 4.5 5.8 9.2a1.6 1.6 0 0 0 2.3 2.3l5-5a3 3 0 0 0-4.2-4.2L3.6 7.6a4.3 4.3 0 0 0 6.1 6.1l4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The paperclip: opens the OS picker (photos, PDFs, text — `ATTACHMENT_ACCEPT` names them). */
export function AttachButton({ tray, disabled }: { tray: CoachAttachmentsTray; disabled?: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="attach"
        aria-label="Attach a photo or file"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ClipIcon />
      </button>
      <input
        ref={input}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) void tray.add(e.target.files);
          e.target.value = ''; // the same file picked twice must fire again
        }}
      />
    </>
  );
}

function statusWords(it: PendingAttachment): string | null {
  if (it.status === 'preparing') return 'getting ready…';
  if (it.status === 'uploading') return 'sending…';
  if (it.status === 'failed') return it.error ?? 'could not attach';
  return null;
}

/** The chips. Renders nothing at all when the tray is empty. */
export function AttachmentTray({ tray }: { tray: CoachAttachmentsTray }) {
  if (tray.items.length === 0) return null;
  return (
    <div className="attach-tray" role="list" aria-label="Attached to this message">
      {tray.items.map((it) => {
        const words = statusWords(it);
        return (
          <div key={it.id} className={`attach-chip is-${it.status}`} role="listitem">
            {it.previewUrl ? (
              <img className="attach-thumb" src={it.previewUrl} alt="" />
            ) : (
              <span className="attach-glyph" aria-hidden>
                {it.kind === 'document' ? 'PDF' : it.kind === 'text' ? 'TXT' : '…'}
              </span>
            )}
            <span className="attach-name">{it.name}</span>
            {words && <span className="attach-words">{words}</span>}
            <button
              type="button"
              className="attach-x"
              aria-label={`Remove ${it.name}`}
              onClick={() => tray.remove(it.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
