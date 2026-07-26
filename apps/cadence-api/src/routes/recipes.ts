import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { generateRecipesFromIngredients, parseFridgePhoto } from '../services/fridge-recipes.ts';
import {
  createRecipe,
  getRecipeForUser,
  listRecipesForUser,
  patchRecipe,
  recipeFromChat,
  removeRecipe,
  searchRecipesForUser,
} from '../services/recipe.ts';
import { discoverRecipes } from '../services/recipe-discover.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { discoverRecipeBodySchema } from '../validation/meal-plan.ts';
import {
  createRecipeBodySchema,
  fromChatBodySchema,
  generateFromIngredientsBodySchema,
  parseFridgeBodySchema,
  patchRecipeBodySchema,
} from '../validation/recipe.ts';

const router = Router();
router.use(requireCadenceUser);

function limitFromQuery(raw: unknown, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(n)));
}

function photoErrorStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : '';
  if (/invalid photo/.test(msg)) return 400;
  return null;
}

/** GET /nutrition/recipes — list (newest first). ?saved=1 for saved-only. */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const savedOnly = req.query.saved === '1' || req.query.saved === 'true';
  try {
    res.json({ recipes: await listRecipesForUser(userId, { savedOnly, limit: limitFromQuery(req.query.limit) }) });
  } catch (err) {
    console.error('[GET /nutrition/recipes]', err);
    res.status(500).json({ error: 'failed to list recipes' });
  }
});

/** GET /nutrition/recipes/search?q= — name search over saved recipes. */
router.get('/search', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    res.json({ recipes: await searchRecipesForUser(userId, q, limitFromQuery(req.query.limit, 20)) });
  } catch (err) {
    console.error('[GET /nutrition/recipes/search]', err);
    res.status(500).json({ error: 'failed to search recipes' });
  }
});

/**
 * POST /nutrition/recipes/from-chat — structure_recipe → resolve → computed macros.
 * Returns an unsaved draft (+ dietary flags). Confirm via POST /nutrition/recipes.
 */
router.post('/from-chat', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(fromChatBodySchema, req.body);
    res.json(await recipeFromChat(userId, body.text));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/required|non-JSON|missing name|no usable/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/recipes/from-chat]', err);
    res.status(500).json({ error: 'failed to structure recipe' });
  }
});

/**
 * POST /nutrition/recipes/parse-fridge — fridge/pantry photo → ingredient list (unsaved).
 * User reviews ingredients, then POST /generate. Confirm-before-save via POST /.
 */
router.post('/parse-fridge', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(parseFridgeBodySchema, req.body);
    res.json(await parseFridgePhoto(userId, body));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const photoStatus = photoErrorStatus(err);
    if (photoStatus) return void res.status(photoStatus).json({ error: (err as Error).message });
    console.error('[POST /nutrition/recipes/parse-fridge]', err);
    res.status(502).json({ error: 'failed to read fridge photo' });
  }
});

/**
 * POST /nutrition/recipes/generate — reviewed ingredients → recipe draft ideas (unsaved).
 * Allergen-unsafe ideas are dropped server-side. Confirm via POST /nutrition/recipes.
 */
router.post('/generate', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(generateFromIngredientsBodySchema, req.body);
    res.json(await generateRecipesFromIngredients(userId, body));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/at least one ingredient|non-JSON/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/recipes/generate]', err);
    res.status(502).json({ error: 'failed to generate recipes' });
  }
});

/**
 * POST /nutrition/recipes/discover — query → 1–3 recipe drafts (scoped; not live web search).
 * Confirm via POST /nutrition/recipes. Real retrieval lands with cadence-research later.
 */
router.post('/discover', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(discoverRecipeBodySchema, req.body);
    res.json(await discoverRecipes(userId, body.query));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/query required|non-JSON/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/recipes/discover]', err);
    res.status(502).json({ error: 'failed to discover recipes' });
  }
});

/** POST /nutrition/recipes — confirm/save (macros recomputed server-side). */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createRecipeBodySchema, req.body);
    const { recipe, dietary } = await createRecipe(userId, body);
    res.status(201).json({ recipe, dietary });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/recipes]', err);
    res.status(500).json({ error: 'failed to save recipe' });
  }
});

/** GET /nutrition/recipes/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const recipe = await getRecipeForUser(userId, String(req.params.id));
    if (!recipe) return void res.status(404).json({ error: 'recipe not found' });
    res.json({ recipe });
  } catch (err) {
    console.error('[GET /nutrition/recipes/:id]', err);
    res.status(500).json({ error: 'failed to load recipe' });
  }
});

/** PATCH /nutrition/recipes/:id — edit; macros recomputed when ingredients/servings change. */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(patchRecipeBodySchema, req.body);
    const result = await patchRecipe(userId, String(req.params.id), body);
    if (!result) return void res.status(404).json({ error: 'recipe not found' });
    res.json(result);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /nutrition/recipes/:id]', err);
    res.status(500).json({ error: 'failed to update recipe' });
  }
});

/** DELETE /nutrition/recipes/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await removeRecipe(userId, String(req.params.id));
    if (!ok) return void res.status(404).json({ error: 'recipe not found' });
    res.status(204).end();
  } catch (err) {
    console.error('[DELETE /nutrition/recipes/:id]', err);
    res.status(500).json({ error: 'failed to delete recipe' });
  }
});

export default router;
