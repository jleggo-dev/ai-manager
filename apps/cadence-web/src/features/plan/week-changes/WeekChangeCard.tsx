import type { PendingChangeDetailItem } from '../../../lib/api.ts';

/**
 * One swap candidate — title, NOW → NEXT WEEK, the coach's reason (if she gave one), and the
 * toggle that decides whether it actually applies. `item.enabled` is the row's STORED default (an
 * "OPTIONAL" tag marks a take-it-or-leave-it offer regardless of how the user has since flipped
 * it); `checked` is the LIVE, possibly-flipped state the sheet is tracking.
 */
export function WeekChangeCard({
  item,
  checked,
  onToggle,
}: {
  item: PendingChangeDetailItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="wkc-card">
      <div className="wkc-card-head">
        <b>{item.title}</b>
        {!item.enabled && (
          <span className="wkc-tag" aria-label="Optional">
            OPTIONAL
          </span>
        )}
      </div>
      <div className="wkc-cols">
        <div className="wkc-col">
          <span className="wkc-col-label">NOW</span>
          <span>{item.now ?? 'NEW'}</span>
        </div>
        <span className="wkc-arrow" aria-hidden>
          →
        </span>
        <div className="wkc-col">
          <span className="wkc-col-label">NEXT WEEK</span>
          <span>{item.next}</span>
        </div>
      </div>
      {item.change_reason && <p className="wkc-reason">{item.change_reason}</p>}
      <label className="wkc-switch">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Include: ${item.title}`} />
        <span className="wkc-switch-track" aria-hidden />
      </label>
    </div>
  );
}
