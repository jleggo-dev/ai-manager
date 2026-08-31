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
 * The Progress screen's Week/Month/All pill toggle (Progress Engine parcel W1-2), styled per the
 * owner design (1a header): a compact round pill row that sits beside the page title — the active
 * window is a white pill with a small lift, the rest are transparent. Own `.pw-seg` classes in
 * progress-widgets.css; the Today tab's `.seg` toggle keeps its full-width look untouched.
 * Controlled only: it reads `value` and calls `onChange`, and fetches nothing itself — the
 * integration parcel owns wiring this into ProgressView + re-window on change (see
 * docs/cadence/PROGRESS-ENGINE.md, W1-6).
 */
export function WindowSeg({ value, onChange }: WindowSegProps) {
  return (
    <div className="pw-seg" role="group" aria-label="Progress window">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'pw-seg-btn pw-seg-on' : 'pw-seg-btn'}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
