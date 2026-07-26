import type { MealPlan, MealPlanDay, ShoppingListItem } from '@cadence/shared';
import { sql, json } from '../db/sql.ts';

// created_at / updated_at cast to text — postgres.js Date-object trap (same as foods/recipes).
const COLS = sql`
  meal_plan_id, week_of::text as week_of, days, shopping_list, notes,
  created_at::text as created_at, updated_at::text as updated_at`;

export interface CreateMealPlanInput {
  week_of: string;
  days: MealPlanDay[];
  shopping_list: ShoppingListItem[];
  notes?: string | null;
}

export interface UpdateMealPlanInput {
  days?: MealPlanDay[];
  shopping_list?: ShoppingListItem[];
  notes?: string | null;
}

/** Fetch one meal plan the user owns. */
export async function getMealPlan(userId: string, mealPlanId: string): Promise<MealPlan | null> {
  const [row] = await sql<MealPlan[]>`
    select ${COLS} from cadence.meal_plans
    where meal_plan_id = ${mealPlanId} and user_id = ${userId}
    limit 1`;
  return row ?? null;
}

/** Fetch the plan for a calendar week (week_of = Monday YYYY-MM-DD). */
export async function getMealPlanByWeek(userId: string, weekOf: string): Promise<MealPlan | null> {
  const [row] = await sql<MealPlan[]>`
    select ${COLS} from cadence.meal_plans
    where user_id = ${userId} and week_of = ${weekOf}::date
    limit 1`;
  return row ?? null;
}

/** List the user's meal plans, newest week first. */
export async function listMealPlans(userId: string, limit = 20): Promise<MealPlan[]> {
  const capped = Math.min(52, Math.max(1, limit));
  return sql<MealPlan[]>`
    select ${COLS} from cadence.meal_plans
    where user_id = ${userId}
    order by week_of desc
    limit ${capped}`;
}

/**
 * Insert or replace the plan for that week (unique user_id + week_of).
 * Confirm-before-save: callers only invoke after the user accepts a draft.
 */
export async function upsertMealPlan(userId: string, input: CreateMealPlanInput): Promise<MealPlan> {
  const [row] = await sql<MealPlan[]>`
    insert into cadence.meal_plans (user_id, week_of, days, shopping_list, notes, updated_at)
    values (
      ${userId}, ${input.week_of}::date, ${json(input.days)}, ${json(input.shopping_list)},
      ${input.notes ?? null}, now()
    )
    on conflict (user_id, week_of) do update set
      days = excluded.days,
      shopping_list = excluded.shopping_list,
      notes = excluded.notes,
      updated_at = now()
    returning ${COLS}`;
  if (!row) throw new Error('upsertMealPlan: no row returned');
  return row;
}

/** Patch days / shopping_list / notes on a plan the user owns. */
export async function updateMealPlan(
  userId: string,
  mealPlanId: string,
  patch: UpdateMealPlanInput,
): Promise<MealPlan | null> {
  const [row] = await sql<MealPlan[]>`
    update cadence.meal_plans set
      days = coalesce(${patch.days ? json(patch.days) : null}, days),
      shopping_list = coalesce(${patch.shopping_list ? json(patch.shopping_list) : null}, shopping_list),
      notes = case
        when ${patch.notes !== undefined} then ${patch.notes ?? null}
        else notes
      end,
      updated_at = now()
    where meal_plan_id = ${mealPlanId} and user_id = ${userId}
    returning ${COLS}`;
  return row ?? null;
}

/** Delete a meal plan the user owns. */
export async function deleteMealPlan(userId: string, mealPlanId: string): Promise<boolean> {
  const rows = await sql`
    delete from cadence.meal_plans
    where meal_plan_id = ${mealPlanId} and user_id = ${userId}
    returning meal_plan_id`;
  return rows.length > 0;
}
