/**
 * The food-log buttons against the REAL routes they call — both sides at once (the shape and the
 * reason: src/test/client-route.ts).
 *
 * The meal card's confirm posts the preview it was handed BACK to the log route verbatim
 * (MealParseCard → logPreviewedMeal, the card spreading the preview and replacing its rows). So the
 * contract that matters is a round trip: what /meals/preview (or the photo door's /photo/preview)
 * answers, the log route must take back. Every field the read adds for the card — the trace, the
 * basis, the question rows' words — has to be dropped by the log's body check, never refused by
 * it, or a meal that read fine can never be logged. That round trip runs here with the web app's
 * own lib/api functions, plus the saved-food, plate and take-back buttons. Faked: the services.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const OATS = '6f1c3a52-6a77-4b3e-9a0e-0b6f2a1c9d10';
const MILK = '0c2d8e9f-1b3a-4c5d-8e7f-9a0b1c2d3e4f';

/** What reached the log service, and the meals on file. */
let logged: Record<string, unknown>[] = [];
let meals: Set<string>;

/** A coach-led read with every field the card is given, as previewMealParse answers it. */
function coachRead(raw_text: string, extra: Record<string, unknown> = {}) {
  return {
    meal: 'breakfast',
    items: [
      {
        name: 'Rolled oats',
        brand: 'Quaker',
        qty: 40,
        unit: 'g',
        est: { kcal: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
        food_id: OATS,
        said: 'a bowl of oats',
        basis: 'saved_food',
        source_label: 'your saved food',
      },
      {
        name: 'Milk',
        qty: 250,
        unit: 'ml',
        est: { kcal: 125, protein_g: 8, carbs_g: 12, fat_g: 5 },
        food_id: MILK,
        said: 'some milk',
        basis: 'estimate',
        source_label: "the coach's estimate",
        assumption: 'Took this as 2% milk',
      },
    ],
    macros: { kcal: 275, protein_g: 13, carbs_g: 39, fat_g: 8 },
    confidence: 0.8,
    flags: {},
    raw_text,
    coach: { reached: true, calls: 1, checked: ['oats: your saved food', 'milk: estimated'], not_read: ['a coffee'] },
    ...extra,
  };
}

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../services/nutrition.ts', () => ({
  previewMealParse: async (_u: string, text: string) => coachRead(text),
  logMeal: async (_u: string, input: Record<string, unknown>) => {
    if (input.food_id && input.food_id !== OATS) throw new Error('food not found');
    logged.push(input);
    const log_id = `log-${logged.length}`;
    meals.add(log_id);
    const parsed = input.parsed as { meal?: string; items?: unknown[] } | undefined;
    return { log_id, date: '2026-11-01', meal: parsed?.meal ?? input.meal ?? 'other', items: parsed?.items ?? [] };
  },
  removeMeal: async (_u: string, id: string) => meals.delete(id),
  clearTargets: async () => {},
  getBaselineRead: async () => null,
  getNutritionDay: async () => null,
  getNutritionInsight: async () => null,
  getNutritionSummary: async () => null,
  getPlateAdvice: async () => null,
  listRecentMeals: async () => [],
  patchMeal: async () => null,
  setEatbackPct: async () => {},
  setTargets: async () => {},
}));
vi.mock('../services/meal-photo-read.ts', () => ({
  readMealPhoto: async () => ({
    photo_ref: 'u1/2026-11-01/plate.jpg',
    reading: 'A bowl of oats with milk.',
    error: null,
  }),
  previewMealFromReading: async (_u: string, body: { reading: string }) =>
    coachRead('oats, milk', { photo_ref: 'u1/2026-11-01/plate.jpg', photo_reading: body.reading }),
  logMealFromReading: async () => null,
}));
vi.mock('../services/food-described-answer.ts', () => ({
  previewAnsweredPart: async () => ({ ...coachRead('some milk'), items: [coachRead('').items[1]] }),
}));
vi.mock('../services/water.ts', () => ({ logWater: async () => null }));
vi.mock('../services/meal-corrections.ts', () => ({
  mergeItems: async () => null,
  reachBackToPin: async () => null,
  renameItem: async () => null,
}));
vi.mock('../repos/nutrition.ts', () => ({ findNutritionLog: async () => null }));
vi.mock('../services/meal-enrich.ts', () => ({ enrichMeal: async () => null }));
vi.mock('../services/food-sweep.ts', () => ({ kickFoodSweep: () => {} }));

