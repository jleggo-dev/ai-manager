/**
 * Settings → Nutrition → Leftovers: how far back the meal drawer's Leftovers shelf looks (owner,
 * 2026-10-28 — seven days by default, the user's to change). One tap, saved on the spot; the
 * shelf reads the same value (features/food/meal/leftoverWindow.ts).
 */
import { LEFTOVER_WINDOW_CHOICES, setLeftoverWindow, useLeftoverWindow } from '../food/meal/leftoverWindow.ts';

export function SettingsLeftovers() {
  const days = useLeftoverWindow();
  return (
    <div className="se-card">
      <div className="se-card-t">Leftovers</div>
      <div className="se-card-sub">How far back the meal drawer looks for meals you&rsquo;ve logged.</div>
      <div className="se-seg" role="group" aria-label="Leftovers window">
        {LEFTOVER_WINDOW_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            className={n === days ? 'se-seg-b on' : 'se-seg-b'}
            aria-pressed={n === days}
            onClick={() => setLeftoverWindow(n)}
          >
            {n} days
          </button>
        ))}
      </div>
    </div>
  );
}
