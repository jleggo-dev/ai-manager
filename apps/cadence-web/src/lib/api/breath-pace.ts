import { BASE, headers } from './http.ts';

/**
 * The person's breath pace on their account. Neither call throws: the card always has a pace to
 * play (the phone's copy, or the default), so a failed sync must never reach a practice.
 */
export async function getBreathPace(): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/me/breath-pace`, { headers: headers() });
    if (!res.ok) return null;
    const body = (await res.json()) as { pace?: unknown };
    return typeof body.pace === 'number' ? body.pace : null;
  } catch {
    return null;
  }
}

export async function saveBreathPace(pace: number): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me/breath-pace`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ pace }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
