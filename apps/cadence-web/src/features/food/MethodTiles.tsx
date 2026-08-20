import type { ReactNode } from 'react';
import { CameraIcon, ChatIcon, MicIcon, ScanIcon, SearchIcon } from './captureIcons.tsx';

/** Every way in. `search` only appears where there is a fuller screen to open. */
export type CaptureMethod = 'chat' | 'voice' | 'picture' | 'barcode' | 'search';

const META: Record<CaptureMethod, { label: string; hint: string; icon: () => ReactNode }> = {
  chat: { label: 'Chat', hint: 'say it in words', icon: ChatIcon },
  voice: { label: 'Voice', hint: 'same chat, mic live', icon: MicIcon },
  picture: { label: 'Picture', hint: 'one photo', icon: CameraIcon },
  barcode: { label: 'Barcode', hint: 'off the packet', icon: ScanIcon },
  search: { label: 'Search', hint: 'the whole list', icon: SearchIcon },
};

/**
 * Every method is a tile, so nothing here is a dead end (design 05a/05b). The picture tile is a
 * file input rather than a button — the camera has to be opened by a real label for iOS to hand
 * back the photo — so the row renders one or the other per method.
 */
export function MethodTiles({
  methods,
  variant = 'compact',
  disabled,
  onPick,
  onPhoto,
}: {
  methods: CaptureMethod[];
  /** `compact` is the sheet's icon-and-label row; `wide` is the Log screen's tile with a hint. */
  variant?: 'compact' | 'wide';
  disabled?: boolean;
  onPick: (m: CaptureMethod) => void;
  /** Given for the picture tile; without it, picture behaves like any other tile. */
  onPhoto?: (file: File | undefined) => void;
}) {
  return (
    <div className={`fm-tiles fm-tiles-${variant}`}>
      {methods.map((m) => {
        const { label, hint, icon: Icon } = META[m];
        const inner = (
          <>
            <span className="fm-tile-i">
              <Icon />
            </span>
            <span className="fm-tile-l">{label}</span>
            {variant === 'wide' && <span className="fm-tile-h">{hint}</span>}
          </>
        );
        if (m === 'picture' && onPhoto) {
          return (
            <label className="fm-tile" key={m}>
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
          <button type="button" className="fm-tile" key={m} disabled={disabled} onClick={() => onPick(m)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
