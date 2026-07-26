import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  confirmMealPlan,
  generateMealPlan,
  getMealPlanForUser,
  getMealPlanForWeek,
  listMealPlansForUser,
  patchMealPlanForUser,
  removeMealPlan,
} from '../services/meal-plan.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import {
  confirmMealPlanBodySchema,
  generateMealPlanBodySchema,
  patchMealPlanBodySchema,
} from '../validation/meal-plan.ts';

const router = Router();
router.use(requireCadenceUser);

function limitFromQuery(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(52, Math.max(1, Math.trunc(n)));
}

/** GET /nutrition/meal-plans — list (newest week first). ?week_of=YYYY-MM-DD for one week. */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const weekOf = typeof req.query.week_of === 'string' ? req.query.week_of : '';
  try {
    if (weekOf) {
      const plan = await getMealPlanForWeek(userId, weekOf);
      return void res.json({ meal_plan: plan });
    }
    res.json({ meal_plans: await listMealPlansForUser(userId, limitFromQuery(req.query.limit)) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/week_of must be/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[GET /nutrition/meal-plans]', err);
    res.status(500).json({ error: 'failed to list meal plans' });
  }
});

/**
 * POST /nutrition/meal-plans/generate — prefs/fridge/recipes → unsaved week draft + shopping list.
 * Confirm via POST /nutrition/meal-plans (brand: confirm-before-save).
 */
router.post('/generate', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(generateMealPlanBodySchema, req.body);
    res.json(await generateMealPlan(userId, body));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/week_of must be/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/meal-plans/generate]', err);
    res.status(502).json({ error: 'failed to generate meal plan' });
  }
});

/** POST /nutrition/meal-plans — confirm draft (creates recipes as needed, upserts week plan). */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(confirmMealPlanBodySchema, req.body);
    const meal_plan = await confirmMealPlan(userId, {
      week_of: body.week_of,
      days: body.days.map((d) => ({
        day: d.day,
        meals: d.meals.map((m) => ({
          slot: m.slot,
          recipe: {
            name: m.recipe.name,
            servings: m.recipe.servings,
            ingredients: m.recipe.ingredients,
            steps: m.recipe.steps ?? [],
            tags: m.recipe.tags ?? [],
            reuse_recipe_id: m.recipe.reuse_recipe_id ?? null,
          },
        })),
      })),
      shopping_list: body.shopping_list,
      notes: body.notes,
    });
    res.status(201).json({ meal_plan });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/week_of must be|at least one|bad day|ingredients required|recipe not found/.test(msg)) {
      return void res.status(/not found/.test(msg) ? 404 : 400).json({ error: msg });
    }
    console.error('[POST /nutrition/meal-plans]', err);
    res.status(500).json({ error: 'failed to save meal plan' });
  }
});

/** GET /nutrition/meal-plans/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const plan = await getMealPlanForUser(userId, String(req.params.id));
    if (!plan) return void res.status(404).json({ error: 'meal plan not found' });
    res.json({ meal_plan: plan });
  } catch (err) {
    console.error('[GET /nutrition/meal-plans/:id]', err);
    res.status(500).json({ error: 'failed to get meal plan' });
  }
});

/** PATCH /nutrition/meal-plans/:id — days, shopping_list checkoffs, notes. */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(patchMealPlanBodySchema, req.body);
    const meal_plan = await patchMealPlanForUser(userId, String(req.params.id), body);
    if (!meal_plan) return void res.status(404).json({ error: 'meal plan not found' });
    res.json({ meal_plan });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/recipe not found/.test(msg)) return void res.status(404).json({ error: msg });
    console.error('[PATCH /nutrition/meal-plans/:id]', err);
    res.status(500).json({ error: 'failed to update meal plan' });
  }
});

/** DELETE /nutrition/meal-plans/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await removeMealPlan(userId, String(req.params.id));
    if (!ok) return void res.status(404).json({ error: 'meal plan not found' });
    res.status(204).end();
  } catch (err) {
    console.error('[DELETE /nutrition/meal-plans/:id]', err);
    res.status(500).json({ error: 'failed to delete meal plan' });
  }
});

export default router;
