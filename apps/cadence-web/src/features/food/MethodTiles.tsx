import type { ReactNode } from 'react';
import { CameraIcon, MicIcon, PencilIcon, ScanIcon, SearchIcon } from './captureIcons.tsx';

/** Every way in. `search` only appears where there is a fuller screen to open. */
export type CaptureMethod = 'chat' | 'voice' | 'picture' | 'barcode' | 'search';

const META: Record<CaptureMethod, { label: string; hint: string; icon: () => ReactNode }> = {
  // "Type it" with a pencil (canvas, 2026-10-29): the doors log, they never talk — the speech
  // bubble belongs to her face, which is the one door to a conversation.
  chat: { label: 'Type it', hint: 'say it in words', icon: PencilIcon },
  voice: { label: 'Voice', hint: 'same chat, mic live', icon: MicIcon },
  picture: { label: 'Picture', hint: 'one photo', icon: CameraIcon },
  barcode: { label: 'Barcode', hint: 'off the packet', icon: ScanIcon },
  // "Find", not "Search", and first wherever the row is drawn: it is the fastest and most exact
  // way in, so it gets the spot the thumb lands on (owner, 2026-09-07).
  search: { label: 'Find', hint: 'the whole list', icon: SearchIcon },
};

/**
 * Every method is a tile, so nothing here is a dead end (design 05a/05b). The picture tile is a
 * file input rather than a button — the camera has to be opened by a real label for iOS to hand
 * back the photo — so the row renders one or the other per method.
 *
 * `icons` is the quick log's row (2026-10-28): five round doors, the glyph alone, the word only
 * for a screen reader. Each door keeps its name in the DOM (`data-method`) so a test can still
 * tell Find from Chat without reading pixels.
 */
export function MethodTiles({
  methods,
  variant = 'compact',
  disabled,
  onPick,
  onPhoto,
}: {
  methods: CaptureMethod[];
  /** `compact` is the sheet's icon-and-label row; `wide` is the Log screen's tile with a hint;
   *  `icons` is the quick log's icon-only round doors. */
  variant?: 'compact' | 'wide' | 'icons';
  disabled?: boolean;
  onPick: (m: CaptureMethod) => void;
  /** Given for the picture tile; without it, picture behaves like any other tile. */
  onPhoto?: (file: File | undefined) => void;
}) {
  const iconsOnly = variant === 'icons';
  return (
    <div className={`fm-tiles fm-tiles-${variant}`}>
      {methods.map((m) => {
        const { label, hint, icon: Icon } = META[m];
        const inner = (
          <>
            <span className="fm-tile-i">
              <Icon />
            </span>
            {!iconsOnly && <span className="fm-tile-l">{label}</span>}
            {variant === 'wide' && <span className="fm-tile-h">{hint}</span>}
          </>
        );
        if (m === 'picture' && onPhoto) {
          return (
            <label
              className={`fm-tile fm-tile-${m}`}
              key={m}
              aria-label={iconsOnly ? label : undefined}
              data-method={m}
            >
              {inner}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={disabled}
                onChange={(e) => {
                  onPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          );
        }
        return (
          <button
            type="button"
            className={`fm-tile fm-tile-${m}`}
            key={m}
            disabled={disabled}
            aria-label={iconsOnly ? label : undefined}
            data-method={m}
            onClick={() => onPick(m)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
