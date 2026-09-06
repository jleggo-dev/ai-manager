/**
 * An empty breakfast (canvas 1b B1) — "the empty state is the whole argument": a titled meal
 * with a place for things to go, your usual bowl as one tap, and the doors as a row of small
 * buttons rather than the main event. The one-food express lane and the way back out to the
 * greater Food screen (owner constraint) both live here.
 */
import type { MealKind } from '@cadence/shared';
import { useRecipes } from '../../../lib/query/index.ts';
import { CameraIcon, MicIcon, ScanIcon, SearchIcon } from '../captureIcons.tsx';
import { FoodPickHead, FoodPickRow } from '../FoodPickRow.tsx';
import { useUsualAtSlot } from '../useUsualAtSlot.ts';
import { fmtKcal } from '../bracket/copy.ts';

export interface YoursRow {
  recipe_id: string;
  name: string;
  sub?: string;
  kcal?: number;
}

/** Saved one-portion recipes ("what a person would call a saved meal") + the slot's habits. */
function useStartFromYours(kind: MealKind): YoursRow[] {
  const usual = useUsualAtSlot(kind);
  // Shared with the cookbook shelf and the kitchen (lib/query/useFoodData.ts) — one read, and the
  // rows are here as the empty state draws rather than a round trip into it.
  const { data } = useRecipes(true);
  const saved = (data?.recipes ?? []).filter((rec) => rec.servings === 1);
  const rows: YoursRow[] = usual
    .filter((u) => u.kind === 'recipe')
    .map((u) => ({ recipe_id: u.id, name: u.name, sub: u.serving_label ?? undefined, kcal: u.kcal ?? undefined }));
  for (const rec of saved) {
    if (rows.some((r) => r.recipe_id === rec.recipe_id)) continue;
    rows.push({
      recipe_id: rec.recipe_id,
      name: rec.name,
      sub:
        rec.ingredients
          .map((i) => i.name.split(',')[0])
          .slice(0, 4)
          .join(' · ') || undefined,
      kcal: typeof rec.macros_per_serving.kcal === 'number' ? rec.macros_per_serving.kcal : undefined,
    });
  }
  return rows.slice(0, 4);
}

export function MealEmptyState({
  kind,
  busy,
  onSearch,
  onVoice,
  onPhoto,
  onBarcode,
  onRecents,
  onMyMeals,
  onAddRecipe,
  onExpressSingle,
  onOpenDay,
}: {
  kind: MealKind;
  busy?: boolean;
  onSearch: () => void;
  /** The mic on the field — the chat door, opened already listening (canvas 1b B1). */
  onVoice: () => void;
  onPhoto: (file: File | undefined) => void;
  onBarcode: () => void;
  onRecents: () => void;
  onMyMeals: () => void;
  onAddRecipe: (recipeId: string) => void;
  onExpressSingle: () => void;
  onOpenDay?: () => void;
}) {
  const yours = useStartFromYours(kind);
  return (
    <div className="ms-empty">
      <div className="ms-empty-mark" aria-hidden="true">
        ◌
      </div>
      <h3>Add everything you had</h3>
      <p className="ms-empty-sub">
        {"One at a time or all in one sentence — it's the same meal either way. Nothing counts until you close it."}
      </p>
      {/* The field keeps both halves of its own promise: tapping the words opens search, and the
          mic beside them opens the same chat door already listening. It shipped as a bare text
          button, so "or just describe it" had nothing behind it (canvas 1b B1 draws the row). */}
      <div className="ms-field">
        <button type="button" className="ms-field-open" onClick={onSearch}>
          <SearchIcon />
          <span>Search, or just describe it…</span>
        </button>
        <button type="button" className="ms-field-mic" aria-label="Say what you had" disabled={busy} onClick={onVoice}>
          <MicIcon />
        </button>
      </div>
      {/* Small buttons, not the main event (1b B1). Picture and Barcode are the capture set's
          own drawings — the canvas uses the same path data, so the ◲ ▥ that shipped were the
          deviation. Recents and My meals stay glyphs because that is what the canvas draws:
          there is no clock or shelf in the capture set to be consistent WITH. */}
      <div className="ms-doors">
        <label className="ms-door">
          <i aria-hidden="true" className="ms-door-picture">
            <CameraIcon />
          </i>
          Picture
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" className="ms-door" disabled={busy} onClick={onBarcode}>
          <i aria-hidden="true" className="ms-door-barcode">
            <ScanIcon />
          </i>
          Barcode
        </button>
        <button type="button" className="ms-door" disabled={busy} onClick={onRecents}>
          <i aria-hidden="true" className="ms-door-g ms-door-recents">
            ◷
          </i>
          Recents
        </button>
        <button type="button" className="ms-door" disabled={busy} onClick={onMyMeals}>
          <i aria-hidden="true" className="ms-door-g ms-door-mine">
            ◍
          </i>
          My meals
        </button>
      </div>
      {yours.length > 0 && (
        <div>
          <FoodPickHead label="START FROM ONE OF YOURS" />
          {yours.map((r) => (
            <FoodPickRow
              key={r.recipe_id}
              name={r.name}
              sub={r.sub}
              kcal={r.kcal != null ? `${fmtKcal(r.kcal)} kcal` : undefined}
              busy={busy}
              onAdd={() => onAddRecipe(r.recipe_id)}
            />
          ))}
        </div>
      )}
      <button type="button" className="ms-express" onClick={onExpressSingle}>
        {"Just one thing and you're done? "}
        <b>Log a single food instead ›</b>
      </button>
      {onOpenDay && (
        <button type="button" className="ms-day-link" onClick={onOpenDay}>
          Your whole day ›
        </button>
      )}
    </div>
  );
}
