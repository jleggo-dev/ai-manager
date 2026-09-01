import type { UserRoutineDay } from '../../lib/api.ts';

/** Monday-first, matching the week the plan draws (the contract's own ordering note in
 *  lib/api/user-routines.ts). Kept out of `ActivityScheduleSheet.tsx` so that file only exports
 *  the component (react-refresh/only-export-components). */
export const DAY_ORDER: UserRoutineDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABEL: Record<UserRoutineDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** "Tue & Fri" / "Mon, Wed & Fri" — shared by the schedule sheet and the row's own meta line so
 *  the two can never disagree about how a schedule reads. */
export function joinDays(days: UserRoutineDay[]): string {
  const labels = DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_LABEL[d]);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]!}`;
}
