import { useState } from 'react';
import type { ClockUnit } from '@cadence/shared';
import type { Forecast, WeatherNow } from '../../lib/api.ts';
import { DayList, HourlyStrip } from './ForecastPanels.tsx';
import { forecastTabs, localDateIn, type ForecastTab } from './forecastCopy.ts';
import { cap, weatherSentence, wxEmoji } from './weatherCopy.ts';
import { WeatherCityLine } from './WeatherCityLine.tsx';
import type { CitySetter } from './useCitySetter.ts';

/**
 * The forecast sheet behind the header's weather chip (frame 2a).
 *
 * It opens on the forecast: the current reading as its headline, then two tabs — the hours ahead,
 * and the days ahead — over a series the header read WITH the sky, so nothing here waits on a
 * request. It used to open on two actions (CHANGE and Apple's link) and no forecast at all,
 * because nothing supplied the hours; `/me/forecast` does now.
 *
 * The days tab is named for what it holds. It used to be two tabs, "7 days" and "14 days", over
 * a series that is ten from Apple and five from OpenWeatherMap — so the fourteen-day tab never
 * once showed fourteen, and the owner read it as a broken promise rather than a range
 * (2026-09-07). Now `forecastTabs` names the tab by the count and there is no tab at all when the
 * provider gave no days; with only hours to show, the strip stands alone and there is nothing to
 * switch between.
 *
 * The city keeps its line under the headline. With device location ON it is plain text: the
 * city is wherever the phone is. With device location OFF (a typed city, or none yet) it carries
 * CHANGE, which opens the city field right here — the same save Settings' Set flow runs
 * (`WeatherCityLine`, owner 2026-09-08). The old CHANGE said "I'm here now" and moved the
 * transient position, which changed nothing anyone could see — a door painted on a wall (owner,
 * 2026-09-07); this one changes the city. Apple's legal link keeps the last line — the
 * trademark sits on Plan itself, but Apple asks for the data-source link wherever WeatherKit
 * data is shown, and the forecast is WeatherKit data. It is driven by the readings' own
 * `attribution`, so an OpenWeatherMap series renders none.
 *
 * `forecast` is `undefined` while it is still on its way (a first launch, or a place that just
 * moved) and `available:false` when there is none — the sheet then shows the reading alone and
 * never a made-up week. A read that FAILED (`error`) is a third thing and is drawn as one: the
 * coach says she couldn't read the days ahead, and Try again asks (`onRetry`). A failed read
 * never displaces a series the sheet already had (lib/query/useAmbient.ts), so this line only
 * appears when there was nothing to keep.
 */
export function WeatherSheet({
  weather,
  city,
  night,
  forecast,
  clock,
  now = new Date(),
  citySetter,
  onRetry,
  onClose,
}: {
  weather: WeatherNow;
  city: string | null;
  /** Same clock signal the header's glyph uses, so the two show the same sky. */
  night: boolean;
  forecast: Forecast | null | undefined;
  /** How the strip writes its hours — the clock the person chose in Settings. */
  clock: ClockUnit;
  now?: Date;
  /** Offered when the place may be retyped here (device location off); absent = plain text. */
  citySetter?: CitySetter;
  /** Ask for the days ahead again, after a read that failed. */
  onRetry?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ForecastTab>('hourly');
  const conditions = weather.conditions ?? '';
  const temp = weather.temp_c == null ? '' : `${weather.temp_c}°`;
  const series = forecast?.available ? forecast : null;
  const hours = series?.hourly ?? [];
  const days = series?.daily ?? [];
  const hasSeries = hours.length > 0 || days.length > 0;
  const tabs = forecastTabs(days.length);
  const daysTab = tabs.find((t) => t.id === 'days');
  const todayIso = localDateIn(now, series?.timezone);
  // The licence follows the data on screen: the forecast's own source first, the reading's second.
  const attribution = series?.attribution ?? weather.attribution ?? null;

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
            <WeatherCityLine city={city} setter={citySetter} />
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          {hasSeries ? (
            <>
              {tabs.length > 1 && (
                <div className="wxsheet-seg" role="tablist" aria-label="Forecast range">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      className={tab === t.id ? 'is-on' : ''}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {tab === 'days' && daysTab?.days ? (
                <DayList days={days} promised={daysTab.days} todayIso={todayIso} label={daysTab.label} />
              ) : (
                <HourlyStrip hours={hours} tz={series?.timezone} clock={clock} now={now} />
              )}
            </>
          ) : forecast === undefined ? (
            <div className="sheet-loading">
              <span className="sheet-loading-t">Reading the days ahead…</span>
            </div>
          ) : forecast?.error ? (
            // The read failed — which is not the same as there being nothing to read, and used to
            // look exactly like it: the reading alone, no line, no door, for the rest of the hour
            // (owner, on device, 2026-09-09). Say so, and let a tap ask again.
            <div className="sheet-loading wxsheet-failed">
              <span className="sheet-loading-t">I couldn&rsquo;t read the days ahead.</span>
              {onRetry && (
                <button type="button" className="wxsheet-retry" onClick={onRetry}>
                  Try again
                </button>
              )}
            </div>
          ) : null}
          <p className="wxsheet-coach">{weatherSentence(weather)}</p>
          {attribution && (
            <div className="wxsheet-attr">
              <span>{attribution.name}</span>
              <a href={attribution.url} target="_blank" rel="noreferrer">
                {'Other data sources ↗'}
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
