import { useRef, useState } from 'react';
import { useTodayHeader } from './useTodayHeader.ts';
import { useClockUnit, useForecast } from '../../lib/query/index.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import { QuietHoursChip } from './QuietHoursChip.tsx';
import { WeatherSheet } from './WeatherSheet.tsx';
import { isNightHour, useSkyTint } from './skyTint.ts';
import { useQuietChipUp } from './useQuietChipUp.ts';
import { wxEmoji, wxLine } from './weatherCopy.ts';

/**
 * The Plan header (frame 2a) — a band that FLOATS on the trail and takes the sky's own colour.
 *
 * It used to sit above the scroller, which is how a cream header came to meet a navy trail at nine
 * at night: the sky belonged to the day and the chrome belonged to the app. Now it overlays the
 * trail and samples the sky's lightness at its own scroll position (`useSkyTint`), so it is cream
 * over a cream stretch and deep indigo over a night one, with a 14px fade underneath instead of a
 * hard edge. Opaque, deliberately — a translucent band let trail labels and the coach bubble ghost
 * through the chrome, which is worse than the seam it was meant to solve.
 *
 * What it carries is now four things: the coach mark, one line of weather, the quiet-hours chip
 * from early evening, and streak + XP. Location, city and CHANGE moved into the weather sheet the
 * chip opens — they were four lines of text to say one thing.
 *
 * The Apple Weather trademark stays HERE, under the temperature, even though the link to Apple's
 * data-source page moved into the sheet: Apple asks for the mark wherever WeatherKit data is
 * shown, and one screen away has been enough to fail review.
 *
 * With no location at all there is no chip and so no door — the header keeps the plain
 * "Set location" prompt in that case, never a fabricated place. That first-run button is the one
 * control here that sets where you LIVE; the sheet's city says where you ARE (A21).
 *
 * That prompt hangs on `needsLocation` and NOT on the absence of weather, which is the same
 * symptom asked as a different question. Missing weather has four causes and only one of them is
 * a missing location: the sheet's provider can blip, `/me/weather` can fail, and a cold launch
 * simply has not answered yet. All three used to draw the first-run button — for someone who had
 * a place on file, whose only way out was to press it and be re-homed to wherever they stood. When
 * the sky is unknown and the place is not, the header now says nothing, which is the truth.
 */
export function TrailHeader({ streak, xp, now = new Date() }: { streak: number; xp: number; now?: Date }) {
  const { weather, city, locating, needsLocation, requestLocation, setHereNow } = useTodayHeader();
  const head = useRef<HTMLDivElement>(null);
  const night = isNightHour(now.getHours());
  const dark = useSkyTint(head, night);
  const quietUp = useQuietChipUp(now);
  const [open, setOpen] = useState(false);
  const wx = weather?.available ? weather : null;
  // The sheet's series, from the cache the header's own weather read already filled (useAmbient):
  // subscribing here — not inside the sheet — is what lets a tap open on a forecast, not a spinner.
  const forecast = useForecast(Boolean(wx));
  const clock = useClockUnit();

  return (
    <>
      <div ref={head} className={`thead${dark ? ' is-night' : ''}`}>
        <CoachFace size={36} className="thead-avatar" />

        <div className="thead-main">
          {wx ? (
            <button className="thead-wxbtn" type="button" onClick={() => setOpen(true)}>
              <b className="thead-wx">
                <span aria-hidden>{wxEmoji(wx.conditions ?? '', night)}</span>{' '}
                {wxLine(wx.conditions, wx.temp_c, quietUp)}
              </b>
              {wx.attribution && <span className="thead-attr">{wx.attribution.name} ›</span>}
            </button>
          ) : needsLocation ? (
            <button className="thead-set" type="button" onClick={requestLocation}>
              <span aria-hidden>📍</span> {locating ? 'Locating…' : 'Set location for weather'}
            </button>
          ) : null}
        </div>

        <div className="thead-pills">
          {/* From early evening: when the coach stops talking tonight, and one tap to move it. */}
          <QuietHoursChip now={now} />
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

        {/* The band's bottom edge, softened into the sky rather than ruled against it. */}
        <span className="thead-fade" aria-hidden />
      </div>

      {/* Outside the band on purpose: `.thead` is positioned now, and a sheet inside it would rise
          from the header's own bottom edge instead of the bottom of the screen. */}
      {open && wx && (
        <WeatherSheet
          weather={wx}
          city={city}
          night={night}
          forecast={forecast}
          clock={clock}
          now={now}
          onHereNow={setHereNow}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
