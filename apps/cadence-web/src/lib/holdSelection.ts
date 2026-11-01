/**
 * Keep iOS from selecting the page when a press-and-hold opens something.
 *
 * Our holds fire at ~450ms. iOS runs its OWN long press on the same finger — text selection —
 * a moment later. By then the hold has opened a sheet, so the full-screen scrim (or the sheet)
 * is what sits under the still-resting finger, not the `user-select: none` disc that was pressed.
 * iOS selected from there: the whole page went blue, with handles at the corners and the
 * Copy / Translate / Share menu over the hold menu (owner, on device, 2026-11-01).
 *
 * The CSS is the first line (the scrim and the hold menu are `user-select: none`). This is the
 * second, for whatever surface a future hold opens: from the moment a hold fires until shortly
 * after the finger lifts, a selection is refused (`selectstart` cancelled) and any that lands
 * anyway is cleared — clearing it also takes the Copy / Share menu away. The guard ends on its
 * own; nothing has to remember to remove it.
 */

/** How long after the finger lifts the guard stays up — iOS can settle its selection on release. */
export const HOLD_SELECTION_SETTLE_MS = 600;
/** The guard never outlives this, whatever happens to the pointer (a lost `pointerup`, say). */
export const HOLD_SELECTION_CAP_MS = 10_000;

const LIFTS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;

/** Clear a real selection; a collapsed caret (someone's cursor in a text field) is left alone. */
function clearSelection(): void {
  const sel = document.getSelection();
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
}

/** Call when a hold fires, finger still down. Returns the early stop (tests, unmounts). */
export function guardSelectionThroughHold(): () => void {
  if (typeof document === 'undefined') return () => {};
  let settle: number | undefined;
  let cap: number | undefined;
  let ended = false;

  const refuse = (e: Event) => e.preventDefault();
  const end = () => {
    if (ended) return;
    ended = true;
    // The page can be gone before the cap fires (a test file torn down mid-guard): nothing is left
    // to clean up, and reaching for `window` there throws out of a bare timer.
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.clearTimeout(settle);
    window.clearTimeout(cap);
    document.removeEventListener('selectstart', refuse, true);
    document.removeEventListener('selectionchange', clearSelection);
    for (const type of LIFTS) window.removeEventListener(type, lifted, true);
    clearSelection();
  };
  const lifted = () => {
    clearSelection();
    window.clearTimeout(settle);
    settle = window.setTimeout(end, HOLD_SELECTION_SETTLE_MS);
  };

  document.addEventListener('selectstart', refuse, true);
  document.addEventListener('selectionchange', clearSelection);
  for (const type of LIFTS) window.addEventListener(type, lifted, true);
  cap = window.setTimeout(end, HOLD_SELECTION_CAP_MS);
  clearSelection();
  return end;
}
