import type { ReactNode } from 'react';

/**
 * The shell every Settings Room door screen shares: back arrow + title, same idiom as
 * `FoodHome`'s own `.fh-head`/`.fh-body` — a real full screen, not a sheet, that hands the
 * existing settings component underneath a place to live without re-deriving its own chrome.
 *
 * `onBack` always returns to the Room's root list, never further out — the same rule
 * `NutrientsPanel`/`LogScreen` follow inside FoodHome.
 */
export function SettingsSubScreen({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="room" role="region" aria-label={title}>
      <div className="room-head">
        <button className="room-back" onClick={onBack} aria-label="Back to Settings">
          ‹
        </button>
        <b className="room-title">{title}</b>
      </div>
      <div className="room-body">{children}</div>
    </div>
  );
}
