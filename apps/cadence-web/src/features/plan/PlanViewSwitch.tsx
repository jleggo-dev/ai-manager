/**
 * The day/week switch for the one Plan tab — its own file from day one (the size rule), and a
 * genuinely separate responsibility: PlanView renders a plan; this decides which LENS you see it
 * through. Born 2026-08-14 when Today and Week stopped being tabs (owner: Week "doesn't have
 * more information than the today tab").
 */
export function PlanViewSwitch({
  view,
  onChange,
}: {
  view: 'today' | 'week';
  onChange: (v: 'today' | 'week') => void;
}) {
  return (
    <div className="pv-switch" role="tablist" aria-label="Plan view">
      <button
        role="tab"
        aria-selected={view === 'today'}
        className={view === 'today' ? 'is-on' : ''}
        onClick={() => onChange('today')}
      >
        Today
      </button>
      <button
        role="tab"
        aria-selected={view === 'week'}
        className={view === 'week' ? 'is-on' : ''}
        onClick={() => onChange('week')}
      >
        Week
      </button>
    </div>
  );
}
