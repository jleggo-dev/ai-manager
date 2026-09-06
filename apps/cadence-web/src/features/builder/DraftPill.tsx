/**
 * The way back to a minimized draft — the visible half of the owner's third door (2026-09-06).
 *
 * Its own component because it has two hosts: the real shell (MainTabs) and the `?preview=builder`
 * harness. A hand-copied second pill is exactly the kind of thing that drifts and then shows the
 * owner a control the app does not actually have — the preview is only worth having if what it
 * shows is the real one.
 */
export function DraftPill({ onClick }: { onClick: () => void }) {
  return (
    <button className="draft-pill" onClick={onClick} aria-label="Back to your draft">
      ✎ Your draft ↗
    </button>
  );
}
