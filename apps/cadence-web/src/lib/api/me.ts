import { BASE, headers } from './http.ts';

/** What the plan is being built around, straight from the database — not the coach's account of it. */
export interface UserConstraint {
  id: string;
  label: string;
  kind?: string;
  status?: string;
  plan_around?: boolean;
}
export async function getConstraints(): Promise<UserConstraint[]> {
  const res = await fetch(`${BASE}/me/constraints`, { headers: headers() });
  if (!res.ok) return [];
  return ((await res.json()) as { constraints: UserConstraint[] }).constraints ?? [];
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
  return ((await res.json()) as { constraints: UserConstraint[] }).constraints ?? [];
}

/** Remove one. Returns the surviving list so the screen never guesses at the new state. */
export async function removeConstraint(id: string): Promise<UserConstraint[] | null> {
  const res = await fetch(`${BASE}/me/constraints/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { constraints: UserConstraint[] }).constraints ?? [];
}
