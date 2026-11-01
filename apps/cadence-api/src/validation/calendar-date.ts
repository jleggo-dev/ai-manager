import { z } from 'zod';
import { isCalendarDate } from '@cadence/shared';

/**
 * A `YYYY-MM-DD` that names a real day — the one zod schema every body, query and draft route
 * uses for a date. `.regex(/^\d{4}-\d{2}-\d{2}$/)` accepted "2026-02-30", and the `::date` cast
 * then failed in SQL as a 500; this refuses it at the door as a 400 with the site's own message.
 *
 * The message covers a non-string too ("date must be YYYY-MM-DD" says it better than zod's
 * "Expected string, received number"). Chain `.optional()` as before.
 */
export const calendarDate = (message = 'date must be YYYY-MM-DD') =>
  z.string({ message }).refine((s) => isCalendarDate(s), { message });
