import { useEffect, useRef, useState } from 'react';
import { capabilities, type PhotoSource } from '../lib/capability/index.ts';
import { CameraIcon } from '../features/food/captureIcons.tsx';

/**
 * The camera on every chat with the coach (owner, 2026-11-01: "I want a camera icon and to choose
 * from camera and photo"). One tap opens a two-line choice — take one now, or pick one already
 * taken — and the photo goes wherever that chat sends photos: the coach's upload tray, or the
 * meal's photo read. This component only fetches the picture; it never decides what it means.
 *
 * On the phone each line opens the native camera or photo picker directly. In a browser there is
 * no such call, so each line is a file input instead: `capture` on the camera one, none on the
 * library one. (A single input with no `capture` is what the meal doors had, and iOS answers it
 * with its own menu — the choice the owner asked for, made a second time.)
 */
export function PhotoButton({
  onPick,
  disabled,
  multiple = false,
  className = '',
}: {
  onPick: (files: File[]) => void;
  disabled?: boolean;
  /** Library picks may carry several (the coach tray takes up to four); the camera is always one. */
  multiple?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const native = capabilities.photos.isAvailable();

  // A menu that only closes from inside traps the person who changed their mind.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const take = (source: PhotoSource) => {
    setOpen(false);
    void capabilities.photos.pick(source).then((f) => f && onPick([f]));
  };

  const fromInput = (list: FileList | null) => {
    setOpen(false);
    const files = Array.from(list ?? []);
    if (files.length) onPick(files);
  };

  return (
    <span className={`photo-btn ${className}`.trim()} ref={root}>
      <button
        type="button"
        className="photo-btn-i"
        aria-label="Add a photo"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <CameraIcon />
      </button>
      {open && (
        <span className="photo-menu" role="menu">
          {native ? (
            <>
              <button type="button" role="menuitem" onClick={() => take('camera')}>
                Take a photo
              </button>
              <button type="button" role="menuitem" onClick={() => take('library')}>
                Choose from your photos
              </button>
            </>
          ) : (
            <>
              <label role="menuitem">
                Take a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    fromInput(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label role="menuitem">
                Choose from your photos
                <input
                  type="file"
                  accept="image/*"
                  multiple={multiple}
                  hidden
                  onChange={(e) => {
                    fromInput(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </span>
      )}
    </span>
  );
}
