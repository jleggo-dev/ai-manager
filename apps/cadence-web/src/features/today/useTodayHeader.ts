import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { capabilities } from '../../lib/capability/index.ts';
import {
  clearCurrentLocation,
  saveCurrentLocation,
  saveHomeLocation,
  browserTimezone,
  type LocationResult,
  type WeatherNow,
} from '../../lib/api.ts';
import {
  fetchLocationCached,
  fetchWeatherCached,
  forgetLocation,
  forgetWeather,
  prefetchForecast,
  queryKeys,
} from '../../lib/query/index.ts';
import { isLocationOff } from '../settings/location-source.ts';
import {
  decidePlace,
  forgetCandidate,
  loadCandidate,
  loadLastSavedMs,
  markSaved,
  rememberCandidate,
  type Point,
} from './placeDwell.ts';

export type TodayHeader = {
  weather: WeatherNow | null;
  city: string | null;
  locating: boolean;
  /**
   * Ask for a place — true ONLY when a location read came BACK and said there is nothing stored,
   * on a device that can actually produce a fix.
   *
   * The header used to infer this from "no weather", which is a different question with the same
   * symptom. A provider blip, a `/me/weather` failure, or simply the two round trips a cold launch
   * spends before either answer arrives all put "Set location for weather" in front of someone
   * whose location has been on file for weeks — and pressing it re-homed them to wherever they
   * happened to be standing.
   */
  needsLocation: boolean;
  /** Set where you LIVE — first-run auto-detect, and Settings-grade "this is my place". */
  requestLocation: () => void;
  /** Say where you ARE, right now, deliberately — the weather sheet's CHANGE (A21). */
  setHereNow: () => void;
};

/**
 * Header context for the trail — current weather + city, with **auto-detect** on first load
 * (replaces the old "share coarse location" card). Auto-detect = a single silent browser
 * geolocation attempt when nothing is stored; on success we persist a COARSE point (rounded to
 * ~1 km) and refresh weather, and the city name comes back from OpenWeatherMap. If the user
 * declines or it's unavailable we stay quiet — no weather, just the greeting (deterministic; the
 * coach can still ask) — and expose `requestLocation` so the header's "change" affordance can
 * re-trigger it. Precise GPS / a typed city remain available in Settings.
 *
 * **Not knowing is its own state.** Three of the four things this hook reports start out unknown,
 * and every one of them used to render as a negative: no weather yet read as no location, a failed
 * `/me/location` read as nothing stored, a declined fix as a header with nothing in it at all. So
 * `hasLocation` is tri-state and only a read that came BACK may set it, `needsLocation` is the one
 * flag the UI may act on, and every early return still ends by asking for the sky. The bug that
 * bought all of this: an account that had stored a place since August was shown "Set location for
 * weather" on a cold open, and pressing it re-homed them to the street they were standing on.
 *
 * Two stored points, since A21: `home_location` is where you LIVE (notifications, planning and the
 * coach are anchored to it and must not follow a commute) and `current_location` is where you ARE,
 * which is what this header draws. The gates that decide when the second one moves — 5 km away,
 * still there twenty minutes later, one save per half hour — live in `placeDwell.ts`.
 */
