import { useEffect, useState } from 'react';
import { getUsualAtSlot, type MealKind, type UsualAtSlot } from '../../lib/api.ts';

/**
 * What they usually have AT this slot, counted (design 05a). Empty is the honest answer for a new
 * user and for a slot they have never logged, so there is no loading state to show — the section
 * simply isn't there until there is a habit to show.
 */
export function useUsualAtSlot(meal: MealKind, limit = 6): UsualAtSlot[] {
  const [usual, setUsual] = useState<UsualAtSlot[]>([]);
  useEffect(() => {
    let alive = true;
    void getUsualAtSlot(meal, limit).then((u) => {
      if (alive) setUsual(u);
    });
    return () => {
      alive = false;
    };
  }, [meal, limit]);
  return usual;
}
