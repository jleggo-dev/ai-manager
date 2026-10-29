/**
 * The amount sheet (quick log 1b) — only when the default isn't right. Hold a tile and this
 * opens over the shelf: the food's name and what the chosen amount is worth, the chips
 * `servingChips` derives (volume leads for produce, printed weight for brands), a stepper for
 * anything between them, "Other…" into the food's full serving list, and Add. Most foods never
 * open it; that is the point of the chips.
 *
 * The food itself is read on open — the shelf's rows carry an id, a name and a number, not the
 * servings — so the sheet paints with the name at once and the chips a round trip later.
 */
import { useEffect, useState } from 'react';
import { macrosForLog, type Food } from '@cadence/shared';
import { getFoodById } from '../../../lib/api.ts';
import { fmtKcal } from '../bracket/copy.ts';
import { UnitSheet } from '../UnitSheet.tsx';
import { chipMatches, scaleServingLabel, servingChips } from './servingChips.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const STEP = 0.25;

export interface Portion {
  servingIndex: number;
  quantity: number;
}

export function AmountSheet({
  foodId,
  name,
  busy,
  onAdd,
  onClose,
}: {
  foodId: string;
  name: string;
  busy?: boolean;
  onAdd: (p: Portion) => void;
  onClose: () => void;
}) {
  const [food, setFood] = useState<Food | null>(null);
  const [failed, setFailed] = useState(false);
  const [portion, setPortion] = useState<Portion | null>(null);
  const [unitOpen, setUnitOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void getFoodById(foodId).then((r) => {
      if (!alive) return;
      if (r.status === 'ok' && r.food.servings.length) {
        const chips = servingChips(r.food);
        // The "one of" chip is the default — the lead serving at ×1, which is what a tap adds
        // when the picker leads where the default serving does.
        const one = chips.find((c) => c.quantity === 1) ?? chips[0];
        setFood(r.food);
        setPortion(one ? { servingIndex: one.servingIndex, quantity: one.quantity } : { servingIndex: 0, quantity: 1 });
      } else {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [foodId]);

  const chips = food ? servingChips(food) : [];
  const serving = food && portion ? food.servings[portion.servingIndex] : null;
  const kcal = food && portion ? macrosForLog(food, portion).kcal : undefined;
  const amountLabel = serving && portion ? scaleServingLabel(serving.label, portion.quantity) : '';

  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div
        className="ms-sheet ms-amount"
        role="dialog"
        aria-label={`How much ${name}?`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ms-sheet-grab" aria-hidden="true" />
        <div className="ms-amount-head">
          <b>{name}</b>
          <span className="ms-amount-kcal">
            {fmtKcal(kcal)} <i>KCAL</i>
          </span>
        </div>
        {failed ? (
          <p className="ms-amount-note">{"Couldn't open the amounts just now — a tap still adds one serving."}</p>
        ) : !food || !portion ? (
          <div className="ms-empty-mark" aria-hidden="true">
            ◌
          </div>
        ) : (
          <>
            <div className="ms-amount-chips">
              {chips.map((c) => (
                <button
                  type="button"
                  key={`${c.servingIndex}-${c.quantity}`}
                  className={`ms-amount-chip${chipMatches(c, portion.servingIndex, portion.quantity) ? ' is-on' : ''}`}
                  onClick={() => setPortion({ servingIndex: c.servingIndex, quantity: c.quantity })}
                >
                  {c.label}
                </button>
              ))}
              {food.servings.length > 1 && (
                <button type="button" className="ms-amount-chip" onClick={() => setUnitOpen(true)}>
                  Other…
                </button>
              )}
            </div>
            <div className="ms-amount-row">
              <div className="ms-amount-step">
                <button
                  type="button"
                  aria-label={`Less ${name}`}
                  disabled={portion.quantity <= STEP}
                  onClick={() => setPortion({ ...portion, quantity: Math.max(STEP, round2(portion.quantity - STEP)) })}
                >
                  −
                </button>
                <b>{amountLabel}</b>
                <button
                  type="button"
                  aria-label={`More ${name}`}
                  onClick={() => setPortion({ ...portion, quantity: round2(portion.quantity + STEP) })}
                >
                  ＋
                </button>
              </div>
              <button type="button" className="ms-amount-add" disabled={busy} onClick={() => onAdd(portion)}>
                Add
              </button>
            </div>
          </>
        )}
        {unitOpen && food && portion && (
          <UnitSheet
            food={food}
            selected={portion.servingIndex}
            onPick={(i) => {
              setPortion({ servingIndex: i, quantity: 1 });
              setUnitOpen(false);
            }}
            onClose={() => setUnitOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The recipe's twin — a dish is counted in servings, so the only question is how many. A
 * leftover caps at what is left of the batch.
 */
export function ServingsSheet({
  name,
  sub,
  kcalPerServing,
  max,
  busy,
  onAdd,
  onClose,
}: {
  name: string;
  sub?: string;
  kcalPerServing: number | null;
  /** The most that can be added — a leftover's remaining portions; absent means no cap. */
  max?: number;
  busy?: boolean;
  onAdd: (servings: number) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState(1);
  const cap = max ?? 12;
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div
        className="ms-sheet ms-amount"
        role="dialog"
        aria-label={`How many servings of ${name}?`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ms-sheet-grab" aria-hidden="true" />
        <div className="ms-amount-head">
          <b>{name}</b>
          <span className="ms-amount-kcal">
            {fmtKcal(kcalPerServing != null ? kcalPerServing * n : undefined)} <i>KCAL</i>
          </span>
        </div>
        {sub && <p className="ms-amount-note">{sub}</p>}
        <div className="ms-amount-row">
          <div className="ms-amount-step">
            <button type="button" aria-label="Fewer servings" disabled={n <= 1} onClick={() => setN(n - 1)}>
              −
            </button>
            <b>{n === 1 ? '1 serving' : `${n} servings`}</b>
            <button type="button" aria-label="More servings" disabled={n >= cap} onClick={() => setN(n + 1)}>
              ＋
            </button>
          </div>
          <button type="button" className="ms-amount-add" disabled={busy} onClick={() => onAdd(n)}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