export function useTodayHeader(): TodayHeader {
  const queryClient = useQueryClient();
  // Seeded from the cache, not from nothing: on a tab return the sky is already in there, and on a
  // cold launch the boot snapshot puts it there before React's first render. Starting at null meant
  // the header had no weather for as long as two sequential round trips took.
  const [weather, setWeather] = useState<WeatherNow | null>(
    () => queryClient.getQueryData<WeatherNow>(queryKeys.weather.all) ?? null,
  );
  /** Last launch's place, off disk, before the first paint — see the `weather` seed above. */
  const booted = queryClient.getQueryData<LocationResult>(queryKeys.location.all);
  const [city, setCity] = useState<string | null>(
    () => (booted?.current_location ?? booted?.home_location)?.label ?? null,
  );
  const [locating, setLocating] = useState(false);
  /** null until a location read comes back — "we don't know yet" must never render as "there is none". */
  const [hasLocation, setHasLocation] = useState<boolean | null>(() =>
    booted?.available ? Boolean(booted.home_location) : null,
  );
  /** The two stored points, as of the last read — the yardstick every place decision measures against. */
  const place = useRef<{ home: Point | null; current: Point | null }>({ home: null, current: null });

  /**
   * Read the sky THROUGH the cache (PERF-03). The Plan tab unmounts on every tab switch, so this
   * used to be a fresh `/me/weather` round trip each time someone came back to look at their day —
   * for an answer that is a condition word and a temperature and does not move in five minutes.
   * Inside that window a return costs nothing; every path that genuinely invalidates the sky (a
   * saved location, a detected move) drops the entry first, below.
   */
  const refreshWeather = useCallback(async () => {
    const w = await fetchWeatherCached(queryClient);
    setWeather(w);
    if (w.available && w.label) setCity(w.label);
    // The sheet behind the chip, read now rather than at the tap — and only once there IS a sky,
    // since the chip (and so the sheet) is not drawn without one. Not awaited: the header's own
    // line must never wait on a fortnight it is not showing.
    if (w.available) void prefetchForecast(queryClient);
  }, [queryClient]);

  /** Read both stored points and keep the header's yardstick in step. The city shown is where you
   *  ARE when that is somewhere other than home — that is the whole point of the second field. */
  const syncPlace = useCallback(async () => {
    // Through the cache: a place is the one thing here that outlives the launch, and a read that
    // soft-fails keeps the last good answer rather than overwriting it with nulls (useAmbient.ts).
    const loc = await fetchLocationCached(queryClient).catch(() => null);
    place.current = { home: loc?.home_location ?? null, current: loc?.current_location ?? null };
    // `available` is the difference between "the server says you have no place" and "we could not
    // ask". Only the first is an answer; the second leaves whatever we already knew standing.
    if (loc?.available) setHasLocation(Boolean(loc.home_location));
    const shown = loc?.current_location ?? loc?.home_location;
    if (shown) setCity(shown.label ?? null);
    return loc;
  }, [queryClient]);

  /** After a location change: pick up the NEW stored label (reverse-geocoded server-side) and the
   *  weather at the new coordinates together, so the header never mixes one city's name with the
   *  other's sky. */
  const refreshWeatherAndCity = useCallback(async () => {
    forgetWeather(queryClient); // the cached sky belongs to the city they just left
    forgetLocation(queryClient); // and so does the cached place
    await syncPlace();
    await refreshWeather();
  }, [queryClient, refreshWeather, syncPlace]);

  /**
   * Through the capability seam, NEVER `navigator.geolocation`. Two reasons, and the second is
   * the one a user sees: inside the shell the page is served from capacitor://localhost, which
   * iOS does not treat as a secure origin (so the web API is unreliable there) — and the webview
   * prompt asks on behalf of its ORIGIN, so it read "Allow localhost to use your location".
   * Nobody has agreed to give their location to localhost. The plugin raises the native
   * CoreLocation prompt instead, which carries the app's name and our Info.plist reason.
   */
  const requestLocation = useCallback(async () => {
    if (!capabilities.location.isAvailable()) return;
    setLocating(true);
    try {
      const pos = await capabilities.location.getCoarseLocation();
      // Declined, or no fix in ten seconds. The server may hold a place regardless — this client
      // just failed to produce one — so read the sky anyway instead of leaving the header blank.
      if (!pos) return void (await refreshWeather());
      await saveHomeLocation({
        lat: Number(pos.lat.toFixed(2)), // coarse — ~1 km, not a precise fix
        lon: Number(pos.lon.toFixed(2)),
        timezone: browserTimezone(),
      });
      forgetWeather(queryClient); // new coordinates — the cached sky is the wrong one
      await refreshWeatherAndCity();
    } finally {
      setLocating(false);
    }
  }, [queryClient, refreshWeather, refreshWeatherAndCity]);

  /** Act on a decision from the gates. The only branch that costs a reverse geocode is `commit`. */
  const applyDecision = useCallback(
    async (decision: ReturnType<typeof decidePlace>) => {
      if (decision.kind === 'stay') return void forgetCandidate();
      if (decision.kind === 'hold') return void rememberCandidate(decision.candidate);
      if (decision.kind === 'home') {
        forgetCandidate();
        await clearCurrentLocation();
      } else {
        forgetCandidate();
        markSaved(Date.now()); // the floor exists to bound geocodes, so only a real save arms it
        await saveCurrentLocation({
          lat: Number(decision.point.lat.toFixed(2)),
          lon: Number(decision.point.lon.toFixed(2)),
        });
      }
      await refreshWeatherAndCity();
    },
    [refreshWeatherAndCity],
  );

  /**
   * "I'm here now", said out loud by tapping the city in the weather sheet. Same decision
   * function, with the two gates satisfied by construction: a tap IS the dwell — the user has
   * just told us they have arrived, so there is nothing left to wait for.
   */
  const setHereNow = useCallback(async () => {
    if (!capabilities.location.isAvailable()) return;
    setLocating(true);
    try {
      const pos = await capabilities.location.getCoarseLocation();
      if (!pos) return;
      await applyDecision(
        decidePlace({
          ...place.current,
          reading: pos,
          candidate: { lat: pos.lat, lon: pos.lon, firstSeenMs: 0 },
          lastSavedMs: null,
          nowMs: Date.now(),
        }),
      );
    } finally {
      setLocating(false);
    }
  }, [applyDecision]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loc = await syncPlace();
      if (!alive) return;
      // Auto-detect on a read that came back EMPTY — never on one that failed. A blip on
      // `/me/location` used to land here, skip the weather read entirely, and hand the header its
      // first-run prompt; the account it was asking had been storing a place since August.
      //
      // `isLocationOff` is the one thing that stops it: the owner's rule is that a place is kept
      // for you unless you say otherwise IN SETTINGS, so the Settings forget has to bind here or
      // it is an off switch that turns itself back on overnight.
      if (loc?.available && !loc.home_location && !isLocationOff()) return void requestLocation();

      await refreshWeather();
      // The deterministic place check (owner, 2026-08-17: downtown all day, header still said
      // Île-Perrot). Permission was granted long ago, so this read is silent; the gates in
      // placeDwell.ts decide whether it is worth a save. Failures of any kind change nothing —
      // whatever the header already says keeps standing.
      void capabilities.location
        .getCoarseLocation()
        .then(async (pos) => {
          if (!pos || !alive) return;
          const decision = decidePlace({
            ...place.current,
            reading: pos,
            candidate: loadCandidate(),
            lastSavedMs: loadLastSavedMs(),
            nowMs: Date.now(),
          });
          if (alive) await applyDecision(decision);
        })
        .catch(() => undefined); // declined / unavailable — the stored location stands
    })();
    return () => {
      alive = false;
    };
  }, [applyDecision, refreshWeather, requestLocation, syncPlace]);

  return {
    weather,
    city,
    locating,
    // A dead button is worse than none: without the capability, pressing it can do nothing, and
    // Settings still takes a typed city. Nor is it shown to someone who turned location OFF —
    // they know where the setting is; nagging them from the header is what they switched off.
    needsLocation: hasLocation === false && !isLocationOff() && capabilities.location.isAvailable(),
    requestLocation,
    setHereNow,
  };
}
