// SR-1 seam — integration deletes this shim.
//
// SettingsGoals.tsx (SR-4) codes against three pre-agreed goal-lifecycle functions that a sibling
// parcel (SR-1) is expected to land in `lib/api/review.ts`: `renameGoal`, `retireGoal`,
// `restoreGoal`, all `Promise<boolean>`. They don't exist there yet — `PATCH /review/goals/:id`
// (see `lib/api/review.ts` → `updateGoal`) only whitelists title/area/type/measure/timeframe/
// milestones/plan_mode server-side; `status` is not one of them, so there is today no working way
// to retire or restore a goal over the wire.
//
// This file exists only so tsc passes either way and SettingsGoals has something real to call in
// the meantime:
//   - `renameGoal` genuinely works today — title IS patchable, so this just does that PATCH
//     directly (checking `res.ok`, unlike `updateGoal`'s fire-and-forget `Promise<void>`).
//   - `retireGoal` / `restoreGoal` call the lifecycle endpoints SR-1 is expected to add
//     (`POST /review/goals/:id/retire` / `/restore`). No such route exists yet, so these 404 and
//     resolve `false` rather than throwing — an honest "didn't go through", not a silent no-op.
//
// Once SR-1 lands real exports in `lib/api/review.ts` (re-exported through `lib/api.ts`), delete
// this file and change SettingsGoals.tsx's import to `'../../lib/api.ts'`.
import { BASE, headers } from '../../lib/api/http.ts';

export async function renameGoal(goalId: string, title: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/review/goals/${goalId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ title }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function retireGoal(goalId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/review/goals/${goalId}/retire`, { method: 'POST', headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

export async function restoreGoal(goalId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/review/goals/${goalId}/restore`, { method: 'POST', headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}
