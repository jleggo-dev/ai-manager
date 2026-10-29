/**
 * The `?preview=meal` fixture — a dozen foods with honest numbers, the item shape the draft
 * holds, and the little helpers the in-memory server needs. Its own file so the preview itself
 * stays the server and the screen, not a table.
 */
export type Item = {
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  est?: Record<string, number>;
  food_id?: string;
};
export type Part = {
  key: string;
  name: string | null;
  recipe_id?: string | null;
  yield_servings?: number;
  servings_logged?: number;
};

export const FOODS: Record<
  string,
  {
    name: string;
    brand: string | null;
    kcal: number;
    p: number;
    c: number;
    f: number;
    unit: string;
    label: string;
    ambiguous: boolean;
  }
> = {
  'f-espresso': {
    name: 'Espresso',
    brand: null,
    kcal: 1,
    p: 0,
    c: 0,
    f: 0,
    unit: 'capsule',
    label: '1 capsule',
    ambiguous: false,
  },
  'f-milk': {
    name: 'Milk, 2%',
    brand: null,
    kcal: 122,
    p: 8,
    c: 12,
    f: 5,
    unit: 'cup',
    label: '1 cup (244g)',
    ambiguous: false,
  },
  'f-blueberries': {
    name: 'Frozen blueberries',
    brand: null,
    kcal: 79,
    p: 1,
    c: 19,
    f: 1,
    unit: 'cup',
    label: '1 cup (155g)',
    ambiguous: false,
  },
  'f-strawberries': {
    name: 'Frozen strawberries',
    brand: null,
    kcal: 50,
    p: 1,
    c: 13,
    f: 0,
    unit: 'cup',
    label: '1 cup (149g)',
    ambiguous: false,
  },
  'f-skyr': {
    name: 'Creamy skyr, plain',
    brand: 'Siggi’s',
    kcal: 100,
    p: 12,
    c: 5,
    f: 4,
    unit: 'serving',
    label: '1 container (150g)',
    ambiguous: false,
  },
  'f-oats': {
    name: 'Rolled oats',
    brand: null,
    kcal: 150,
    p: 5,
    c: 27,
    f: 3,
    unit: 'cup',
    label: '½ cup dry (40g)',
    ambiguous: false,
  },
  'f-banana': {
    name: 'Banana, raw',
    brand: null,
    kcal: 121,
    p: 1.5,
    c: 31,
    f: 0.4,
    unit: 'large',
    label: '1 Large (20cm To 22.5cm Long) (136g)',
    ambiguous: true,
  },
  'f-eggs': {
    name: 'Eggs, scrambled',
    brand: null,
    kcal: 91,
    p: 6,
    c: 1,
    f: 7,
    unit: 'egg',
    label: '1 large egg',
    ambiguous: false,
  },
  'f-toast': {
    name: 'Sourdough toast',
    brand: null,
    kcal: 120,
    p: 4,
    c: 23,
    f: 1,
    unit: 'slice',
    label: '1 slice (45g)',
    ambiguous: false,
  },
  'f-pb': {
    name: 'Peanut butter',
    brand: null,
    kcal: 95,
    p: 4,
    c: 3,
    f: 8,
    unit: 'tbsp',
    label: '1 tbsp (16g)',
    ambiguous: false,
  },
  'f-honey': {
    name: 'Honey',
    brand: null,
    kcal: 64,
    p: 0,
    c: 17,
    f: 0,
    unit: 'tbsp',
    label: '1 tbsp (21g)',
    ambiguous: false,
  },
  'f-granola': {
    name: 'Granola',
    brand: null,
    kcal: 210,
    p: 5,
    c: 32,
    f: 7,
    unit: 'cup',
    label: '½ cup (55g)',
    ambiguous: false,
  },
};

export const itemOf = (id: string, qty = 1): Item => {
  const f = FOODS[id]!;
  return {
    name: f.name,
    ...(f.brand ? { brand: f.brand } : {}),
    qty,
    unit: f.unit,
    est: { kcal: f.kcal * qty, protein_g: f.p * qty, carbs_g: f.c * qty, fat_g: f.f * qty },
    food_id: id,
  };
};

export const sum = (items: Item[]) =>
  items.reduce(
    (t, it) => {
      for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) t[k] = (t[k] ?? 0) + (it.est?.[k] ?? 0);
      return t;
    },
    {} as Record<string, number>,
  );

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
