import { sql, json } from '../db/sql.ts';
import type { Food, FoodBaseUnit, FoodNutrients, FoodServing, FoodSource, FoodVisibility } from '@cadence/shared';

// Alias-qualified so joins (search / recents) never collide with food_usage.food_id.
// created_at cast to text — postgres.js Date-object trap (same as nutrition.ts).
const FOOD_COLS = sql`
  f.food_id, f.owner_user_id, f.visibility, f.name, f.brand, f.source, f.off_id, f.base_unit,
  f.macros_per_base, f.servings, f.default_serving, f.confidence, f.photo_ref,
  f.created_at::text as created_at`;

const FOOD_COLS_PLAIN = sql`
  food_id, owner_user_id, visibility, name, brand, source, off_id, base_unit,
  macros_per_base, servings, default_serving, confidence, photo_ref,
  created_at::text as created_at`;

export interface CreateFoodInput {
  name: string;
  brand?: string | null;
  source: FoodSource;
  off_id?: string | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
  photo_ref?: string | null;
  /** User foods are private by default; shared is opt-in. */
  visibility?: FoodVisibility;
}

export interface UpdateFoodInput {
  name?: string;
  brand?: string | null;
  macros_per_base?: FoodNutrients;
  servings?: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
  photo_ref?: string | null;
  visibility?: FoodVisibility;
}

/** Fetch one food the user can see (own or shared). Dual-keyed for private rows. */
export async function getFood(userId: string, foodId: string): Promise<Food | null> {
  const [row] = await sql<Food[]>`
    select ${FOOD_COLS} from cadence.foods f
    where f.food_id = ${foodId}
      and (f.owner_user_id = ${userId} or f.visibility = 'shared')
    limit 1`;
  return row ?? null;
}

/**
 * Search own foods + shared DB. Rank: yours first, then usage count, then name.
 * Empty q returns [] — callers use listRecentFoods / listFrequentFoods for the empty-search UI.
 */
export async function searchFoods(userId: string, q: string, limit = 20): Promise<Food[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const capped = Math.min(50, Math.max(1, limit));
  const pattern = `%${query}%`;
  return sql<Food[]>`
    select ${FOOD_COLS}
    from cadence.foods f
    left join cadence.food_usage u
      on u.food_id = f.food_id and u.user_id = ${userId}
    where (f.owner_user_id = ${userId} or f.visibility = 'shared')
      and (lower(f.name) like ${pattern} or lower(coalesce(f.brand, '')) like ${pattern})
    order by
      case when f.owner_user_id = ${userId} then 0 else 1 end,
      coalesce(u.use_count, 0) desc,
      lower(f.name)
    limit ${capped}`;
}

/** Most recently used foods for this user (food_usage projection). */
export async function listRecentFoods(userId: string, limit = 20): Promise<Food[]> {
  const capped = Math.min(50, Math.max(1, limit));
  return sql<Food[]>`
    select ${FOOD_COLS}
    from cadence.food_usage u
    join cadence.foods f on f.food_id = u.food_id
    where u.user_id = ${userId}
      and (f.owner_user_id = ${userId} or f.visibility = 'shared')
    order by u.last_used_at desc
    limit ${capped}`;
}

/** Most frequently used foods for this user (food_usage projection). */
export async function listFrequentFoods(userId: string, limit = 20): Promise<Food[]> {
  const capped = Math.min(50, Math.max(1, limit));
  return sql<Food[]>`
    select ${FOOD_COLS}
    from cadence.food_usage u
    join cadence.foods f on f.food_id = u.food_id
    where u.user_id = ${userId}
      and (f.owner_user_id = ${userId} or f.visibility = 'shared')
    order by u.use_count desc, u.last_used_at desc
    limit ${capped}`;
}

/** Shared OFF cache row by barcode / off_id (source='off', visibility='shared'). */
export async function getFoodByOffId(offId: string): Promise<Food | null> {
  const id = offId.trim();
  if (!id) return null;
  const [row] = await sql<Food[]>`
    select ${FOOD_COLS} from cadence.foods f
    where f.off_id = ${id}
      and f.source = 'off'
      and f.visibility = 'shared'
    order by f.created_at asc
    limit 1`;
  return row ?? null;
}

export interface UpsertOffFoodInput {
  name: string;
  brand?: string | null;
  off_id: string;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
  photo_ref?: string | null;
}

/**
 * Upsert a shared Open Food Facts food (owner NULL, visibility shared).
 * Prefer cache hits via getFoodByOffId before the browser calls OFF.
 */
