import type { BalancePayload } from '@cadence/shared';
import { DotRow } from '../../../components/viz.tsx';

/**
 * `balance` — a proportion of felt-states ("calmer after 6 of 8 sits"). Counts what happened;
 * the complement is neutral (var(--surface-3)) dots, NEVER its own colored/red series — DotRow
 * already enforces that (missing = neutral) so this widget only has to choose the "on" color.
 */
export function BalanceWidget({ data }: { data: BalancePayload }) {
  const dots = Array.from({ length: data.total }, (_, i) => i < data.positive);
  return (
    <div>
      <div className="pw-balance-label">
        {data.positive_label} after {data.positive} of {data.total} {data.noun}
      </div>
      <DotRow dots={dots} color="var(--sage)" />
    </div>
  );
}
