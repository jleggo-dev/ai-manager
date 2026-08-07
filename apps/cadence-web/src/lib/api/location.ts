import { BASE, headers } from './http.ts';

export type HomeLocation = { lat: number; lon: number; label?: string };

export type LocationResult = {
  home_location: HomeLocation | null;
  timezone: string | null;
  available: boolean;
};

/** GET /me/location — nulls when unset; available=false soft-handles a lagging API. */
export async function getHomeLocation(): Promise<LocationResult> {
  try {
    const res = await fetch(`${BASE}/me/location`, { headers: headers() });
    if (!res.ok) return { home_location: null, timezone: null, available: false };
    const body = (await res.json()) as { home_location?: HomeLocation | null; timezone?: string | null };
    return {
      home_location: body.home_location ?? null,
      timezone: body.timezone ?? null,
      available: true,
    };
  } catch {
    return { home_location: null, timezone: null, available: false };
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
  const body = (await res.json()) as { home_location?: HomeLocation | null; timezone?: string | null };
  return {
    home_location: body.home_location ?? null,
    timezone: body.timezone ?? null,
    available: true,
  };
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
