import type { Goal, Equipment, Baseline, GoalAssessment } from '@cadence/shared';
import { BASE, headers } from './http.ts';

export interface ReviewData {
  name: string;
  goals: Goal[];
  equipment: Equipment[];
  baseline: Baseline;
  guardrail: { weightedLoad: number; activeCount: number; overFocusBudget: boolean; exceedsHardCap: boolean };
  confirmable: boolean;
  lockable: boolean;
}

export async function getReview(): Promise<ReviewData> {
  const res = await fetch(`${BASE}/review`, { headers: headers() });
  if (!res.ok) throw new Error(`getReview failed: ${res.status}`);
  return res.json();
}

export async function confirmGoals(): Promise<{ confirmed: number }> {
  const res = await fetch(`${BASE}/review/confirm`, { method: 'POST', headers: headers() });
  if (!res.ok) throw new Error(`confirm failed: ${res.status}`);
  return res.json();
}

/* ── Review wizard: accept / reject / modify captured data ─────── */
export async function updateGoal(goalId: string, fields: Partial<Goal>): Promise<void> {
  await fetch(`${BASE}/review/goals/${goalId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) });
}
/** Coach's realism read on a goal + proposed stepping-stones (suggest-only). null if unavailable. */
export async function assessGoal(goalId: string): Promise<GoalAssessment | null> {
  const res = await fetch(`${BASE}/review/goals/${goalId}/assess`, { method: 'POST', headers: headers() });
  if (!res.ok) return null;
  return res.json();
}
export async function deleteGoal(goalId: string): Promise<void> {
  await fetch(`${BASE}/review/goals/${goalId}`, { method: 'DELETE', headers: headers() });
}
/** `confirm: true` (Settings manage mode) inserts as CONFIRMED — replan-visible + capture-immune. */
export async function addGoal(fields: Partial<Goal> & { confirm?: boolean }): Promise<Goal> {
  const res = await fetch(`${BASE}/review/goals`, { method: 'POST', headers: headers(), body: JSON.stringify(fields) });
  if (!res.ok) throw new Error(`addGoal failed: ${res.status}`);
  return res.json();
}
export async function updateEquipment(id: string, fields: Partial<Equipment>): Promise<void> {
  await fetch(`${BASE}/review/equipment/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) });
}
export async function deleteEquipmentItem(id: string): Promise<void> {
  await fetch(`${BASE}/review/equipment/${id}`, { method: 'DELETE', headers: headers() });
}
export async function addEquipment(fields: Partial<Equipment>): Promise<Equipment> {
  const res = await fetch(`${BASE}/review/equipment`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`addEquipment failed: ${res.status}`);
  return res.json();
}
export async function updateBaseline(patch: Partial<Baseline>): Promise<void> {
  await fetch(`${BASE}/review/baseline`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
}
export async function updateName(name: string): Promise<void> {
  await fetch(`${BASE}/review/profile`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ name }) });
}
