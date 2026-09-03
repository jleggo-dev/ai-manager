/**
 * One row on the list screen (P6 "the room"): mark · title · second line · standing, with a ⋯
 * menu for moving the piece — between standings always, and up/down within Up next when the
 * caller wires that in (queued rows only; see ListScreen.tsx). Tapping the row itself always opens
 * the item screen (P2).
 *
 * The brief describes Up next as "drag-ordered" and this row's move as reachable by "swipe (or use
 * its ⋯)". Neither drag nor swipe is implemented: no drag/gesture library exists anywhere in this
 * monorepo, and this codebase tests every button through jsdom + Testing Library, where a pointer
 * drag or a touch swipe is not reliably simulable. The ⋯ menu is the one interaction both the
 * brief's own fallback ("or use its ⋯") and the existing button-per-behavior convention (see
 * StandingControl.tsx) already sanction, so every move — standing change and Up next reorder alike
 * — goes through it. Functionally identical either way: the same PATCH, with the same body.
 *
 * One row component for every domain (P8): the standing word on the right and in the move menu
 * comes from `standingWordFor`, which reads THIS item's own `kind` — a book's Learned standing
 * says "Finished" there, everything else is `STANDING_WORDS` unchanged. No second row type, no
 * per-domain branch in this file.
 */
import { useState } from 'react';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { STANDING_ORDER } from './repertoireItemCopy.ts';
import { buildSecondLine, standingWordFor } from './repertoireListCopy.ts';

const MARK_TONE: Record<RepertoireStatus, string> = {
  working: 'rl-mark--working',
  queued: 'rl-mark--queued',
  known: 'rl-mark--known',
  retired: 'rl-mark--retired',
};

export interface RepertoireRowProps {
  item: RepertoireItem;
  onOpen: () => void;
  onChangeStanding: (status: RepertoireStatus) => void;
  /** Present only for a row in the Up next group — omitted (never rendered) everywhere else. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Injectable for tests; the row's own date segment is otherwise `new Date()`. */
  now?: Date;
}

export function RepertoireRow({ item, onOpen, onChangeStanding, onMoveUp, onMoveDown, now }: RepertoireRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const secondLine = buildSecondLine(item, now);
  const canReorder = Boolean(onMoveUp) || Boolean(onMoveDown);

  return (
    <div className="rl-row">
      <button type="button" className="rl-row-main" onClick={onOpen}>
        <span className={`rl-mark ${MARK_TONE[item.status]}`} aria-hidden="true" />
        <span className="rl-row-body">
          <span className="rl-row-title">{item.label}</span>
          {secondLine && <span className="rl-row-sub">{secondLine}</span>}
        </span>
        <span className="rl-row-standing">{standingWordFor(item.kind, item.status)}</span>
      </button>

      <div className="rl-row-menu-wrap">
        <button
          type="button"
          className="rl-row-more"
          aria-label={`Move ${item.label}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="rl-row-menu" role="menu">
            {canReorder && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="rl-row-menu-item"
                  disabled={!onMoveUp}
                  onClick={() => {
                    setMenuOpen(false);
                    onMoveUp?.();
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="rl-row-menu-item"
                  disabled={!onMoveDown}
                  onClick={() => {
                    setMenuOpen(false);
                    onMoveDown?.();
                  }}
                >
                  Move down
                </button>
                <div className="rl-row-menu-sep" role="separator" />
              </>
            )}
            {STANDING_ORDER.filter((s) => s !== item.status).map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                className="rl-row-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onChangeStanding(s);
                }}
              >
                Move to {standingWordFor(item.kind, s)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
