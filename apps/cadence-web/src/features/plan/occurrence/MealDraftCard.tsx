import { useEffect, useState } from 'react';
import { macrosForLog, type Food, type FoodServing } from '@cadence/shared';
import type { MealKind, MealMacros } from '../../../lib/api.ts';
import { draftBrand, draftName, type FoodDraft } from '../../food/foodDraft.ts';
import type { DraftPortion } from './useMealCapture.ts';

/** The shape both draft kinds share for the serving math. */
function foodShape(draft: FoodDraft): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return draft.kind === 'candidate' ? draft.candidate : draft.food;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function macroLine(m: MealMacros): string {
  const bits: string[] = [];
  if (m.kcal != null) bits.push(`~${Math.round(m.kcal)} kcal`);
  const pcf = [
    m.protein_g != null ? `P${Math.round(m.protein_g)}` : '',
    m.carbs_g != null ? `C${Math.round(m.carbs_g)}` : '',
    m.fat_g != null ? `F${Math.round(m.fat_g)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (pcf) bits.push(pcf);
  return bits.join(' · ');
}

/** How a serving describes itself: "1 bowl · about 380g" from the recipe/food's own yield. */
function servingDetail(s: FoodServing | undefined): string {
  if (!s) return '';
  const g = s.amount_g && s.amount_g > 0 ? `about ${Math.round(s.amount_g)}g` : '';
  return [s.label, g].filter(Boolean).join(' · ');
}

/**
 * The resolver's answer — "Here's what I heard — confirm?" — with the portion right there. Serving is a
 * segmented pick (from the food's own `servings[]`); quantity is a ±0.25 stepper with the granularity
 * shown before the first tap; macros recompute live and feed the sheet's ring. Name/brand hide behind
 * "Not quite right?" because a saved food already knows them — only a new food needs editing. One tap
 * commits. `meal` comes from the task and is never asked (BRAND: warm, minimal).
 */
export function MealDraftCard({
  draft,
  meal,
  busy,
  err,
  plateMode = false,
  onMacros,
  onLog,
  onAddAnother,
  onBack,
}: {
  draft: FoodDraft;
  meal: MealKind;
  busy: boolean;
  err: string;
  /** True once a plate is being built — the primary action becomes "Add to plate" (design 2D). */
  plateMode?: boolean;
  onMacros: (m: MealMacros | null) => void;
  onLog: (portion: DraftPortion) => void;
  onAddAnother?: (portion: DraftPortion) => void;
  onBack: () => void;
}) {
  const shape = foodShape(draft);
  const [servingIndex, setServingIndex] = useState(() => {
    const fromResolver =
      typeof draft.servingIndex === 'number' && Number.isInteger(draft.servingIndex) ? draft.servingIndex : null;
    const idx = fromResolver ?? shape.default_serving ?? 0;
    return Math.max(0, Math.min(idx, shape.servings.length - 1));
  });
  const [quantity, setQuantity] = useState(() =>
    typeof draft.quantity === 'number' && Number.isFinite(draft.quantity) && draft.quantity > 0 ? draft.quantity : 1,
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(() => draftName(draft));
  const [brand, setBrand] = useState(() => draftBrand(draft) ?? '');

  // Live macros → the sheet's two-tone ring (pending arc) + this card's macro line.
  useEffect(() => {
    onMacros(macrosForLog(shape, { servingIndex, quantity }));
    return () => onMacros(null);
  }, [shape, servingIndex, quantity, onMacros]);

  const nutrients = macrosForLog(shape, { servingIndex, quantity });
  const isNew = draft.kind === 'candidate';

  return (
    <div className="mc-draft">
      <div className="mc-draft-t">Here&apos;s what I heard — confirm?</div>

      <div className="mc-draft-name">
        {editing ? (
          <div className="mc-edit">
            <input
              className="mc-edit-in"
              value={name}
              disabled={busy}
              aria-label="Food name"
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="mc-edit-in"
              value={brand}
              disabled={busy}
              placeholder="brand (optional)"
              aria-label="Brand"
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
        ) : (
          <>
            <b>{name}</b>
            <span>
              {servingDetail(shape.servings[servingIndex]) || (isNew ? 'new — I estimated it' : 'your saved food')}
            </span>
          </>
        )}
      </div>

      {shape.servings.length > 1 && (
        <div className="mc-field">
          <span className="mc-field-l">SERVING</span>
          <div className="mc-segs">
            {shape.servings.map((s, i) => (
              <button
                key={`${s.label}-${i}`}
                type="button"
                className={`mc-seg${i === servingIndex ? ' mc-seg-on' : ''}`}
                disabled={busy}
                onClick={() => setServingIndex(i)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mc-field">
        <span className="mc-field-l">HOW MANY</span>
        <div className="mc-qty">
          <button
            type="button"
            className="mc-step"
            aria-label="Less"
            disabled={busy || quantity <= 0.25}
            onClick={() => setQuantity((q) => Math.max(0.25, round2(q - 0.25)))}
          >
            −
          </button>
          <div className="mc-qty-v">
            <b>{quantity}</b>
            <span>±0.25</span>
          </div>
          <button
            type="button"
            className="mc-step"
            aria-label="More"
            disabled={busy}
            onClick={() => setQuantity((q) => round2(q + 0.25))}
          >
            +
          </button>
        </div>
      </div>

      <div className="mc-macros">{macroLine(nutrients)}</div>

      {isNew && (
        <button type="button" className="mc-editlink" disabled={busy} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done editing' : 'Not quite right? Edit the food ›'}
        </button>
      )}

      {err && <div className="mc-err">{err}</div>}

      <div className="mc-actions">
        {plateMode ? (
          <button
            type="button"
            className="mc-log"
            disabled={busy || (isNew && !name.trim())}
            onClick={() => onAddAnother?.({ servingIndex, quantity, meal, name, brand })}
          >
            {busy ? 'Adding…' : 'Add to plate'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="mc-log"
              disabled={busy || (isNew && !name.trim())}
              onClick={() => onLog({ servingIndex, quantity, meal, name, brand })}
            >
              {busy ? 'Writing it down…' : `Looks right — log ${meal}`}
            </button>
            {onAddAnother && (
              <button
                type="button"
                className="mc-addanother"
                disabled={busy || (isNew && !name.trim())}
                onClick={() => onAddAnother({ servingIndex, quantity, meal, name, brand })}
              >
                ＋ Add another thing
              </button>
            )}
          </>
        )}
        <button type="button" className="mc-back" disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
