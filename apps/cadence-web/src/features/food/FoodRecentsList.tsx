import type { FoodSummary } from '../../lib/api.ts';

/** Recents / search hits — tap opens portion confirm (never logs immediately). */
export function FoodRecentsList({ foods, onPick }: { foods: FoodSummary[]; onPick: (f: FoodSummary) => void }) {
  return (
    <ul className="food-list">
      {foods.map((f) => (
        <li key={f.food_id}>
          <button type="button" className="food-row" onClick={() => onPick(f)}>
            <b>{f.name}</b>
            <span>{[f.brand, f.serving_label].filter(Boolean).join(' · ') || 'Tap to confirm portion'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
