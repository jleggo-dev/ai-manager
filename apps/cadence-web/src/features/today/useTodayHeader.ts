import { useCallback, useEffect, useState } from 'react';
import { capabilities } from '../../lib/capability/index.ts';
import { getWeather, getHomeLocation, saveHomeLocation, browserTimezone, type WeatherNow } from '../../lib/api.ts';

export type TodayHeader = {
  weather: WeatherNow | null;
  city: string | null;
  locating: boolean;
  requestLocation: () => void;
};

/**
 * Header context for the trail — current weather + city, with **auto-detect** on first load
 * (replaces the old "share coarse location" card). Auto-detect = a single silent browser
 * geolocation attempt when nothing is stored; on success we persist a COARSE point (rounded to
 * ~1 km) and refresh weather, and the city name comes back from OpenWeatherMap. If the user
 * declines or it's unavailable we stay quiet — no weather, just the greeting (deterministic; the
 * coach can still ask) — and expose `requestLocation` so the header's "change" affordance can
 * re-trigger it. Precise GPS / a typed city remain available in Settings.
 */
/** Great-circle km between two points — the travel test's yardstick. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useTodayHeader(): TodayHeader {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const refreshWeather = useCallback(async () => {
    const w = await getWeather();
    setWeather(w);
    if (w.available && w.label) setCity(w.label);
  }, []);

  /** After a location change: pick up the NEW stored label (reverse-geocoded server-side) and the
   *  weather at the new coordinates together, so the header never mixes one city's name with the
   *  other's sky. */
  const refreshWeatherAndCity = useCallback(async () => {
    const loc = await getHomeLocation().catch(() => null);
    if (loc?.home_location) setCity(loc.home_location.label ?? null);
    await refreshWeather();
  }, [refreshWeather]);

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
      await refreshWeather();
    } finally {
      setLocating(false);
    }
  }, [refreshWeather]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loc = await getHomeLocation();
      if (!alive) return;
      if (loc.home_location) {
        setCity(loc.home_location.label ?? null);
        await refreshWeather();
        // Deterministic travel check (owner, 2026-08-14: flew Lisbon → Montreal and the header
        // kept the old city all day). Permission was granted long ago, so this read is silent;
        // a real move (> ~50 km — travel, never GPS jitter or a coarse-rounding wobble) updates
        // the stored location, which reverse-geocodes the new label server-side. Failures of any
        // kind change nothing — the stored city keeps standing.
        void capabilities.location
          .getCoarseLocation()
          .then(async (pos) => {
            if (!pos || !alive) return;
            const stored = loc.home_location!;
            const moved = haversineKm(stored.lat, stored.lon, pos.lat, pos.lon);
            if (moved < 50 || !alive) return;
            await saveHomeLocation({
              lat: Number(pos.lat.toFixed(2)),
              lon: Number(pos.lon.toFixed(2)),
              timezone: browserTimezone(), // travel far enough to change cities changes clocks too
            }).catch(() => undefined);
            if (alive) await refreshWeatherAndCity();
          })
          .catch(() => undefined); // declined / unavailable — the stored location stands
      } else {
        requestLocation(); // one-time silent auto-detect
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshWeather, refreshWeatherAndCity, requestLocation]);

  return { weather, city, locating, requestLocation };
}
