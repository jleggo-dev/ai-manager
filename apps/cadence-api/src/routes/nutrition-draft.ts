/**
 * Draft-meal routes (meal-logging rework, 2026-09-02). The wire contract is authored in
 * apps/cadence-web/src/lib/api/meal-draft.ts — these routes are built to match it exactly:
 * every mutation returns `{ meal }` (the updated row) so the client never re-derives state the
 * server just computed; close returns `{ meal: null }` when an empty draft dissolved.
 *
 * Own file, own router: routes/nutrition.ts sits near the size cap and the draft lifecycle is a
 * distinct responsibility. Mounted under /nutrition in app.ts beside it — the paths never
 * collide (this file owns /meals/draft, /meals/open and the /meals/:id/* draft verbs).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, parseBody, mealKindSchema } from '../validation/body.ts';
import {
  appendFood,
  appendParsed,
  appendRecipe,
  closeMeal,
  getOpenMeal,
  openDraft,
  removeItem,
  setAmount,
  setSlot,
} from '../services/meal-draft.ts';
import { editMealParts, savePartAsRecipe, PartOpError, type MealPartOp } from '../services/meal-parts.ts';

const router = Router();
router.use(requireCadenceUser);

/** The caller's IANA zone, when the client sent one — decides which calendar day "today" is. */
function tzHint(req: Request): string | null {
  const h = req.header('X-Cadence-Timezone');
  return h && h.length < 64 ? h : null;
}

/** One error ladder for every draft route: validation/grammar → 400, missing → 404, window → 409. */
function sendError(res: Response, err: unknown, label: string, fallback: string): void {
  if (err instanceof BodyValidationError || err instanceof PartOpError) {
    return void res.status(400).json({ error: err.message });
  }
  const msg = err instanceof Error ? err.message : '';
  if (/not found/.test(msg)) return void res.status(404).json({ error: msg });
  if (/not open/.test(msg)) return void res.status(409).json({ error: msg });
  if (/index is not|must be/.test(msg)) return void res.status(400).json({ error: msg });
  console.error(label, err);
  res.status(500).json({ error: fallback });
}

/* ── Body schemas (local on purpose — validation/body.ts is a contention point) ─ */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const openDraftBody = z.object({
  meal: mealKindSchema.optional(),
  date: dateSchema.optional(),
});

const parsedItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(120).optional(),
  qty: z.number().positive().max(10_000).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  est: z.record(z.string(), z.unknown()).optional(),
  food_id: z.string().uuid().optional(),
});

/** POST /:id/items carries exactly one of: a food, a recipe, or already-parsed rows. */
const appendBody = z
  .object({
    food_id: z.string().uuid({ message: 'food_id must be a uuid' }).optional(),
    serving_index: z.number().int().min(0).optional(),
    quantity: z.number().positive().max(10_000).optional(),
    recipe_id: z.string().uuid({ message: 'recipe_id must be a uuid' }).optional(),
    servings: z.number().positive().max(100).optional(),
    parsed: z.array(parsedItemSchema).min(1).max(20).optional(),
  })
  .superRefine((val, ctx) => {
    const doors = [val.food_id, val.recipe_id, val.parsed].filter((v) => v !== undefined).length;
    if (doors !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'send exactly one of food_id, recipe_id, or parsed',
      });
    }
  });

const removeBody = z.object({ index: z.number().int().min(0) });
const amountBody = z.object({ index: z.number().int().min(0), qty: z.number().positive().max(10_000) });
const slotBody = z.object({ meal: mealKindSchema });

/** Mirrors the client's MealPartOp union — the grammar itself is enforced in meal-parts.ts. */
const partsBody = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('group'),
    item_indexes: z.array(z.number().int().min(0)).min(2).max(40),
    name: z.string().max(120).nullable().optional(),
  }),
  z.object({ op: z.literal('ungroup'), part: z.string().min(1).max(40) }),
  z.object({ op: z.literal('rename'), part: z.string().min(1).max(40), name: z.string().trim().min(1).max(120) }),
  z.object({
    op: z.literal('set_yield'),
    part: z.string().min(1).max(40),
    yield_servings: z.number().int().min(1).max(99),
    servings_logged: z.number().positive().max(99).optional(),
  }),
  z.object({ op: z.literal('add'), part: z.string().min(1).max(40), index: z.number().int().min(0) }),
  z.object({ op: z.literal('remove'), part: z.string().min(1).max(40), index: z.number().int().min(0) }),
]);

