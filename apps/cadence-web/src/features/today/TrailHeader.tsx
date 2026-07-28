import { useTodayHeader } from './useTodayHeader.ts';

/**
 * The top header for the Today/Week surface (redesign) — pinned ABOVE the Today/Week switch.
 * Left: the leaf avatar. Middle: current weather (conditions · temp) with the detected city + a
 * CHANGE affordance beneath it; when there's no location yet it collapses to a plain "Set location"
 * prompt (never a fabricated place). Right: the streak and XP pills. Weather/location come from
 * `useTodayHeader` (auto-detect on first load); `streak`/`xp` are passed from the loaded plan.
 */

const LEAF =
  'M18 4C11 4 5.5 8 5.5 15c0 2 .6 3.6 1.4 4.8C9 15 12.5 12 18 11c-4.5 2-7.5 5.5-9 10.5.9.3 1.9.5 3 .5 7 0 11-6 11-13 0-2-.5-3.7-1.5-5H18z';

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
        <svg viewBox="0 0 24 24" width="21" height="21">
          <path d={LEAF} fill="#fff" />
        </svg>
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
