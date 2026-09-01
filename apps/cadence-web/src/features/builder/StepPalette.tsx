import { PALETTE } from './builderCatalog.ts';
import type { PaletteStepKind } from './builderSession.ts';

/**
 * "＋ Add step" (design C) — the coach's own tool catalog, handed to the person building. Grouped
 * **Do** (records that it happened) / **Capture** (records what you put in, the reflection
 * family). One row per step kind the walkthrough player actually plays today — `photo` is
 * excluded; see `builderCatalog.ts`'s header comment for the audit.
 */
export function StepPalette({ onPick, onClose }: { onPick: (kind: PaletteStepKind) => void; onClose: () => void }) {
  const doRows = PALETTE.filter((p) => p.group === 'Do');
  const captureRows = PALETTE.filter((p) => p.group === 'Capture');

  return (
    <div className="ab-palette-wrap" role="dialog" aria-modal="true" aria-label="Add a step">
      <div className="ab-palette-scrim" onClick={onClose} aria-hidden />
      <div className="ab-palette">
        <div className="ab-palette-grab" aria-hidden />
        <div className="ab-palette-title">Add a step</div>
        <PaletteGroup label="Do" rows={doRows} onPick={onPick} />
        <PaletteGroup label="Capture" rows={captureRows} onPick={onPick} />
        <div className="ab-palette-note">
          Same toolbox your coach builds from. A metronome can ride on any step once it’s added.
        </div>
      </div>
    </div>
  );
}

function PaletteGroup({
  label,
  rows,
  onPick,
}: {
  label: string;
  rows: typeof PALETTE;
  onPick: (kind: PaletteStepKind) => void;
}) {
  return (
    <div className="ab-palette-group">
      <div className={`ab-palette-label ab-palette-label-${label.toLowerCase()}`}>{label}</div>
      <div className="ab-palette-grid">
        {rows.map((row) => (
          <button
            type="button"
            key={row.kind}
            className={`ab-palette-row ab-palette-row-${label.toLowerCase()}`}
            onClick={() => onPick(row.kind)}
          >
            <b>{row.label}</b>
            <span>{row.when}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
