/**
 * The app's FIRST stepper (check-in rebuild, step 5) — a session row's actual minutes, +/- one at
 * a time. Kept deliberately plain: two buttons and a number, floored at `min` (1 by default) and
 * otherwise open-ended, no text entry. Fully controlled — `value` is whatever the caller's own
 * state says it is (DayDrillIn reads it straight off the session row), so tapping + or - never
 * drifts from what actually got written.
 */
export function MinutesStepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
}) {
  return (
    <div className="wkr-stepper" role="group" aria-label="Minutes">
      <button
        type="button"
        className="wkr-stepper-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Fewer minutes"
      >
        −
      </button>
      <span className="wkr-stepper-n">{value} min</span>
      <button type="button" className="wkr-stepper-btn" onClick={() => onChange(value + 1)} aria-label="More minutes">
        +
      </button>
    </div>
  );
}
