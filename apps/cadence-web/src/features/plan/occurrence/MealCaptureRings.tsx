import { NutritionRing } from '../../nutrition/NutritionRing.tsx';
import type { MealMacros, NutritionDayData } from '../../../lib/api.ts';
import { fmtKcal } from './mealPlate.ts';

const MACRO_BARS: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; label: string; color: string }> = [
  { key: 'protein_g', label: 'PROTEIN', color: 'oklch(52% 0.09 152)' },
  { key: 'carbs_g', label: 'CARBS', color: 'oklch(62% 0.08 250)' },
  { key: 'fat_g', label: 'FAT', color: 'oklch(64% 0.14 268)' },
];

const KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

/**
 * What the day has actually LOGGED. The server's day counts an open draft toward its totals
 * (the 1b "open fork"); the owner's ruling for this surface (2026-09-07) is the opposite —
 * "only show what's logged" — so open meals are taken back out here. Nothing in the cart, and
 * nothing still open, moves these numbers until it is logged.
 */
function loggedTotals(day: NutritionDayData | null | undefined): MealMacros {
  const out: MealMacros = { ...(day?.totals ?? {}) };
  for (const m of day?.meals ?? []) {
    if (m.state !== 'open' || m.provisional) continue;
    for (const k of KEYS) {
      const v = m.macros?.[k];
      if (typeof v === 'number' && typeof out[k] === 'number') out[k] = Math.max(0, (out[k] as number) - v);
    }
  }
  return out;
}

/**
 * Today so far, in the capture's own context: one number in the ring — what is left today — and
 * the three macro bars beside it, centred against it. It used to carry two kcal figures ("2,027
 * left after this" in the ring, "2,150 kcal left today" beside it) that disagreed because one
 * counted the cart and the other did not (owner, on device, 2026-09-07). Now there is one, it
 * counts logged food only, and the cart's own total lives in the meal's footer where the foods
 * are all together.
 *
 * The ring is also the door out to the whole day: a capture answers "what did I just eat", and
 * the question that raises next — "so where does that leave me" — lives in the Food screen,
 * which had no way in from here at all (owner device report, 2026-08-20). `onOpenFood` is
 * optional because not every host can route there; without it the ring is plain.
 */
export function MealCaptureRings({
  day,
  onOpenFood,
}: {
  day: NutritionDayData | null | undefined;
  onOpenFood?: () => void;
}) {
  const logged = loggedTotals(day);
  const target = day?.targets ?? null;
  const loggedKcal = logged.kcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const left = targetKcal != null ? targetKcal - loggedKcal : null;

  const ring = (
    <NutritionRing logged={loggedKcal} target={targetKcal} size={78} stroke={13} className="mc-ring">
      {left != null ? (
        <>
          <b>{fmtKcal(Math.abs(left))}</b>
          <span>{left < 0 ? 'KCAL OVER' : 'LEFT TODAY'}</span>
        </>
      ) : (
        <>
          <b>{fmtKcal(loggedKcal)}</b>
          <span>SO FAR</span>
        </>
      )}
    </NutritionRing>
  );

  return (
    <div className="mc-rings">
      {onOpenFood ? (
        <button type="button" className="mc-ringbtn" onClick={onOpenFood} aria-label="Open your whole day in Food">
          {ring}
        </button>
      ) : (
        ring
      )}
      <div className="mc-rings-r">
        <div className="mc-bars">
          {MACRO_BARS.map((b) => {
            const e = logged[b.key] ?? 0;
            const t = target?.[b.key] ?? null;
            const pct = t && t > 0 ? Math.min(100, (e / t) * 100) : 0;
            return (
              <div className="mc-bar" key={b.key}>
                <span className="mc-bar-l">{b.label}</span>
                <div className="mc-bar-track">
                  <div className="mc-bar-fill" style={{ width: `${pct}%`, background: b.color }} />
                </div>
                <span className="mc-bar-v">
                  {Math.round(e)}
                  {t != null ? ` / ${Math.round(t)}g` : 'g'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
