import { useState } from 'react';
import type { ClockUnit } from '@cadence/shared';
import type { Forecast, WeatherNow } from '../../lib/api.ts';
import { DayList, HourlyStrip } from './ForecastPanels.tsx';
import { FORECAST_TABS, localDateIn, type ForecastTab } from './forecastCopy.ts';
import { cap, weatherSentence, wxEmoji } from './weatherCopy.ts';

/**
 * The forecast sheet behind the header's weather chip (frame 2a).
 *
 * It opens on the forecast: the current reading as its headline, then three tabs — the hours
 * ahead, seven days, fourteen — over a series the header read WITH the sky, so nothing here waits
 * on a request. It used to open on two actions (CHANGE and Apple's link) and no forecast at all,
 * because nothing supplied the hours; `/me/forecast` does now.
 *
 * What stays, and where. The city and CHANGE keep their line under the headline, quieter: what
 * CHANGE changes is where you ARE, which is the one thing a weather sheet has an opinion about,
 * and this is its only door (A21). Apple's legal link keeps the last line — the trademark sits on
 * Plan itself, but Apple asks for the data-source link wherever WeatherKit data is shown, and the
 * forecast is WeatherKit data. Both are driven by the readings' own `attribution`, so an
 * OpenWeatherMap series renders neither.
 *
 * `forecast` is `undefined` while it is still on its way (a first launch, or a place that just
 * moved) and `available:false` when there is none — the sheet then shows the reading alone and
 * never a made-up week. The tabs are always the same three: a provider that sees less than a tab
 * promises shows what it has, and the coach says how far she got.
 */
export function WeatherSheet({
  weather,
  city,
  night,
  forecast,
  clock,
  now = new Date(),
  onHereNow,
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
  /** "I'm here now" — moves the transient position the header draws, never home (A21). */
  onHereNow: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ForecastTab>('hourly');
  const conditions = weather.conditions ?? '';
  const temp = weather.temp_c == null ? '' : `${weather.temp_c}°`;
  const series = forecast?.available ? forecast : null;
  const hours = series?.hourly ?? [];
  const days = series?.daily ?? [];
  const hasSeries = hours.length > 0 || days.length > 0;
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
            <button className="thead-loc" type="button" onClick={onHereNow}>
              <span aria-hidden>📍</span> {city ?? 'Weather nearby'} <i>· CHANGE</i>
            </button>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          {hasSeries ? (
            <>
              <div className="wxsheet-seg" role="tablist" aria-label="Forecast range">
                {FORECAST_TABS.map((t) => (
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
              {tab === 'hourly' ? (
                <HourlyStrip hours={hours} tz={series?.timezone} clock={clock} now={now} />
              ) : (
                <DayList
                  days={days}
                  promised={tab === 'week' ? 7 : 14}
                  todayIso={todayIso}
                  label={tab === 'week' ? '7 days' : '14 days'}
                />
              )}
            </>
          ) : forecast === undefined ? (
            <div className="sheet-loading">
              <span className="sheet-loading-t">Reading the days ahead…</span>
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
