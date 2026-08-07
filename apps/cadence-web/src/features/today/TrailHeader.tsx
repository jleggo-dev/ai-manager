import { useTodayHeader } from './useTodayHeader.ts';
import { Orb } from '../../components/Orb.tsx';

/**
 * The top header for the Today/Week surface (redesign) — pinned ABOVE the Today/Week switch.
 * Left: the coach mark. Middle: current weather (conditions · temp) with the detected city + a
 * CHANGE affordance beneath it; when there's no location yet it collapses to a plain "Set location"
 * prompt (never a fabricated place). Right: the streak and XP pills. Weather/location come from
 * `useTodayHeader` (auto-detect on first load); `streak`/`xp` are passed from the loaded plan.
 *
 * The avatar was a bespoke leaf glyph that appears in no brand document — a third mark competing
 * with the sunrise arch it sat beside, and now with Metronome Split. It is the shared `Orb`, so
 * the mark stays in exactly one file.
 */

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function wxEmoji(conditions: string): string {
  const c = conditions.toLowerCase();
  if (/snow|sleet/.test(c)) return '❄️';
  if (/thunder|storm/.test(c)) return '⛈️';
  if (/rain|drizzle|shower/.test(c)) return '🌧️';
  if (/cloud|overcast/.test(c)) return '☁️';
  if (/clear|sun/.test(c)) return '☀️';
  if (/fog|mist|haze|smoke/.test(c)) return '🌫️';
  return '🌤️';
}

export function TrailHeader({ streak, xp }: { streak: number; xp: number }) {
  const { weather, city, locating, requestLocation } = useTodayHeader();
  const wx = weather?.available ? weather : null;

  return (
    <div className="thead">
      <div className="thead-avatar" aria-hidden>
        <Orb />
      </div>

      <div className="thead-main">
        {wx ? (
          <>
            <b className="thead-wx">
              <span aria-hidden>{wxEmoji(wx.conditions ?? '')}</span> {cap(wx.conditions ?? '')} · {wx.temp_c}°
            </b>
            <button className="thead-loc" type="button" onClick={requestLocation}>
              <span aria-hidden>📍</span> {city ?? 'Weather nearby'} <i>· CHANGE</i>
            </button>
            {/* Licence obligation, not a credit line: Apple requires the Apple Weather mark plus a
                link to their data-source page wherever WeatherKit data is shown. Driven by the
                snapshot's own `attribution`, so an OWM fallback response renders nothing. */}
            {wx.attribution && (
              <a
                className="thead-attr"
                href={wx.attribution.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {wx.attribution.name}
              </a>
            )}
          </>
        ) : (
          <button className="thead-set" type="button" onClick={requestLocation}>
            <span aria-hidden>📍</span> {locating ? 'Locating…' : 'Set location for weather'}
          </button>
        )}
      </div>

      <div className="thead-pills">
        {streak > 0 && (
          <div className="thead-pill thead-streak" aria-label={`${streak} day streak`}>
            <span aria-hidden>🔥</span>
            {streak}
          </div>
        )}
        <div className="thead-pill thead-xp" aria-label={`${xp} points`}>
          <span aria-hidden>⭐</span>
          {xp}
        </div>
      </div>
    </div>
  );
}
