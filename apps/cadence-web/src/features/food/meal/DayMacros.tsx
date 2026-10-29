/**
 * The day, at the top of the quick log (2026-10-28) — the one thing the canvas kept from the
 * old drawer, with one change: the cart previews itself. The ring's pale arc and the hatched
 * tail on each bar are what THIS meal would add; the centre counts what would be left after
 * it. That is the only "advice" on the surface, and it is arithmetic.
 *
 * Logged means logged (owner, 2026-09-07 — "only show what's logged"): the server's day counts
 * an open draft toward its totals, so open meals are taken back out here before the cart is
 * added as a preview. Once this meal is logged, the day already carries it and the preview is
 * nothing.
 *
 * Bars are labelled P / C / F — on this surface only (owner, 2026-10-28: the full words are too
 * long beside three bars and a ring in a drawer's header). A scoped exception to BRAND.md's
 * no-abbreviation rule; the button's label still says the words in full for a screen reader.
 *
 * The card is also the quiet door out to the whole day when the host has one — the capture
 * answers "what did I just eat" and the next question lives in the Food screen.
 */
import type { Macros } from '@cadence/shared';
import type { NutritionDayData } from '../../../lib/api.ts';
import { NutritionRing } from '../../nutrition/NutritionRing.tsx';
import { fmtKcal } from '../bracket/copy.ts';
import { loggedTotals } from './loggedTotals.ts';

const BARS: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; label: string; name: string; color: string }> = [
  { key: 'protein_g', label: 'P', name: 'protein', color: 'oklch(62% 0.12 152)' },
  { key: 'carbs_g', label: 'C', name: 'carbs', color: 'oklch(64% 0.11 250)' },
  { key: 'fat_g', label: 'F', name: 'fat', color: 'oklch(66% 0.12 268)' },
];

const pct = (v: number, t: number) => Math.max(0, Math.min(100, (v / t) * 100));

export function DayMacros({
  day,
  cart,
  onOpenDay,
}: {
  day: NutritionDayData | null | undefined;
  /** What this meal would add — the draft's total while it is a cart, nothing once logged. */
  cart: Macros;
  onOpenDay?: () => void;
}) {
  const logged = loggedTotals(day);
  const target = day?.targets ?? null;
  const loggedKcal = logged.kcal ?? 0;
  const cartKcal = cart.kcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const left = targetKcal != null ? targetKcal - loggedKcal - cartKcal : null;

  const body = (
    <>
      <NutritionRing
        logged={loggedKcal}
        pending={cartKcal}
        target={targetKcal}
        size={66}
        stroke={7}
        className="ms-day-ring"
      >
        {left != null ? (
          <>
            <b>{fmtKcal(Math.abs(left))}</b>
            <span>{left < 0 ? 'OVER' : 'LEFT'}</span>
          </>
        ) : (
          <>
            <b>{fmtKcal(loggedKcal + cartKcal)}</b>
            <span>SO FAR</span>
          </>
        )}
      </NutritionRing>
      <div className="ms-day-bars">
        {BARS.map((b) => {
          const done = logged[b.key] ?? 0;
          const add = cart[b.key] ?? 0;
          const t = target?.[b.key] ?? null;
          const doneW = t && t > 0 ? pct(done, t) : 0;
          const addW = t && t > 0 ? Math.min(100 - doneW, pct(add, t)) : 0;
          return (
            <div className="ms-day-bar" key={b.key}>
              <span className="ms-day-bar-l" aria-label={b.name}>
                {b.label}
              </span>
              <div className="ms-day-bar-track">
                <div className="ms-day-bar-done" style={{ width: `${doneW}%`, background: b.color }} />
                <div
                  className="ms-day-bar-cart"
                  style={{
                    width: `${addW}%`,
                    backgroundImage: `repeating-linear-gradient(135deg, ${b.color} 0 3px, transparent 3px 6px)`,
                  }}
                />
              </div>
              <span className="ms-day-bar-v">
                {Math.round(done + add)}
                {t != null ? ` / ${Math.round(t)}` : 'g'}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );

  if (onOpenDay) {
    return (
      <button type="button" className="ms-day ms-day-btn" onClick={onOpenDay} aria-label="Open your whole day in Food">
        {body}
      </button>
    );
  }
  return <div className="ms-day">{body}</div>;
}
