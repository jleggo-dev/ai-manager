import { useState } from 'react';
import { inferTool } from '@cadence/shared';
import type { SessionItem } from '@cadence/shared';
import type { BuilderCard } from './builderSession.ts';
import { chipStyleFor, isPaletteKind, paletteEntry } from './builderCatalog.ts';
import { StraightFields } from './StepCardFields.tsx';
import { CircuitFields } from './CircuitFields.tsx';

/**
 * One step card (design 1B) — the tool chip, the name, its own tool-specific numbers, and the ⋯
 * menu (duplicate/delete) plus ▲▼ reorder. Every control here is a real button/input wired
 * straight to a `builderSession.ts` helper via the callbacks below — `ActivityBuilder.tsx` owns
 * the one `cards` array and re-renders down; this component holds no session state of its own
 * (only whether its OWN ⋯ menu is open).
 */
export function StepCard({
  card,
  index,
  count,
  onRename,
  onPatchItem,
  onCircuitRounds,
  onCircuitExercise,
  onCircuitAdd,
  onCircuitRemove,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  card: BuilderCard;
  index: number;
  count: number;
  onRename: (name: string) => void;
  onPatchItem: (patch: Partial<SessionItem>) => void;
  onCircuitRounds: (rounds: number) => void;
  onCircuitExercise: (exIndex: number, patch: Partial<SessionItem>) => void;
  onCircuitAdd: () => void;
  onCircuitRemove: (exIndex: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isCircuit = card.block.mode === 'circuit';
  const item = card.block.items[0];
  const resolved = isCircuit ? 'circuit' : item ? inferTool(item).kind : 'read';
  // The builder only ever authors items that resolve inside its own palette (see isPaletteKind's
  // doc) — 'read' is the fallback for the type checker, never a case that fires in practice.
  const kind = isPaletteKind(resolved) ? resolved : 'read';
  const chip = chipStyleFor(kind);
  const chipLabel = paletteEntry(kind).chipLabel;
  const name = isCircuit ? card.block.label : (item?.name ?? '');

  return (
    <div className="ab-card">
      <div className="ab-card-top">
        <span className="ab-chip" style={{ background: chip.bg, color: chip.fg }}>
          {chipLabel}
        </span>
        <input
          className="ab-card-name"
          type="text"
          aria-label="Step name"
          value={name}
          onChange={(e) => onRename(e.target.value)}
        />
        <div className="ab-card-reorder">
          <button type="button" aria-label="Move step up" disabled={index === 0} onClick={onMoveUp}>
            ▲
          </button>
          <button type="button" aria-label="Move step down" disabled={index === count - 1} onClick={onMoveDown}>
            ▼
          </button>
        </div>
        <div className="ab-card-menu-wrap">
          <button
            type="button"
            className="ab-card-menu-btn"
            aria-label="Step options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="ab-card-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                className="ab-card-menu-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {isCircuit ? (
        <CircuitFields
          block={card.block}
          onRounds={onCircuitRounds}
          onExercise={onCircuitExercise}
          onAdd={onCircuitAdd}
          onRemove={onCircuitRemove}
        />
      ) : item ? (
        <StraightFields kind={kind} item={item} onPatch={onPatchItem} />
      ) : null}
    </div>
  );
}
