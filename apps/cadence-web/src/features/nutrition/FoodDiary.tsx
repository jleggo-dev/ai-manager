import type { Meal, MealKind, NutritionDayData } from '../../lib/api.ts';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** The four standing slots, in eating order; drinks and one-offs get their own row only when present. */
const SLOTS: Array<{ kind: MealKind; label: string }> = [
  { kind: 'breakfast', label: 'Breakfast' },
  { kind: 'lunch', label: 'Lunch' },
  { kind: 'dinner', label: 'Dinner' },
  { kind: 'snack', label: 'Snacks' },
];
const EXTRA: Array<{ kind: MealKind; label: string }> = [
  { kind: 'drink', label: 'Drinks' },
  { kind: 'other', label: 'Other' },
];

function slotKcal(meals: Meal[]): { kcal: number; provisional: boolean } {
  let kcal = 0;
  let provisional = false;
  for (const m of meals) {
    kcal += m.macros?.kcal ?? 0;
    if (m.provisional) provisional = true;
  }
  return { kcal, provisional };
}

function mealName(m: Meal): string {
  return (
    m.items
      .map((i) => i.name)
      .filter(Boolean)
      .join(', ') ||
    m.raw_text ||
    (m.photo_url ? 'photo' : 'meal')
  );
}

/**
 * TODAY on the Food home (Food Journey 02): one row per meal slot — logged slots read their
 * kcal (a `~` while any of it is provisional), empty slots stay dashed with a Log chip, so the
 * day always shows its whole shape. Provisional meals list under their slot with the one-tap
 * confirm the old sheet had: nothing counts until the user says so, and the saying is one tap.
 */
export function FoodDiary({
  day,
  confirming,
  onConfirm,
  onLog,
}: {
  day: NutritionDayData | null;
  confirming: string | null;
  onConfirm: (logId: string) => void;
  onLog: (meal: MealKind) => void;
}) {
  const meals = day?.meals ?? [];
  const byKind = (kind: MealKind) => meals.filter((m) => m.meal === kind);
  const rows = [...SLOTS, ...EXTRA.filter(({ kind }) => byKind(kind).length > 0)];

  return (
    <div className="fh-diary">
      <div className="fh-sec-head">
        <span>TODAY</span>
      </div>
      {rows.map(({ kind, label }) => {
        const slot = byKind(kind);
        const { kcal, provisional } = slotKcal(slot);
        if (slot.length === 0) {
          return (
            <button key={kind} className="fh-slot is-open" onClick={() => onLog(kind)}>
              <span className="fh-slot-name">{label}</span>
              <span className="fh-slot-log">Log</span>
            </button>
          );
        }
        return (
          <div key={kind} className="fh-slot">
            <div className="fh-slot-row">
              <span className="fh-slot-name">
                {label}
                {provisional && <i className="fh-slot-prov">provisional</i>}
              </span>
              <span className="fh-slot-kcal">
                {provisional ? '~' : ''}
                {fmt(kcal)} kcal
              </span>
            </div>
            {slot
              .filter((m) => m.provisional)
              .map((m) => (
                <div className="fh-prov-row" key={m.log_id}>
                  <span className="fh-prov-name">{mealName(m)}</span>
                  <button
                    className="fh-confirm"
                    onClick={() => onConfirm(m.log_id)}
                    disabled={confirming === m.log_id}
                    aria-label="Confirm this meal's estimate"
                  >
                    {confirming === m.log_id ? '…' : '✓'}
                  </button>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