export async function upsertSharedOffFood(input: UpsertOffFoodInput): Promise<{ food: Food; cached: boolean }> {
  const offId = input.off_id.trim();
  if (!offId) throw new Error('upsertSharedOffFood: off_id required');
  const defaultServing = Number.isInteger(input.default_serving) ? (input.default_serving as number) : 0;
  const existing = await getFoodByOffId(offId);
  if (existing) {
    const [row] = await sql<Food[]>`
      update cadence.foods f set
        name = ${input.name},
        brand = ${input.brand ?? null},
        base_unit = ${input.base_unit},
        macros_per_base = ${json(input.macros_per_base ?? {})},
        servings = ${json(input.servings ?? [])},
        default_serving = ${defaultServing},
        confidence = ${input.confidence ?? null},
        photo_ref = case
          when ${input.photo_ref !== undefined} then ${input.photo_ref ?? null}
          else f.photo_ref
        end
      where f.food_id = ${existing.food_id}
      returning ${FOOD_COLS}`;
    if (!row) throw new Error('upsertSharedOffFood: update returned no row');
    return { food: row, cached: true };
  }
  const [row] = await sql<Food[]>`
    insert into cadence.foods (
      owner_user_id, visibility, name, brand, source, off_id, base_unit,
      macros_per_base, servings, default_serving, confidence, photo_ref
    ) values (
      null, 'shared', ${input.name}, ${input.brand ?? null}, 'off',
      ${offId}, ${input.base_unit},
      ${json(input.macros_per_base ?? {})}, ${json(input.servings ?? [])},
      ${defaultServing}, ${input.confidence ?? null}, ${input.photo_ref ?? null}
    )
    returning ${FOOD_COLS_PLAIN}`;
  if (!row) throw new Error('upsertSharedOffFood: insert returned no row');
  return { food: row, cached: false };
}

/** Create a user-owned food (private by default). */
export async function insertFood(userId: string, input: CreateFoodInput): Promise<Food> {
  const visibility = input.visibility ?? 'private';
  const defaultServing = Number.isInteger(input.default_serving) ? (input.default_serving as number) : 0;
  const [row] = await sql<Food[]>`
    insert into cadence.foods (
      owner_user_id, visibility, name, brand, source, off_id, base_unit,
      macros_per_base, servings, default_serving, confidence, photo_ref
    ) values (
      ${userId}, ${visibility}, ${input.name}, ${input.brand ?? null}, ${input.source},
      ${input.off_id ?? null}, ${input.base_unit},
      ${json(input.macros_per_base ?? {})}, ${json(input.servings ?? [])},
      ${defaultServing}, ${input.confidence ?? null}, ${input.photo_ref ?? null}
    )
    returning ${FOOD_COLS_PLAIN}`;
  if (!row) throw new Error('insertFood: no row returned');
  return row;
}

/** Patch a food the user owns. Shared/global rows (no owner) are not editable here. */
export async function updateFood(userId: string, foodId: string, patch: UpdateFoodInput): Promise<Food | null> {
  const [row] = await sql<Food[]>`
    update cadence.foods f set
      name = coalesce(${patch.name ?? null}, f.name),
      brand = case when ${patch.brand !== undefined} then ${patch.brand ?? null} else f.brand end,
      macros_per_base = coalesce(${patch.macros_per_base ? json(patch.macros_per_base) : null}, f.macros_per_base),
      servings = coalesce(${patch.servings ? json(patch.servings) : null}, f.servings),
      default_serving = coalesce(${patch.default_serving ?? null}, f.default_serving),
      confidence = case when ${patch.confidence !== undefined} then ${patch.confidence ?? null} else f.confidence end,
      photo_ref = case when ${patch.photo_ref !== undefined} then ${patch.photo_ref ?? null} else f.photo_ref end,
      visibility = coalesce(${patch.visibility ?? null}, f.visibility)
    where f.food_id = ${foodId} and f.owner_user_id = ${userId}
    returning ${FOOD_COLS}`;
  return row ?? null;
}

/** Delete a food the user owns. Shared/global rows are not deletable by users. */
export async function deleteFood(userId: string, foodId: string): Promise<boolean> {
  const rows = await sql`
    delete from cadence.foods
    where food_id = ${foodId} and owner_user_id = ${userId}
    returning food_id`;
  return rows.length > 0;
}

/**
 * Bump the per-user usage projection after a confirmed log (teaches recents/frequents).
 * Idempotent upsert.
 */
export async function touchFoodUsage(userId: string, foodId: string): Promise<void> {
  await sql`
    insert into cadence.food_usage (user_id, food_id, use_count, last_used_at)
    values (${userId}, ${foodId}, 1, now())
    on conflict (user_id, food_id) do update set
      use_count = cadence.food_usage.use_count + 1,
      last_used_at = now()`;
}

/** Per-user usage rows for resolver ranking (use_count + recency). */
export async function listFoodUsageRows(
  userId: string,
  limit = 100,
): Promise<Array<{ food_id: string; use_count: number; last_used_at: string }>> {
  const capped = Math.min(200, Math.max(1, limit));
  return sql<{ food_id: string; use_count: number; last_used_at: string }[]>`
    select food_id, use_count, last_used_at::text as last_used_at
    from cadence.food_usage
    where user_id = ${userId}
    order by last_used_at desc
    limit ${capped}`;
}
