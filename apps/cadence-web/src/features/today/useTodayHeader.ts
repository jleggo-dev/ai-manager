import { useCallback, useEffect, useState } from 'react';
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
export function useTodayHeader(): TodayHeader {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const refreshWeather = useCallback(async () => {
    const w = await getWeather();
    setWeather(w);
    if (w.available && w.label) setCity(w.label);
  }, []);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await saveHomeLocation({
            lat: Number(pos.coords.latitude.toFixed(2)), // coarse — ~1 km, not a precise fix
            lon: Number(pos.coords.longitude.toFixed(2)),
            timezone: browserTimezone(),
          });
          await refreshWeather();
        } finally {
          setLocating(false);
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 3_600_000 },
    );
  }, [refreshWeather]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loc = await getHomeLocation();
      if (!alive) return;
      if (loc.home_location) {
        setCity(loc.home_location.label ?? null);
        await refreshWeather();
      } else {
        requestLocation(); // one-time silent auto-detect
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshWeather, requestLocation]);

  return { weather, city, locating, requestLocation };
}
