import { sql, json } from '../db/sql.ts';
import type { Food, FoodBaseUnit, FoodNutrients, FoodServing, FoodSource, FoodVisibility } from '@cadence/shared';

// Alias-qualified so joins (search / recents) never collide with food_usage.food_id.
// created_at cast to text — postgres.js Date-object trap (same as nutrition.ts).
const FOOD_COLS = sql`
  f.food_id, f.owner_user_id, f.visibility, f.name, f.brand, f.source, f.off_id, f.fdc_id,
  f.fatsecret_id, f.source_fetched_at::text as source_fetched_at, f.base_unit,
  f.macros_per_base, f.servings, f.default_serving, f.confidence, f.photo_ref,
  f.created_at::text as created_at`;

const FOOD_COLS_PLAIN = sql`
  food_id, owner_user_id, visibility, name, brand, source, off_id, fdc_id,
  fatsecret_id, source_fetched_at::text as source_fetched_at, base_unit,
  macros_per_base, servings, default_serving, confidence, photo_ref,
  created_at::text as created_at`;

export interface CreateFoodInput {
  name: string;
  brand?: string | null;
  source: FoodSource;
  off_id?: string | null;
  fdc_id?: number | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
  photo_ref?: string | null;
  /** User foods are private by default; shared is opt-in. */
  visibility?: FoodVisibility;
}