type Preview = ReturnType<typeof coachRead> & { photo_ref?: string; photo_reading?: string };
interface Meal {
  log_id: string;
  meal: string;
  items: { name: string }[];
}
/** The slice of the web client's lib/api/nutrition.ts the food screens use to log. */
interface WebNutritionApi {
  previewMeal(text: string, meal?: string): Promise<Preview>;
  previewMealAnswer(input: { asked_about: string; answer: string; chosen: boolean; meal?: string }): Promise<Preview>;
  readMealPhoto(photo: string, caption?: string): Promise<{ photo_ref: string; reading: string; error: null }>;
  previewMealFromReading(input: { reading: string; caption?: string; meal?: string }): Promise<Preview>;
  logPreviewedMeal(parsed: Preview, meal?: string): Promise<Meal>;
  logMealFromFood(input: {
    food_id: string;
    meal?: string;
    serving_index?: number;
    quantity?: number;
  }): Promise<Meal | null>;
  logMealFromItems(input: { items: { food_id: string; quantity?: number }[]; meal?: string }): Promise<Meal | null>;
  deleteMeal(logId: string): Promise<boolean>;
}

const { default: nutritionRoutes } = await import('./nutrition.ts');
let served: ClientAgainstRoutes<WebNutritionApi>;
let web: WebNutritionApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebNutritionApi>('nutrition.ts', (app) =>
    app.use('/nutrition', nutritionRoutes),
  );
  web = served.web;
});
afterAll(() => served.close());

beforeEach(() => {
  logged = [];
  meals = new Set();
});

/** What the card's confirm sends: the preview it was handed, its rows as the person left them. */
function asTheCardSendsIt(p: Preview): Preview {
  return { ...p, items: p.items.map((r) => ({ ...r })) };
}

describe('a described meal: read, then confirm (MealParseCard)', () => {
  it('the read comes back whole, and the confirm of exactly that read is logged', async () => {
    const read = await web.previewMeal('a bowl of oats and some milk', 'breakfast');
    expect(read.items.map((i) => i.name)).toEqual(['Rolled oats', 'Milk']);
    expect(read.coach.checked).toHaveLength(2);

    const meal = await web.logPreviewedMeal(asTheCardSendsIt(read), 'breakfast');
    expect(meal).toMatchObject({ log_id: 'log-1', meal: 'breakfast' });
    expect(meal.items.map((i) => i.name)).toEqual(['Rolled oats', 'Milk']);
  });

  it("the confirm keeps what the server prices from (the food link, their words) and drops the card's extras", async () => {
    await web.logPreviewedMeal(asTheCardSendsIt(await web.previewMeal('a bowl of oats and some milk')));
    const parsed = logged[0]!.parsed as { items: Record<string, unknown>[] } & Record<string, unknown>;
    expect(parsed.items[0]).toMatchObject({ food_id: OATS, said: 'a bowl of oats', brand: 'Quaker' });
    expect(parsed.items[1]).not.toHaveProperty('assumption');
    expect(parsed).not.toHaveProperty('coach');
  });

  it('an answered question row comes back as a priced row the confirm takes', async () => {
    const answered = await web.previewMealAnswer({ asked_about: 'some milk', answer: '2%', chosen: true });
    expect(answered.items).toHaveLength(1);
    await expect(web.logPreviewedMeal(asTheCardSendsIt(answered))).resolves.toMatchObject({ log_id: 'log-1' });
  });
});

describe('the photo door: read the photo, read the meal, confirm', () => {
  it('the photo and the reading ride from the read to the logged row', async () => {
    const photo = await web.readMealPhoto('data:image/jpeg;base64,AAAA');
    const read = await web.previewMealFromReading({ reading: photo.reading, meal: 'breakfast' });
    expect(read.photo_ref).toBe(photo.photo_ref);

    await web.logPreviewedMeal(asTheCardSendsIt(read), 'breakfast');
    expect(logged[0]!.parsed).toMatchObject({
      photo_ref: 'u1/2026-11-01/plate.jpg',
      photo_reading: 'A bowl of oats with milk.',
    });
  });

  it("a reading's list as long as the photo door allows still logs", async () => {
    const long = 'oats, '.repeat(200).slice(0, 1000);
    const read = { ...(await web.previewMealFromReading({ reading: 'x' })), raw_text: long };
    await expect(web.logPreviewedMeal(asTheCardSendsIt(read))).resolves.toMatchObject({ log_id: 'log-1' });
  });
});

describe('the deterministic logs: a saved food, a plate, taking one back', () => {
  it('a saved food logs and reads as logged; an unknown one reads as not logged (null), not as a meal', async () => {
    expect(await web.logMealFromFood({ food_id: OATS, meal: 'snack', quantity: 2 })).toMatchObject({ log_id: 'log-1' });
    expect(await web.logMealFromFood({ food_id: MILK })).toBeNull();
  });

  it('a plate logs as one meal', async () => {
    const meal = await web.logMealFromItems({ items: [{ food_id: OATS }, { food_id: MILK, quantity: 1.5 }] });
    expect(meal).toMatchObject({ log_id: 'log-1' });
    expect(logged).toHaveLength(1);
  });

  it('taking a meal back reads as done, and a second take-back as not found', async () => {
    const meal = await web.logMealFromFood({ food_id: OATS });
    expect(await web.deleteMeal(meal!.log_id)).toBe(true);
    expect(await web.deleteMeal(meal!.log_id)).toBe(false);
  });
});
