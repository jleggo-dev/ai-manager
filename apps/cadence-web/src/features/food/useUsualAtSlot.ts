import { useQuery } from '@tanstack/react-query';
import { getUsualAtSlot, type MealKind, type UsualAtSlot } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query/keys.ts';

/**
 * How many rows the meal screen asks for. It used to be six, and the owner's own breakfast list
 * ran out after four rows (on device, 2026-09-07: "the list is too short — I should be able to
 * scroll a few pages"). Forty is a few pages of a phone; the server caps above it.
 */
export const USUAL_AT_SLOT_LIMIT = 40;

/**
 * What they usually have AT this slot, counted (design 05a). Empty is the honest answer for a new
 * user and for a slot they have never logged, so there is no loading state to show — the section
 * simply isn't there until there is a habit to show.
 *
 * Through the query cache since 2026-09-07 so the list paints from last launch's snapshot: it is
 * the first thing under the doors when a meal opens, and it used to arrive a round trip late.
 */
export function useUsualAtSlot(meal: MealKind, limit = USUAL_AT_SLOT_LIMIT): UsualAtSlot[] {
  const { data } = useQuery({
    queryKey: queryKeys.usualAtSlot.scoped(meal, limit),
    queryFn: () => getUsualAtSlot(meal, limit),
  });
  return data ?? [];
}
