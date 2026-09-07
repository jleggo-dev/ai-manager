/**
 * An empty breakfast (canvas 1b B1) — "the empty state is the whole argument": a titled meal
 * with a place for things to go. Since the cart ruling (owner, 2026-09-07) the doors and the
 * usual list are drawn by the screen in BOTH states, so this is only the words at the top of an
 * empty cart, and the one-food express lane when the host offers it.
 */
export function MealEmptyState({ onExpressSingle }: { onExpressSingle?: () => void }) {
  return (
    <div className="ms-empty">
      <div className="ms-empty-mark" aria-hidden="true">
        ◌
      </div>
      <h3>Add everything you had</h3>
      <p className="ms-empty-sub">
        {"One at a time or all in one sentence — it's the same meal either way. Nothing counts until you log it."}
      </p>
      {onExpressSingle && (
        <button type="button" className="ms-express" onClick={onExpressSingle}>
          {"Just one thing and you're done? "}
          <b>Log a single food instead ›</b>
        </button>
      )}
    </div>
  );
}
