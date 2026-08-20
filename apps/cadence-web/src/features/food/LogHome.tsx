import { FoodPickHead, FoodPickRow } from './FoodPickRow.tsx';
import { LogWaterRow } from './LogWaterRow.tsx';
import { MethodTiles, type CaptureMethod } from './MethodTiles.tsx';
import { SearchIcon } from './captureIcons.tsx';
import type { FoodSummary } from '../../lib/api.ts';
import type { LogScreenData } from './useLogScreen.ts';

const METHODS: CaptureMethod[] = ['chat', 'voice', 'picture', 'barcode'];

const kcal = (n: number | null | undefined, approx = false): string | undefined =>
  n == null ? undefined : `${approx ? '~' : ''}${Math.round(n)} kcal`;

const times = (n: number | null | undefined): string | undefined =>
  n && n > 1 ? `logged ${n} times` : n === 1 ? 'logged once' : undefined;

/** Brand · serving · how often — the row's sub-line, with whatever of it is actually known. */
const subFor = (f: FoodSummary): string => [f.brand, f.serving_label, times(f.count)].filter(Boolean).join(' · ');

/**
 * The body of the Log screen (design 05b) — six ways in, one screen: **search the list, then chat
 * / voice / picture / barcode, then quick add — planned meals first, recently eaten second.**
 * Water sits at the bottom because it is a tap, not a meal. Weight is not here at all; it belongs
 * to the weekly check-in.
 *
 * Every saved-food row is two targets, per the design's ＋-per-row: the ＋ logs it at the amount
 * the row names, and the row opens the amount sheet. A ＋ only adds outright when the row can say
 * what it will add — a food with no calories on it falls back to opening, because a silent add of
 * numbers nobody has seen is not a confirm.
 */
export function LogHome({
  data,
  waterMl,
  busy,
  onMethod,
  onPhoto,
  onPickFood,
  onQuickAddFood,
  onLogRecipe,
  onWater,
  onDrink,
}: {
  data: LogScreenData;
  waterMl: number;
  busy: boolean;
  onMethod: (m: CaptureMethod) => void;
  onPhoto: (file: File | undefined) => void;
  /** Open a food so its own servings can answer the amount question (design 05d). */
  onPickFood: (foodId: string) => void;
  /** Log it as it stands — one tap, same amount, no re-parsing. */
  onQuickAddFood: (foodId: string) => void;
  onLogRecipe: (recipeId: string) => void;
  onWater: (nextMl: number) => void;
  onDrink: () => void;
}) {
  const { planned, alsoThisWeek, usual, recents, query, setQuery, results, searching } = data;
  const { hasMoreRecents, seeAllRecents, setSeeAllRecents } = data;
  const searchingNow = query.trim().length > 0;

  /** One food row: ＋ adds when the calories are on the row, opens the sheet when they aren't. */
  const foodRow = (f: FoodSummary) => (
    <FoodPickRow
      key={f.food_id}
      name={f.name}
      sub={subFor(f)}
      kcal={kcal(f.kcal)}
      busy={busy}
      onAdd={() => (f.kcal == null ? onPickFood(f.food_id) : onQuickAddFood(f.food_id))}
      onOpen={() => onPickFood(f.food_id)}
    />
  );

  return (
    <div className="fl-body">
      <div className="fl-search">
        <span className="fl-search-i" aria-hidden>
          <SearchIcon />
        </span>
        <input
          className="fl-search-in"
          value={query}
          aria-label="Search foods"
          placeholder="Search foods, brands, your meals…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchingNow && (
          <button type="button" className="fl-search-x" aria-label="Clear search" onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </div>

      {searchingNow ? (
        <div className="fl-results">
          {results.map(foodRow)}
          {!results.length && (
            <div className="fq-foot">
              {searching ? 'Looking…' : 'Nothing by that name — say it or photograph it instead.'}
            </div>
          )}
        </div>
      ) : (
        <>
          <MethodTiles methods={METHODS} variant="wide" disabled={busy} onPick={onMethod} onPhoto={onPhoto} />
          <p className="fl-note">
            Chat and voice are one screen — the mic is always there, Voice just opens it listening. Give an amount and I
            keep it; leave it out and I&apos;ll ask.
          </p>

          {(planned || alsoThisWeek.length > 0) && (
            <>
              <FoodPickHead label="QUICK ADD · PLANNED THIS WEEK" />
              {planned && (
                <FoodPickRow
                  name={planned.name}
                  sub="today’s plan · 1 serving"
                  tone="planned"
                  busy={busy}
                  onAdd={() => onLogRecipe(planned.recipe_id)}
                />
              )}
              {alsoThisWeek.map((m) => (
                <FoodPickRow
                  key={m.recipe_id}
                  name={m.name}
                  sub="also on your week"
                  busy={busy}
                  onAdd={() => onLogRecipe(m.recipe_id)}
                />
              ))}
            </>
          )}

          {usual.length > 0 && (
            <>
              <FoodPickHead label="YOU USUALLY HAVE AT THIS TIME" />
              {usual.map((u) => (
                <FoodPickRow
                  key={`${u.kind}-${u.id}`}
                  name={u.name}
                  sub={[u.serving_label, times(u.count)].filter(Boolean).join(' · ')}
                  kcal={kcal(u.kcal, u.kind === 'recipe')}
                  busy={busy}
                  onAdd={() =>
                    u.kind === 'recipe' ? onLogRecipe(u.id) : u.kcal == null ? onPickFood(u.id) : onQuickAddFood(u.id)
                  }
                  {...(u.kind === 'food' ? { onOpen: () => onPickFood(u.id) } : {})}
                />
              ))}
            </>
          )}

          {recents.length > 0 && (
            <>
              <FoodPickHead
                label="RECENTLY EATEN"
                action={
                  hasMoreRecents && (
                    <button type="button" className="fq-head-a" onClick={() => setSeeAllRecents(!seeAllRecents)}>
                      {seeAllRecents ? 'Show fewer' : 'See all ›'}
                    </button>
                  )
                }
              />
              {recents.map(foodRow)}
            </>
          )}

          <LogWaterRow ml={waterMl} onLogged={onWater} />
          <button type="button" className="fl-drink" onClick={onDrink}>
            Several things in one drink? ›
          </button>
        </>
      )}
    </div>
  );
}
