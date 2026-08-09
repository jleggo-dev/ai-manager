import { getUser } from '../repos/users.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { getDailyCheckin } from '../repos/coach-moments.ts';
import { localDateIso } from './weather/weather-map.ts';

/**
 * Should Cadence ask about yesterday?
 *
 * The gate is four ANDs, and each one exists to stop a specific way this becomes annoying:
 *
 *  • Once per local day        — keyed on the user's own date, so a 1am scroll isn't "tomorrow".
 *  • Not before 4am           — someone still awake at 3am is finishing yesterday, not starting today.
 *  • Yesterday had a plan     — with nothing scheduled there is nothing to ask about, and asking
 *                               anyway is the app talking to fill silence.
 *  • Something actually happened to it — if every planned item is still `pending`, the day never
 *                               resolved (it may simply not have synced), and "how did yesterday
 *                               go?" against an untouched day reads as an accusation.
 *
 * Answering, or tapping "Not now", both write today's row — so this returns false for the rest of
 * the day either way, and "Not now" never compounds into never being asked again.
 */

/** Wall-clock hour in the user's own timezone. */
function localHour(now: Date, timezone: string | null | undefined): number {
  const tz = timezone?.trim();
  if (!tz) return now.getUTCHours();
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now);
    return Number(h);
  } catch {
    return now.getUTCHours();
  }
}

function previousDay(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`); // midday anchor — immune to DST edges
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const EARLIEST_HOUR = 4;

export interface DailyCheckinStatus {
  /** Whether the moment should be offered right now. */
  due: boolean;
  /** The user's local date this decision belongs to — the key the client answers against. */
  date: string;
  /** Yesterday, so the client can name it without re-deriving the timezone. */
  reviewing: string | null;
}

export async function getDailyCheckinStatus(userId: string, now = new Date()): Promise<DailyCheckinStatus> {
  const user = await getUser(userId);
  const tz = user?.timezone ?? null;
  const today = localDateIso(now, tz);

  if (localHour(now, tz) < EARLIEST_HOUR) return { due: false, date: today, reviewing: null };

  // Already answered or dismissed today.
  if (await getDailyCheckin(userId, today)) return { due: false, date: today, reviewing: null };

  const yesterday = previousDay(today);
  const planned = await listOccurrences(userId, yesterday, yesterday);
  if (planned.length === 0) return { due: false, date: today, reviewing: null };

  // Every item still pending → the day never resolved; there is nothing honest to ask about.
  if (planned.every((o) => o.status === 'pending')) return { due: false, date: today, reviewing: null };

  return { due: true, date: today, reviewing: yesterday };
}