const savePartBody = z.object({
  part: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  yield_servings: z.number().int().min(1).max(99).optional(),
});

/* ── The draft lifecycle ─────────────────────────────────────────────────── */

/** POST /nutrition/meals/draft — open (or rejoin) the draft for a slot. Idempotent per date+slot. */
router.post('/meals/draft', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(openDraftBody, req.body);
    res.json({ meal: await openDraft(userId, body, tzHint(req)) });
  } catch (err) {
    sendError(res, err, '[POST /nutrition/meals/draft]', 'failed to open the meal');
  }
});

/** GET /nutrition/meals/open — the one open meal, if any (expires overdue drafts first). */
router.get('/meals/open', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ meal: await getOpenMeal(userId) });
  } catch (err) {
    sendError(res, err, '[GET /nutrition/meals/open]', 'failed to load the open meal');
  }
});

/** POST /nutrition/meals/:id/items — append a food, a recipe (as a part), or parsed rows. */
router.post('/meals/:id/items', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const logId = String(req.params.id);
  try {
    const body = parseBody(appendBody, req.body);
    const meal = body.food_id
      ? await appendFood(userId, logId, {
          food_id: body.food_id,
          serving_index: body.serving_index,
          quantity: body.quantity,
        })
      : body.recipe_id
        ? await appendRecipe(userId, logId, { recipe_id: body.recipe_id, servings: body.servings })
        : await appendParsed(userId, logId, body.parsed!);
    res.json({ meal });
  } catch (err) {
    sendError(res, err, '[POST /nutrition/meals/:id/items]', 'failed to add to the meal');
  }
});

/** POST /nutrition/meals/:id/items/remove — take one item back out; an emptied draft stays open. */
router.post('/meals/:id/items/remove', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(removeBody, req.body);
    res.json({ meal: await removeItem(userId, String(req.params.id), body.index) });
  } catch (err) {
    sendError(res, err, '[POST /nutrition/meals/:id/items/remove]', 'failed to remove the item');
  }
});

/** PATCH /nutrition/meals/:id/amount — the stepper: set one item's qty, estimate rescales. */
router.patch('/meals/:id/amount', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(amountBody, req.body);
    res.json({ meal: await setAmount(userId, String(req.params.id), body.index, body.qty) });
  } catch (err) {
    sendError(res, err, '[PATCH /nutrition/meals/:id/amount]', 'failed to set the amount');
  }
});

/** PATCH /nutrition/meals/:id/slot — move the draft to another slot (the header chip). */
router.patch('/meals/:id/slot', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(slotBody, req.body);
    res.json({ meal: await setSlot(userId, String(req.params.id), body.meal) });
  } catch (err) {
    sendError(res, err, '[PATCH /nutrition/meals/:id/slot]', 'failed to move the meal');
  }
});

/** POST /nutrition/meals/:id/close — the commit. An empty draft closes to nothing (meal: null). */
router.post('/meals/:id/close', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ meal: await closeMeal(userId, String(req.params.id)) });
  } catch (err) {
    sendError(res, err, '[POST /nutrition/meals/:id/close]', 'failed to close the meal');
  }
});

/* ── Parts (the bracket) ─────────────────────────────────────────────────── */

/** PATCH /nutrition/meals/:id/parts — all bracket edits, one door. Open AND closed meals. */
router.patch('/meals/:id/parts', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(partsBody, req.body);
    res.json({ meal: await editMealParts(userId, String(req.params.id), body as MealPartOp) });
  } catch (err) {
    sendError(res, err, '[PATCH /nutrition/meals/:id/parts]', 'failed to edit the meal');
  }
});

/** POST /nutrition/meals/:id/save-part — name a part into the cookbook (snapshot semantics). */
router.post('/meals/:id/save-part', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(savePartBody, req.body);
    res.json(await savePartAsRecipe(userId, String(req.params.id), body));
  } catch (err) {
    sendError(res, err, '[POST /nutrition/meals/:id/save-part]', 'failed to save the recipe');
  }
});

export default router;
