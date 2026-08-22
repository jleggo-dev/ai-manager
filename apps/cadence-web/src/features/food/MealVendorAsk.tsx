import type { AmountRow } from './useMealAmounts.ts';
import { vendorAskRows } from './vendorAsk.ts';

/**
 * "From somewhere?" — one optional line on the confirm card.
 *
 * Never blocks the log and is never required: an unanswered vendor costs nothing today, and the
 * whole point of asking at all is that it is asked ONCE. MyFitnessPal makes you find the branded
 * item every single time; this asks once and then remembers, which is the same promise the coach
 * makes everywhere else — you don't repeat yourself.
 */
export function MealVendorAsk({
  rows,
  busy,
  onBrand,
}: {
  rows: AmountRow[];
  busy: boolean;
  onBrand: (index: number, brand: string) => void;
}) {
  const asks = vendorAskRows(rows);
  if (asks.length === 0) return null;

  return (
    <div className="fa-vendor">
      <div className="fa-card-open">FROM SOMEWHERE? — OPTIONAL, ASKED ONCE</div>
      {asks.map(({ row, index }) => (
        <label className="food-field" key={`${row.name}-${index}`}>
          <span>{row.name}</span>
          <input
            className="wiz-in"
            type="text"
            value={row.brand ?? ''}
            disabled={busy}
            placeholder="Café, shop or brand — or leave it"
            aria-label={`Where did the ${row.name} come from?`}
            onChange={(e) => onBrand(index, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
