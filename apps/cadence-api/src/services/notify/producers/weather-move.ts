import { nudgeCopy, parseTimeOfDay } from '@cadence/shared';
import { listWeatherMoveCandidates, type WeatherMoveCandidate } from '../../../repos/notify-candidates.ts';
import { getForecastSlots } from '../../weather/forecast.ts';
import { conditionWord, slotAt, slotConflicts, slotIsClear, type ForecastSlot } from '../../weather/forecast-slots.ts';
// From the pure map module, not the weather service barrel: the barrel loads config (and through
// it the DB URL), and a producer must be importable without either.
import { isOutdoorActivity } from '../../weather/weather-map.ts';
import type { NotifyRequest } from '../dispatch.ts';
import type { RegisteredProducer } from '../tick.ts';
import { localHour, zonedTimeToUtc } from './clock.ts';

/**
 * weather_move — tomorrow's forecast argues with a timed outdoor session.
 *
 * Pure service, zero judgment. It states a fact, names one concrete alternative with the numbers
 * behind it, and asks. It does not suggest going anyway, does not suggest skipping, and has no
 * opinion about running in rain — plenty of people like it, and a coach that implies otherwise is
 * substituting its taste for theirs.
 *
 * Every number in the message comes from a real forecast slot. If there is no drier slot on the
 * same day, the nudge is not sent: an offer to "move it to lunch" that was not checked against
 * lunch is worse than silence, because it is confidently wrong at the one moment the user is
 * making a plan around it.
 */

/** How far ahead a session must be to be worth a notification about, and how far is too far. */
const HORIZON_MS = 24 * 3600_000;

/** An alternative must be at least this far from the original, or it is the same session. */
const MIN_SHIFT_MS = 2 * 3600_000;

/** Plain words for a time of day, from the user's own clock. */
function slotLabel(hour: number): string {
  if (hour < 11) return 'the morning';
  if (hour < 14) return 'lunch';
  if (hour < 18) return 'the afternoon';
  return 'the evening';
}

/** The nearest clear slot on the SAME local day, at least MIN_SHIFT_MS from the session. */
function findAlternative(slots: ForecastSlot[], sessionAt: Date, timezone: string | null): ForecastSlot | null {
  const sessionDay = dayKey(sessionAt, timezone);
  if (!sessionDay) return null;
  let best: ForecastSlot | null = null;
  let bestGap = Infinity;
  for (const s of slots) {
    if (dayKey(s.at, timezone) !== sessionDay) continue; // moving it to another day is a replan
    const gap = Math.abs(s.at.getTime() - sessionAt.getTime());
    if (gap < MIN_SHIFT_MS || !slotIsClear(s)) continue;
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

function dayKey(at: Date, timezone: string | null): string | null {
  const tz = timezone?.trim();
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      at,
    );
  } catch {
    return null;
  }
}

/** One candidate → a notification, or null when any link in the chain does not hold. */
function toRequest(row: WeatherMoveCandidate, slots: ForecastSlot[], sessionAt: Date): NotifyRequest | null {
  const conflicting = slotAt(slots, sessionAt);
  if (!conflicting || !slotConflicts(conflicting)) return null;

  const alternative = findAlternative(slots, sessionAt, row.timezone);
  if (!alternative) return null;

  const whenHour = localHour(conflicting.at, row.timezone);
  const altHour = localHour(alternative.at, row.timezone);
  if (whenHour == null || altHour == null) return null;

  return {
    userId: row.user_id,
    kind: 'weather_move',
    target: row.occurrence_id,
    ...nudgeCopy({
      kind: 'weather_move',
      activityTitle: row.title,
      conditionLabel: conditionWord(conflicting.conditions),
      whenLabel: String(whenHour),
      altLabel: slotLabel(altHour),
      altConditionLabel: 'dry',
      altTempC: alternative.tempC,
      weekday: sessionAt.getUTCDay() + 1,
    }),
  };
}

async function produce(now: Date): Promise<NotifyRequest[]> {
  const rows = (await listWeatherMoveCandidates()).filter((r) => isOutdoorActivity(r.category, r.title));
  const out: NotifyRequest[] = [];
  // One forecast call per distinct location, reused across that user's sessions — the module's
  // own cache handles users who share a cell.
  for (const row of rows) {
    const time = parseTimeOfDay(row.time_of_day);
    const loc = row.home_location;
    if (!time || !loc) continue;

    const sessionAt = zonedTimeToUtc(row.date, time.hour, time.minute, row.timezone);
    if (!sessionAt) continue;
    const ahead = sessionAt.getTime() - now.getTime();
    if (ahead <= 0 || ahead > HORIZON_MS) continue; // already begun, or too far out to be news

    const request = toRequest(row, await getForecastSlots(loc.lat, loc.lon), sessionAt);
    if (request) out.push(request);
  }
  return out;
}

export const weatherMoveProducer: RegisteredProducer = { kind: 'weather_move', produce };
