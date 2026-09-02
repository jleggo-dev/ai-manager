/**
 * The meal's ⋯ (canvas 1b B3) — where "save as" lives once the meal has proved itself, plus
 * the boring twins nobody should need a gesture for. Rows verbatim from the frame. The word
 * "recipe" appears here only where the canvas itself writes it.
 */

function Row({
  icon,
  title,
  sub,
  disabled,
  onPress,
}: {
  icon: string;
  title: string;
  sub?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className="mb-menu-row" disabled={disabled} onClick={onPress}>
      <span className="mb-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mb-menu-words">
        <span className="mb-menu-title">{title}</span>
        {sub && <span className="mb-menu-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function MealMenu({
  canSave,
  onSaveMeal,
  onSaveRecipe,
  onRename,
  onCloseNow,
  onClose,
}: {
  /** Save-as needs at least a bracketable meal — two things, or an existing bracket. */
  canSave: boolean;
  onSaveMeal: () => void;
  onSaveRecipe: () => void;
  onRename: () => void;
  onCloseNow: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet" role="dialog" aria-label="This meal" onClick={(e) => e.stopPropagation()}>
        <div className="ms-sheet-grab" aria-hidden="true" />
        <div className="ms-sheet-k">THIS MEAL</div>
        <div className="mb-menu">
          <Row icon="◍" title="Save as a meal" sub="one row, one tap, tomorrow" disabled={!canSave} onPress={onSaveMeal} />
          <Row
            icon="▤"
            title="Save as a recipe"
            sub="if it makes more than one portion"
            disabled={!canSave}
            onPress={onSaveRecipe}
          />
          <Row icon="✎" title="Rename this meal" disabled={!canSave} onPress={onRename} />
          <Row icon="◷" title="Close it now" sub="anything later starts a new meal" onPress={onCloseNow} />
        </div>
      </div>
    </div>
  );
}
