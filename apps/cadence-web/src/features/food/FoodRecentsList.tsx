import type { FoodSummary } from '../../lib/api.ts';

/**
 * Recents / search hits. Tap is a confirm-shaped affordance — full log wiring
 * waits on the resolver; for now the row is the interaction shell.
 */
export function FoodRecentsList({ foods, onPick }: { foods: FoodSummary[]; onPick: (f: FoodSummary) => void }) {
  return (
    <ul className="food-list">
      {foods.map((f) => (
        <li key={f.food_id}>
          <button type="button" className="food-row" onClick={() => onPick(f)}>
            <b>{f.name}</b>
            <span>{[f.brand, f.serving_label].filter(Boolean).join(' · ') || 'Tap to log — you confirm first'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
