import type { WeatherNow } from '../../lib/api.ts';
import { cap, weatherSentence, wxEmoji } from './weatherCopy.ts';

/** One row of the short forecast: the hour, its glyph, its temperature — all already formatted. */
export type ForecastHour = { at: string; icon: string; temp: string };

/**
 * The forecast sheet behind the header's weather chip (frame 2a).
 *
 * The chip on Plan is now one line — glyph, condition, temperature — and everything that used to
 * crowd the header lives here instead: where you are, the affordance to change it, what the sky is
 * doing in the coach's own words, and Apple's legal link. Four lines of chrome became one line and
 * a door.
 *
 * **Attribution is split on purpose.** The Apple Weather trademark stays on Plan itself, under the
 * temperature, because Apple asks for the mark wherever WeatherKit data is shown and apps have been
 * rejected for keeping it one screen away. Only the *link* to their data-source page moves in here.
 * Both are driven by the snapshot's own `attribution`, so an OpenWeatherMap reading renders neither.
 *
 * `hours` is the short forecast. Nothing supplies it yet — `/me/weather` returns the current
 * reading and no series — and an absent forecast simply leaves the row out. It is never filled in
 * with the current reading repeated four times: an invented hour is worse than a missing one.
 */
export function WeatherSheet({
  weather,
  city,
  night,
  hours,
  onHereNow,
  onClose,
}: {
  weather: WeatherNow;
  city: string | null;
  /** Same clock signal the header's glyph uses, so the two show the same sky. */
  night: boolean;
  hours?: ForecastHour[];
  /** "I'm here now" — moves the transient position the header draws, never home (A21). */
  onHereNow: () => void;
  onClose: () => void;
}) {
  const conditions = weather.conditions ?? '';
  const temp = weather.temp_c == null ? '' : `${weather.temp_c}°`;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet wxsheet" role="dialog" aria-label="Weather">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b className="wxsheet-now">
              <span aria-hidden>{wxEmoji(conditions, night)}</span>{' '}
              {[cap(conditions), temp].filter(Boolean).join(' · ')}
            </b>
            {/* The city and CHANGE that used to sit under the header's weather line — same words,
                for a fraction of the screen. What it changes is where you ARE, which is the only
                thing a weather sheet has an opinion about; where you LIVE stays in Settings, with
                notification timing anchored to it (A21). */}
            <button className="thead-loc" type="button" onClick={onHereNow}>
              <span aria-hidden>📍</span> {city ?? 'Weather nearby'} <i>· CHANGE</i>
            </button>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          {hours && hours.length > 0 && (
            <div className="wxsheet-hours">
              {hours.slice(0, 4).map((h) => (
                <div className="wxsheet-hour" key={h.at}>
                  <span className="wxsheet-at">{h.at}</span>
                  <span className="wxsheet-icon" aria-hidden>
                    {h.icon}
                  </span>
                  <span className="wxsheet-temp">{h.temp}</span>
                </div>
              ))}
            </div>
          )}
          <p className="wxsheet-coach">{weatherSentence(weather)}</p>
          {weather.attribution && (
            <div className="wxsheet-attr">
              <span>{weather.attribution.name}</span>
              <a href={weather.attribution.url} target="_blank" rel="noreferrer">
                {'Other data sources ↗'}
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
