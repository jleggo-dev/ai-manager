/** Primary fast-log entry points — say / snap first; barcode + recipes + meal plans + search. */

type Mode = 'home' | 'say' | 'snap' | 'barcode' | 'search' | 'recipes' | 'meal-plans';

export function FoodEntryActions({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <div className="food-actions" role="group" aria-label="Log food">
      <button
        type="button"
        className={`food-action${mode === 'say' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'say' ? 'home' : 'say')}
      >
        <b>Say it</b>
        <span>Describe the meal — I draft, you confirm</span>
      </button>
      <button
        type="button"
        className={`food-action${mode === 'snap' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'snap' ? 'home' : 'snap')}
      >
        <b>Snap it</b>
        <span>Label or plate photo</span>
      </button>
      <button
        type="button"
        className={`food-action${mode === 'barcode' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'barcode' ? 'home' : 'barcode')}
      >
        <b>Barcode</b>
        <span>Scan or type — Open Food Facts</span>
      </button>
      <button
        type="button"
        className={`food-action${mode === 'recipes' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'recipes' ? 'home' : 'recipes')}
      >
        <b>Recipes</b>
        <span>Save a dish once — log servings any day</span>
      </button>
      <button
        type="button"
        className={`food-action${mode === 'meal-plans' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'meal-plans' ? 'home' : 'meal-plans')}
      >
        <b>This week&apos;s meals</b>
        <span>Draft a week + shopping list — confirm before it sticks</span>
      </button>
      <button
        type="button"
        className={`food-action food-action-muted${mode === 'search' ? ' food-action-on' : ''}`}
        onClick={() => onMode(mode === 'search' ? 'home' : 'search')}
      >
        <b>Search</b>
        <span>When you know the name</span>
      </button>
    </div>
  );
}
