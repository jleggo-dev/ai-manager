import { BASE, headers, timeoutSignal } from './http.ts';

/**
 * How the place was set, as the server recorded it when it was saved: `device` for a fix the
 * phone took, `city` for a name someone typed. Absent on places saved before the server kept it —
 * the client then falls back to its own record (features/settings/location-source.ts).
 */
export type HomeLocationSource = 'device' | 'city';
export type HomeLocation = { lat: number; lon: number; label?: string; source?: HomeLocationSource };

/** Where you ARE, when that is not where you live (A21). `at` is when the server committed it. */
export type CurrentLocation = { lat: number; lon: number; label?: string; at?: string };

export type LocationResult = {
  home_location: HomeLocation | null;
  /** Null means "at home" — the header then draws home_location. */
  current_location: CurrentLocation | null;
  timezone: string | null;
  available: boolean;
};

type LocationBody = {
  home_location?: HomeLocation | null;
  current_location?: CurrentLocation | null;
  timezone?: string | null;
};

/** GET /me/location — nulls when unset; available=false soft-handles a lagging API. */
export async function getHomeLocation(): Promise<LocationResult> {
  try {
    const res = await fetch(`${BASE}/me/location`, { headers: headers() });
    if (!res.ok) return { home_location: null, current_location: null, timezone: null, available: false };
    const body = (await res.json()) as LocationBody;
    return {
      home_location: body.home_location ?? null,
      current_location: body.current_location ?? null,
      timezone: body.timezone ?? null,
      available: true,
    };
  } catch {
    return { home_location: null, current_location: null, timezone: null, available: false };
  }
}

/** POST /me/location — persist coarse coords and/or city (+ optional timezone). */
export async function saveHomeLocation(input: {
  lat?: number;
  lon?: number;
  label?: string;
  city?: string;
  timezone?: string;
}): Promise<LocationResult> {
  const res = await fetch(`${BASE}/me/location`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? 'failed to save location');
  }
  const body = (await res.json()) as LocationBody;
  return {
    home_location: body.home_location ?? null,
    current_location: body.current_location ?? null,
    timezone: body.timezone ?? null,
    available: true,
  };
}

/**
 * POST /me/current-location — "I am here now". Coordinates only, and it never touches home: the
 * point notifications and planning are anchored to has to survive a commute (A21). Every caller
 * has already cleared the dwell gate in `placeDwell.ts`, which is what keeps the server-side
 * reverse geocode to one per real move.
 */
export async function saveCurrentLocation(input: { lat: number; lon: number }): Promise<CurrentLocation | null> {
  try {
    const res = await fetch(`${BASE}/me/current-location`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { current_location?: CurrentLocation | null };
    return body.current_location ?? null;
  } catch {
    return null;
  }
}

/** DELETE /me/current-location — home again. Soft-fails: the header simply keeps what it has. */
export async function clearCurrentLocation(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me/current-location`, { method: 'DELETE', headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

/** DELETE /me/location — forget stored place. */
export async function clearHomeLocation(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me/location`, { method: 'DELETE', headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

export type WeatherNow = {
  available: boolean;
  temp_c?: number;
  conditions?: string;
  label?: string | null;
  precip_chance?: number | null;
  source?: 'openweathermap' | 'weatherkit';
  /** Present only when the licence requires it (WeatherKit). Render the mark + link when set. */
  attribution?: { name: string; url: string } | null;
};

/** GET /me/weather — current conditions + city at the user's home location (for the Today header). */
export async function getWeather(): Promise<WeatherNow> {
  try {
    const res = await fetch(`${BASE}/me/weather`, { headers: headers() });
    if (!res.ok) return { available: false };
    return (await res.json()) as WeatherNow;
  } catch {
    return { available: false };
  }
}

/** One hour ahead. `at` is the instant; the sheet writes it in the forecast's own zone. */
export type ForecastHour = { at: string; temp_c: number; conditions: string; precip_chance: number | null };

/** One day ahead. `date` is the local calendar day (YYYY-MM-DD) in the forecast's zone. */
export type ForecastDay = {
  date: string;
  high_c: number;
  low_c: number;
  conditions: string;
  precip_chance: number | null;
};

/**
 * The hours and days behind the weather sheet's tabs. As long as the provider sees — ten days
 * from Apple, five from OpenWeatherMap — never padded; the sheet names its days tab for the count it got.
 */
export type Forecast = {
  available: boolean;
  /**
   * The READ failed — a timeout, a dead socket, a non-2xx — as opposed to the server answering
   * that there is no forecast (`available:false` alone). The two look the same on the sheet
   * unless it is told, and it used to be told nothing: a failed read was cached as "no forecast"
   * for the next hour with no line and no way to ask again (owner, on device, 2026-09-09).
   */
  error?: true;
  timezone?: string | null;
  hourly?: ForecastHour[];
  daily?: ForecastDay[];
  source?: 'openweathermap' | 'weatherkit';
  attribution?: { name: string; url: string } | null;
};

/** The read that failed, distinct from the server saying there is nothing to read. */
export const FORECAST_READ_FAILED: Forecast = { available: false, error: true };

/**
 * GET /me/forecast — read with the sky, ahead of the tap, so the sheet opens on a forecast.
 *
 * Bounded like every other read that gates something on screen: iOS suspends the webview when
 * the app backgrounds, and a request in flight at that moment can come back to a socket that
 * never answers. Without the timeout that left the sheet on "Reading the days ahead…" for good.
 */
export async function getForecast(): Promise<Forecast> {
  try {
    const res = await fetch(`${BASE}/me/forecast`, { headers: headers(), signal: timeoutSignal(15_000) });
    if (!res.ok) return FORECAST_READ_FAILED;
    return (await res.json()) as Forecast;
  } catch {
    return FORECAST_READ_FAILED;
  }
}

/** GET /me/today-brief — the Today header's one-line day recap (cached per user+day). */
export async function getTodayBrief(): Promise<{ recap: string | null }> {
  try {
    const res = await fetch(`${BASE}/me/today-brief`, { headers: headers() });
    if (!res.ok) return { recap: null };
    return (await res.json()) as { recap: string | null };
  } catch {
    return { recap: null };
  }
}

/** Browser IANA timezone when available. */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
