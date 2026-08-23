import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { capabilities } from '../../lib/capability/index.ts';
import {
  clearCurrentLocation,
  getHomeLocation,
  saveCurrentLocation,
  saveHomeLocation,
  browserTimezone,
  type WeatherNow,
} from '../../lib/api.ts';
import { fetchWeatherCached, forgetWeather } from '../../lib/query/index.ts';
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
 * Two stored points, since A21: `home_location` is where you LIVE (notifications, planning and the
 * coach are anchored to it and must not follow a commute) and `current_location` is where you ARE,
 * which is what this header draws. The gates that decide when the second one moves — 5 km away,
 * still there twenty minutes later, one save per half hour — live in `placeDwell.ts`.
 */
export function useTodayHeader(): TodayHeader {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const queryClient = useQueryClient();
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
  }, [queryClient]);

  /** Read both stored points and keep the header's yardstick in step. The city shown is where you
   *  ARE when that is somewhere other than home — that is the whole point of the second field. */
  const syncPlace = useCallback(async () => {
    const loc = await getHomeLocation().catch(() => null);
    place.current = { home: loc?.home_location ?? null, current: loc?.current_location ?? null };
    const shown = loc?.current_location ?? loc?.home_location;
    if (shown) setCity(shown.label ?? null);
    return loc;
  }, []);

  /** After a location change: pick up the NEW stored label (reverse-geocoded server-side) and the
   *  weather at the new coordinates together, so the header never mixes one city's name with the
   *  other's sky. */
  const refreshWeatherAndCity = useCallback(async () => {
    forgetWeather(queryClient); // the cached sky belongs to the city they just left
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
      if (!pos) return;
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
  }, [queryClient, refreshWeatherAndCity]);

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
      if (!loc?.home_location) return void requestLocation(); // one-time silent auto-detect

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

  return { weather, city, locating, requestLocation, setHereNow };
}
