import type { ProgressWindow } from '@cadence/shared';

const OPTIONS: { value: ProgressWindow; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
];

export interface WindowSegProps {
  value: ProgressWindow;
  onChange: (window: ProgressWindow) => void;
}

/**
 * The Progress screen's Week/Month/All pill toggle (Progress Engine parcel W1-2) — the `.seg` /
 * `.seg-btn` / `.seg-on` classes already exist in styles.css for this exact "pinned pill toggle,
 * the selected side lifted" pattern. Controlled only: it reads `value` and calls `onChange`, and
 * fetches nothing itself — the integration parcel owns wiring this into ProgressView + re-window
 * on change (see docs/cadence/PROGRESS-ENGINE.md, W1-6).
 */
export function WindowSeg({ value, onChange }: WindowSegProps) {
  return (
    <div className="seg" role="group" aria-label="Progress window">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'seg-btn seg-on' : 'seg-btn'}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
