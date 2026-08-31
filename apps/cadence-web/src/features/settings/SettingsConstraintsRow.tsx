import type { UserConstraint } from '../../lib/api.ts';

/**
 * "What we work around" — read-only in the Room (design owner-approved 2026-08-31).
 *
 * Constraints are coach-owned now: the rename/remove UI that used to live in `ConstraintsSettings`
 * does NOT appear here. This row exists only so the fact stays checkable by the person it is
 * about — the original reason the panel was built (2026-08-16 mis-capture incident, see
 * `ConstraintsSettings.tsx`) — without re-opening a second surface that can edit the same rows the
 * coach edits through her own, more careful, path.
 *
 * A plain `<div>`, not a `<button>`: no chevron, nothing to tap.
 */
export function SettingsConstraintsRow({ constraints }: { constraints: UserConstraint[] | null }) {
  const summary =
    constraints === null
      ? 'Loading…'
      : constraints.length === 0
        ? 'Nothing on file'
        : constraints
            .slice(0, 4)
            .map((c) => c.label)
            .join(', ') + (constraints.length > 4 ? '…' : '');

  return (
    <div className="room-row room-row-static">
      <b>What we work around</b>
      <span>{summary} · read-only here</span>
    </div>
  );
}
