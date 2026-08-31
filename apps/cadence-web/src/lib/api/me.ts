import type { UnitPrefs } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** What the plan is being built around, straight from the database — not the coach's account of it. */
export interface UserConstraint {
  id: string;
  label: string;
  kind?: string;
  status?: string;
  plan_around?: boolean;
}
/**
 * The list, or nothing — never whatever shape the wire happened to carry. On 2026-08-31 a bad
 * server-side write turned the stored constraints into a JSON string; this read passed it
 * straight through, `items.map` threw inside the Settings sheet, and the error boundary took the
 * WHOLE app down at boot ("Something broke while starting"). A screen must never inherit a crash
 * from a shape it can floor to empty.
 */
const asConstraintList = (v: unknown): UserConstraint[] => (Array.isArray(v) ? (v as UserConstraint[]) : []);

export async function getConstraints(): Promise<UserConstraint[]> {
  const res = await fetch(`${BASE}/me/constraints`, { headers: headers() });
  if (!res.ok) return [];
  return asConstraintList(((await res.json()) as { constraints?: unknown }).constraints);
}

/**
 * Fix the wording on one. Only the label changes — same row, same history.
 * Returns the full list, as with removal: the panel shows what is stored, never what it hoped for.
 */
export async function renameConstraint(id: string, label: string): Promise<UserConstraint[] | null> {
  const res = await fetch(`${BASE}/me/constraints/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) return null;
  return asConstraintList(((await res.json()) as { constraints?: unknown }).constraints);
}

/** Remove one. Returns the surviving list so the screen never guesses at the new state. */
export async function removeConstraint(id: string): Promise<UserConstraint[] | null> {
  const res = await fetch(`${BASE}/me/constraints/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) return null;
  return asConstraintList(((await res.json()) as { constraints?: unknown }).constraints);
}

export interface UnitsResponse {
  prefs: UnitPrefs | null;
  /** What each axis resolves to right now — never re-derive this client-side. */
  resolved: Record<string, string>;
}

/**
 * Display units, per axis. The server owns the precedence (explicit → legacy baseline.weight_unit
 * → system fallback → metric) and hands back both the raw prefs and the resolved answer, so the
 * client never re-implements it and the two cannot disagree.
 */
export async function getUnits(): Promise<UnitsResponse | null> {
  try {
    const res = await fetch(`${BASE}/me/units`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as UnitsResponse;
  } catch {
    return null;
  }
}

export async function setUnits(patch: Partial<UnitPrefs>): Promise<UnitsResponse | null> {
  try {
    const res = await fetch(`${BASE}/me/units`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    return (await res.json()) as UnitsResponse;
  } catch {
    return null;
  }
}
