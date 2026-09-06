import type { ClockUnit } from '@cadence/shared';
import type { ForecastDay, ForecastHour } from '../../lib/api.ts';
import { dayLabel, horizonLine, hourLabel, localHourIn, precipLabel } from './forecastCopy.ts';
import { isNightHour } from './skyTint.ts';
import { cap, wxEmoji } from './weatherCopy.ts';

/**
 * The two panels behind the weather sheet's tabs — a strip of hours, and a list of days.
 *
 * Both are drawn from what the provider actually said. The strip is a day of entries (true hours
 * from Apple, three-hourly slots from OpenWeatherMap, labelled as they fall); the list is as long
 * as the provider sees, with the coach's one line underneath when that is shorter than the tab.
 */

/** The hours ahead, scrolling sideways. Each hour's glyph knows whether it is after dark. */
export function HourlyStrip({
  hours,
  tz,
  clock,
  now,
}: {
  hours: ForecastHour[];
  tz: string | null | undefined;
  clock: ClockUnit;
  now: Date;
}) {
  return (
    <div className="wxsheet-hours" role="tabpanel" aria-label="Hourly">
      {hours.map((h) => {
        const precip = precipLabel(h.precip_chance);
        return (
          <div className="wxsheet-hour" key={h.at} title={cap(h.conditions)}>
            <span className="wxsheet-at">{hourLabel(h.at, tz, clock, now)}</span>
            <span className="wxsheet-icon" aria-hidden>
              {wxEmoji(h.conditions, isNightHour(localHourIn(new Date(h.at), tz)))}
            </span>
            <span className="wxsheet-temp">{h.temp_c}°</span>
            <span className="wxsheet-precip">{precip ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The days ahead, one row each: when, the sky, the chance of rain, and the low to the high. */
export function DayList({
  days,
  promised,
  todayIso,
  label,
}: {
  days: ForecastDay[];
  /** How many rows the tab promised (7 or 14) — what the horizon line measures against. */
  promised: number;
  todayIso: string;
  label: string;
}) {
  const rows = days.slice(0, promised);
  const horizon = horizonLine(rows.length, promised);
  return (
    <div role="tabpanel" aria-label={label}>
      <ul className="wxsheet-days">
        {rows.map((d) => {
          const precip = precipLabel(d.precip_chance);
          return (
            <li className="wxsheet-day" key={d.date}>
              <span className="wxsheet-day-when">{dayLabel(d.date, todayIso)}</span>
              <span className="wxsheet-icon" aria-hidden>
                {wxEmoji(d.conditions)}
              </span>
              <span className="wxsheet-day-cond">{cap(d.conditions)}</span>
              <span className="wxsheet-day-precip">{precip ?? ''}</span>
              <span className="wxsheet-day-range">
                <i>{d.low_c}°</i> {d.high_c}°
              </span>
            </li>
          );
        })}
      </ul>
      {horizon && <p className="wxsheet-horizon">{horizon}</p>}
    </div>
  );
}
