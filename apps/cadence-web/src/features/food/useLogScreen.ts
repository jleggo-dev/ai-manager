import { useEffect, useState } from 'react';
import { getFoodRecents, searchFoods, type FoodSummary, type MealKind, type UsualAtSlot } from '../../lib/api.ts';
import { usePlannedMeal, type PlannedMeal } from '../plan/occurrence/usePlannedMeal.ts';
import { useUsualAtSlot } from './useUsualAtSlot.ts';

/** Long enough that a fast typist doesn't fire six searches, short enough to feel like a list. */
const DEBOUNCE_MS = 250;

/** How many recents the list shows before "See all ›" (design 05b) opens the rest. */
const RECENTS_PREVIEW = 6;

export interface LogScreenData {
  planned: PlannedMeal | null;
  alsoThisWeek: PlannedMeal[];
  usual: UsualAtSlot[];
  /** What to render now — the first few, or all of them once "See all ›" is tapped. */
  recents: FoodSummary[];
  /** True when there are more on file than are showing, so the head can offer them. */
  hasMoreRecents: boolean;
  seeAllRecents: boolean;
  setSeeAllRecents: (v: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  results: FoodSummary[];
  searching: boolean;
}

/**
 * Everything the Log screen reads (design 05b): what the week planned, what they usually have at
 * this slot, what they ate lately, and the search that comes first on the screen. Search is the
 * only thing that talks to the network as they type, and it is debounced.
 */
export function useLogScreen(mealKind: MealKind, date: string): LogScreenData {
  const { planned, alsoThisWeek } = usePlannedMeal(mealKind, date);
  const usual = useUsualAtSlot(mealKind);
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [seeAllRecents, setSeeAllRecents] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    // Fetch the whole list, show a few. "See all ›" is then a reveal, not a second round trip.
    void getFoodRecents().then((r) => alive && setRecents(r.foods));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      void searchFoods(q).then((r) => {
        if (!alive) return;
        setResults(r.foods.slice(0, 12));
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  return {
    planned,
    alsoThisWeek,
    usual,
    recents: seeAllRecents ? recents : recents.slice(0, RECENTS_PREVIEW),
    hasMoreRecents: recents.length > RECENTS_PREVIEW,
    seeAllRecents,
    setSeeAllRecents,
    query,
    setQuery,
    results,
    searching,
  };
}
