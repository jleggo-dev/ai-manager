import { FoodPickHead, FoodPickRow } from './FoodPickRow.tsx';
import { LogWaterRow } from './LogWaterRow.tsx';
import { MethodTiles, type CaptureMethod } from './MethodTiles.tsx';
import { SearchIcon } from './captureIcons.tsx';
import type { LogScreenData } from './useLogScreen.ts';

const METHODS: CaptureMethod[] = ['chat', 'voice', 'picture', 'barcode'];

const kcal = (n: number | null, approx = false): string | undefined =>
  n == null ? undefined : `${approx ? '~' : ''}${Math.round(n)} kcal`;

/**
 * The body of the Log screen (design 05b) — six ways in, one screen: **search the list, then chat
 * / voice / picture / barcode, then quick add — planned meals first, recently eaten second.**
 * Water sits at the bottom because it is a tap, not a meal. Weight is not here at all; it belongs
 * to the weekly check-in.
 */
export function LogHome({
  data,
  waterMl,
  busy,
  onMethod,
  onPhoto,
  onPickFood,
  onLogRecipe,
  onWater,
  onDrink,
}: {
  data: LogScreenData;
  waterMl: number;
  busy: boolean;
  onMethod: (m: CaptureMethod) => void;
  onPhoto: (file: File | undefined) => void;
  onPickFood: (foodId: string) => void;
  onLogRecipe: (recipeId: string) => void;
  onWater: (nextMl: number) => void;
  onDrink: () => void;
}) {
  const { planned, alsoThisWeek, usual, recents, query, setQuery, results, searching } = data;
  const searchingNow = query.trim().length > 0;

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
          {results.map((f) => (
            <FoodPickRow
              key={f.food_id}
              name={f.name}
              sub={[f.brand, f.serving_label].filter(Boolean).join(' · ')}
              busy={busy}
              onAdd={() => onPickFood(f.food_id)}
            />
          ))}
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
                  sub={[u.serving_label, `logged ${u.count} time${u.count === 1 ? '' : 's'}`]
                    .filter(Boolean)
                    .join(' · ')}
                  kcal={kcal(u.kcal, u.kind === 'recipe')}
                  busy={busy}
                  onAdd={() => (u.kind === 'recipe' ? onLogRecipe(u.id) : onPickFood(u.id))}
                />
              ))}
            </>
          )}

          {recents.length > 0 && (
            <>
              <FoodPickHead label="RECENTLY EATEN" />
              {recents.map((f) => (
                <FoodPickRow
                  key={f.food_id}
                  name={f.name}
                  sub={[f.brand, f.serving_label].filter(Boolean).join(' · ')}
                  busy={busy}
                  onAdd={() => onPickFood(f.food_id)}
                />
              ))}
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