export interface UpsertUsdaFoodInput {
  fdc_id: number;
  name: string;
  brand?: string | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
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

/** Batch fetch foods the user can see (own or shared). Empty ids → []. */
export async function getFoodsByIds(userId: string, foodIds: string[]): Promise<Food[]> {
  const ids = [...new Set(foodIds.map((id) => String(id).trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return [];
  return sql<Food[]>`
    select ${FOOD_COLS} from cadence.foods f
    where f.food_id in ${sql(ids)}
      and (f.owner_user_id = ${userId} or f.visibility = 'shared')`;
}

/** Lookup a cached USDA shared food by FDC id (any user can see shared rows). */
export async function findFoodByFdcId(fdcId: number): Promise<Food | null> {
  if (!Number.isInteger(fdcId) || fdcId <= 0) return null;
  const [row] = await sql<Food[]>`
    select ${FOOD_COLS} from cadence.foods f
    where f.fdc_id = ${fdcId} and f.source = 'usda'
    limit 1`;
  return row ?? null;
}

/**
 * Search own foods + shared DB (0039: trigram-indexed).
 *
 * Substring OR trigram-similar, so word order and small typos still find the row — "greek yogurt"
 * reaches "Yogurt, Greek, plain", which plain LIKE never did. The `%` operator is the one the GIN
 * index accelerates (threshold: pg_trgm's 0.3 default); LIKE stays for the short queries where
 * trigrams are too weak to fire.
 *
 * Order here is about RECALL, not final rank — `rankFoods` re-scores whatever comes back — so
 * similarity leads with a small own-food thumb on the scale, rather than yours-first outright.
 * That mattered less at a few hundred rows and matters completely at 450k: once USDA Branded
 * lands, this LIMIT decides what the ranker is even allowed to see.
 *
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
      and (
        lower(f.name) like ${pattern}
        or lower(coalesce(f.brand, '')) like ${pattern}
        or lower(f.name) % ${query}
      )
    order by
      greatest(
        similarity(lower(f.name), ${query}),
        similarity(lower(coalesce(f.brand, '')), ${query})
      ) + case when f.owner_user_id = ${userId} then 0.15 else 0 end desc,
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
      owner_user_id, visibility, name, brand, source, off_id, fdc_id, base_unit,
      macros_per_base, servings, default_serving, confidence, photo_ref
    ) values (
      ${userId}, ${visibility}, ${input.name}, ${input.brand ?? null}, ${input.source},
      ${input.off_id ?? null}, ${input.fdc_id ?? null}, ${input.base_unit},
      ${json(input.macros_per_base ?? {})}, ${json(input.servings ?? [])},
      ${defaultServing}, ${input.confidence ?? null}, ${input.photo_ref ?? null}
    )
    returning ${FOOD_COLS_PLAIN}`;
  if (!row) throw new Error('insertFood: no row returned');
  return row;
}

/**
 * Upsert a shared/global USDA food (owner NULL). Always cache successful FDC lookups here
 * so repeat resolve/search hits the DB, not api.data.gov.
 */
export async function upsertUsdaFood(input: UpsertUsdaFoodInput): Promise<Food> {
  if (!Number.isInteger(input.fdc_id) || input.fdc_id <= 0) throw new Error('upsertUsdaFood: bad fdc_id');
  const defaultServing = Number.isInteger(input.default_serving) ? (input.default_serving as number) : 0;
  const [row] = await sql<Food[]>`
    insert into cadence.foods (
      owner_user_id, visibility, name, brand, source, off_id, fdc_id, base_unit,
      macros_per_base, servings, default_serving, confidence, photo_ref
    ) values (
      null, 'shared', ${input.name}, ${input.brand ?? null}, 'usda',
      null, ${input.fdc_id}, ${input.base_unit},
      ${json(input.macros_per_base ?? {})}, ${json(input.servings ?? [])},
      ${defaultServing}, ${input.confidence ?? 1}, null
    )
    on conflict (fdc_id) do update set
      name = excluded.name,
      brand = excluded.brand,
      macros_per_base = excluded.macros_per_base,
      servings = excluded.servings,
      default_serving = excluded.default_serving,
      confidence = excluded.confidence,
      source = 'usda',
      visibility = 'shared',
      owner_user_id = null
    returning ${FOOD_COLS_PLAIN}`;
  if (!row) throw new Error('upsertUsdaFood: no row returned');
  return row;
}

export interface UpsertFatSecretFoodInput {
  fatsecret_id: string;
  name: string;
  brand?: string | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
}

/**
 * Upsert the shared FatSecret pointer row, stamping when its perishable half was read.
 *
 * Everything except `fatsecret_id` here is 24-hour data under their terms, so this is as much a
 * cache write as an insert — `source_fetched_at` is what lets the read path tell fresh from stale
 * rather than trusting that a row written once is still allowed to exist.
 */
export async function upsertFatSecretFood(input: UpsertFatSecretFoodInput): Promise<Food> {
  const id = input.fatsecret_id.trim();
  if (!id) throw new Error('upsertFatSecretFood: bad fatsecret_id');
  const defaultServing = Number.isInteger(input.default_serving) ? (input.default_serving as number) : 0;
  const [row] = await sql<Food[]>`
    insert into cadence.foods (
      owner_user_id, visibility, name, brand, source, off_id, fdc_id, fatsecret_id,
      source_fetched_at, base_unit, macros_per_base, servings, default_serving, confidence, photo_ref
    ) values (
      null, 'shared', ${input.name}, ${input.brand ?? null}, 'fatsecret', null, null, ${id},
      now(), ${input.base_unit}, ${json(input.macros_per_base ?? {})}, ${json(input.servings ?? [])},
      ${defaultServing}, 1, null
    )
    on conflict (fatsecret_id) do update set
      name = excluded.name,
      brand = excluded.brand,
      macros_per_base = excluded.macros_per_base,
      servings = excluded.servings,
      default_serving = excluded.default_serving,
      source_fetched_at = now(),
      source = 'fatsecret',
      visibility = 'shared',
      owner_user_id = null
    returning ${FOOD_COLS_PLAIN}`;
  if (!row) throw new Error('upsertFatSecretFood: no row returned');
  return row;
}

/** The shared pointer row for a FatSecret food, fresh or stale — the caller decides. */
export async function findFoodByFatSecretId(fatsecretId: string): Promise<Food | null> {
  const id = fatsecretId.trim();
  if (!id) return null;
  const [row] = await sql<Food[]>`
    select ${FOOD_COLS} from cadence.foods f
    where f.fatsecret_id = ${id} and f.source = 'fatsecret'
    limit 1`;
  return row ?? null;
}

/**
 * Strip a stale FatSecret row back to the one thing we may keep.
 *
 * Called when a row is past its 24 hours and the refresh failed. Retaining the numbers would breach
 * the terms; deleting the row would throw away the `fatsecret_id` we ARE allowed to keep, and with
 * it the user's stable reference. So the pointer survives and the perishable half does not — the
 * food comes back the moment the network does.
 */
export async function expireFatSecretFood(fatsecretId: string): Promise<void> {
  await sql`
    update cadence.foods
       set macros_per_base = '{}'::jsonb, servings = '[]'::jsonb, source_fetched_at = null
     where fatsecret_id = ${fatsecretId} and source = 'fatsecret'`;
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

/** When a food was eaten — the weekday/meal slot that teaches the rhythm (0039). */
export interface FoodUsageSlot {
  /** 0-6, Sunday-first, from the log's UTC date. */
  dow: number;
  meal: string;
}

/**
 * Bump the per-user usage projection after a confirmed log (teaches recents/frequents).
 * Idempotent upsert.
 *
 * With a slot, also bumps the per-weekday/meal histogram — that is what lets Wednesday breakfast
 * rank the café parfait first without the user searching for it (A23 §1c).
 */
export async function touchFoodUsage(userId: string, foodId: string, slot?: FoodUsageSlot): Promise<void> {
  await sql`
    insert into cadence.food_usage (user_id, food_id, use_count, last_used_at)
    values (${userId}, ${foodId}, 1, now())
    on conflict (user_id, food_id) do update set
      use_count = cadence.food_usage.use_count + 1,
      last_used_at = now()`;
  if (!slot || !Number.isInteger(slot.dow) || slot.dow < 0 || slot.dow > 6 || !slot.meal) return;
  await sql`
    insert into cadence.food_usage_ctx (user_id, food_id, dow, meal, use_count, last_used_at)
    values (${userId}, ${foodId}, ${slot.dow}, ${slot.meal}, 1, now())
    on conflict (user_id, food_id, dow, meal) do update set
      use_count = cadence.food_usage_ctx.use_count + 1,
      last_used_at = now()`;
}

export interface FoodContextRow {
  food_id: string;
  /** Times eaten in exactly this weekday+meal slot. */
  slot_count: number;
  /** Times eaten at this meal on any day — the weaker "you have this for breakfast" signal. */
  meal_count: number;
}

/**
 * The rhythm lookup: how often this user eats each food in THIS slot, and at this meal generally.
 * One query, both signals, so the ranker can weigh them differently.
 */
export async function listFoodContextRows(userId: string, slot: FoodUsageSlot, limit = 40): Promise<FoodContextRow[]> {
  if (!Number.isInteger(slot.dow) || slot.dow < 0 || slot.dow > 6 || !slot.meal) return [];
  const capped = Math.min(200, Math.max(1, limit));
  return sql<FoodContextRow[]>`
    select
      food_id,
      coalesce(sum(use_count) filter (where dow = ${slot.dow} and meal = ${slot.meal}), 0)::int as slot_count,
      coalesce(sum(use_count) filter (where meal = ${slot.meal}), 0)::int as meal_count
    from cadence.food_usage_ctx
    where user_id = ${userId} and (dow = ${slot.dow} or meal = ${slot.meal})
    group by food_id
    order by slot_count desc, meal_count desc
    limit ${capped}`;
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
