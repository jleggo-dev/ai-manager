import { sql, json } from '../db/sql.ts';
import type { Macros, Recipe } from '@cadence/shared';

// created_at cast to text — postgres.js Date-object trap (same as foods/nutrition).
const COLS = sql`
  recipe_id, name, source, servings, ingredients, steps, macros_per_serving, tags, saved,
  created_at::text as created_at`;

export type RecipeSource = Recipe['source'];
export type RecipeIngredient = Recipe['ingredients'][number];

export interface CreateRecipeInput {
  name: string;
  source: RecipeSource;
  servings: number;
  ingredients: RecipeIngredient[];
  steps?: string[];
  macros_per_serving: Macros;
  tags?: string[];
  saved?: boolean;
}

export interface UpdateRecipeInput {
  name?: string;
  servings?: number;
  ingredients?: RecipeIngredient[];
  steps?: string[];
  macros_per_serving?: Macros;
  tags?: string[];
  saved?: boolean;
}

/** Fetch one recipe the user owns. Dual-keyed. */
export async function getRecipe(userId: string, recipeId: string): Promise<Recipe | null> {
  const [row] = await sql<Recipe[]>`
    select ${COLS} from cadence.recipes
    where recipe_id = ${recipeId} and user_id = ${userId}
    limit 1`;
  return row ?? null;
}

/** List the user's recipes, newest first. Optionally only saved. */
export async function listRecipes(
  userId: string,
  opts: { savedOnly?: boolean; limit?: number } = {},
): Promise<Recipe[]> {
  const capped = Math.min(100, Math.max(1, opts.limit ?? 50));
  if (opts.savedOnly) {
    return sql<Recipe[]>`
      select ${COLS} from cadence.recipes
      where user_id = ${userId} and saved = true
      order by created_at desc
      limit ${capped}`;
  }
  return sql<Recipe[]>`
    select ${COLS} from cadence.recipes
    where user_id = ${userId}
    order by created_at desc
    limit ${capped}`;
}

/**
 * Name search over the user's recipes (for resolver + Food tab).
 * Empty q returns [] — callers use listRecipes for the empty-search UI.
 */
export async function searchRecipes(userId: string, q: string, limit = 20): Promise<Recipe[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const capped = Math.min(50, Math.max(1, limit));
  const pattern = `%${query}%`;
  return sql<Recipe[]>`
    select ${COLS} from cadence.recipes
    where user_id = ${userId}
      and saved = true
      and lower(name) like ${pattern}
    order by created_at desc
    limit ${capped}`;
}

/** Insert a user-owned recipe. */
export async function insertRecipe(userId: string, input: CreateRecipeInput): Promise<Recipe> {
  const servings = Number.isInteger(input.servings) && input.servings > 0 ? input.servings : 1;
  const [row] = await sql<Recipe[]>`
    insert into cadence.recipes (
      user_id, name, source, servings, ingredients, steps, macros_per_serving, tags, saved
    ) values (
      ${userId}, ${input.name}, ${input.source}, ${servings},
      ${json(input.ingredients ?? [])}, ${json(input.steps ?? [])},
      ${json(input.macros_per_serving ?? {})}, ${input.tags ?? []},
      ${input.saved ?? true}
    )
    returning ${COLS}`;
  if (!row) throw new Error('insertRecipe: no row returned');
  return row;
}

/** Patch a recipe the user owns. Recomputed macros are passed in by the service. */
export async function updateRecipe(userId: string, recipeId: string, patch: UpdateRecipeInput): Promise<Recipe | null> {
  const [row] = await sql<Recipe[]>`
    update cadence.recipes set
      name = coalesce(${patch.name ?? null}, name),
      servings = coalesce(${patch.servings ?? null}, servings),
      ingredients = coalesce(${patch.ingredients ? json(patch.ingredients) : null}, ingredients),
      steps = coalesce(${patch.steps ? json(patch.steps) : null}, steps),
      macros_per_serving = coalesce(
        ${patch.macros_per_serving ? json(patch.macros_per_serving) : null},
        macros_per_serving
      ),
      tags = coalesce(${patch.tags ?? null}, tags),
      saved = coalesce(${patch.saved ?? null}, saved)
    where recipe_id = ${recipeId} and user_id = ${userId}
    returning ${COLS}`;
  return row ?? null;
}

/** Delete a recipe the user owns. */
export async function deleteRecipe(userId: string, recipeId: string): Promise<boolean> {
  const rows = await sql`
    delete from cadence.recipes
    where recipe_id = ${recipeId} and user_id = ${userId}
    returning recipe_id`;
  return rows.length > 0;
}
