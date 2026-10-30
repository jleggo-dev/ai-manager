/**
 * The food-check eval's meals (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29).
 *
 * Two kinds:
 *   - `real`  the owner's own breakfasts, Aug 15 – Sep 9, in their own words (typos kept)
 *   - `pair`  near-misses a name match gets wrong: two foods with similar names and very different
 *             numbers (peanut butter vs powdered peanut butter, cooked vs dry rice)
 *
 * The expected totals are reference values (USDA FoodData Central standard portions, and the
 * vendor's published numbers for the Starbucks item), written down by hand on 2026-10-29. They
 * are the yardstick, not the truth: a tolerance is set per case, and wider where the words leave
 * the amount or the variety open. Review them before trusting a score — a wrong expected value
 * here scores a right answer as wrong.
 *
 * `flag` names words that SHOULD draw a question or a stated assumption, because the words alone
 * cannot settle them ("one cup of protein", milk with no fat level). A model that silently picks
 * one is not wrong on the numbers, but it is wrong on the behaviour the card needs.
 */

export interface FoodCheckCase {
  id: string;
  kind: 'real' | 'pair';
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  text: string;
  /** Expected meal totals. */
  kcal: number;
  protein_g: number;
  /** Relative tolerance on kcal (default 0.2). Wider where the words leave the amount open. */
  kcalTol?: number;
  /** Relative tolerance on protein (default 0.25). */
  proteinTol?: number;
  /** Words that should draw a question or a stated assumption. */
  flag?: string[];
  /** How the expected value was arrived at — so a reviewer can check it. */
  why: string;
}

export const FOOD_CHECK_CASES: FoodCheckCase[] = [
  // ── The owner's real breakfasts ─────────────────────────────────────────────────────────────
  {
    id: 'real-milk-150',
    kind: 'real',
    meal: 'breakfast',
    text: '150ml 2% mulk',
    kcal: 76,
    protein_g: 5.1,
    why: '2% milk ≈ 50 kcal and 3.4 g protein per 100 ml',
  },
  {
    id: 'real-espresso',
    kind: 'real',
    meal: 'breakfast',
    text: '1 espresso',
    kcal: 3,
    protein_g: 0.1,
    kcalTol: 2,
    proteinTol: 5,
    why: 'one shot ≈ 30 g, ~3 kcal — near zero, so the tolerance is wide in relative terms',
  },
  {
    id: 'real-smoothie-bowl',
    kind: 'real',
    meal: 'breakfast',
    text:
      'Quarter cup of frozen blueberries quarter cup of frozen strawberries, 1 tablespoon of pumpkin ' +
      'seeds from Yupik, 1 tablespoon of Chia seeds from Yupik . 150ml milk. 1 shot espresso',
    kcal: 225,
    protein_g: 12,
    kcalTol: 0.25,
    flag: ['milk'],
    why:
      'blueberries 39 g 20 kcal · strawberries 37 g 13 kcal · pumpkin seeds 9 g 50 kcal 2.7 g P · ' +
      'chia 12 g 58 kcal 2 g P · 150 ml milk 50–95 kcal by fat level (2% = 76, 5 g P) · espresso 3',
  },
  {
    id: 'real-eggs-plate',
    kind: 'real',
    meal: 'breakfast',
    text: '2 large eggs\n1 small ball bococini\nHandful of arugula\n1 tbsp butter\n1 tbsp olive oil\n2 Roma tomatoes',
    kcal: 470,
    protein_g: 19,
    kcalTol: 0.2,
    flag: ['bococini', 'bocconcini'],
    why:
      'eggs 100 g 143 kcal 12.6 g P · bocconcini small ball ~25 g 63 kcal 4.5 g P · arugula 20 g 5 · ' +
      'butter 14 g 100 · olive oil 13.5 g 119 · 2 Roma 124 g 22 kcal 1.1 g P',
  },
  {
    id: 'real-milk-cups-espresso',
    kind: 'real',
    meal: 'breakfast',
    text: '1.5 c milk\n2 shots espresso',
    kcal: 190,
    protein_g: 12,
    kcalTol: 0.3,
    flag: ['milk'],
    why: '1.5 cup ≈ 366 g: skim 125 · 2% 183 · whole 220 kcal; ~12 g P at any fat level; espresso 6',
  },
  {
    id: 'real-starbucks-venti',
    kind: 'real',
    meal: 'breakfast',
    text: 'Starbucks venti latte',
    kcal: 250,
    protein_g: 16,
    why: "Starbucks' published venti caffè latte with 2% milk ≈ 250 kcal, 16 g protein",
  },
  {
    id: 'real-skyr-siggis',
    kind: 'real',
    meal: 'breakfast',
    text: "siggi's creamy skyr plain",
    kcal: 130,
    protein_g: 16,
    kcalTol: 0.4,
    proteinTol: 0.35,
    flag: ['skyr'],
    why: 'no amount: one 150 g tub of plain skyr, 90–170 kcal by fat level, 15–17 g protein',
  },
  {
    id: 'real-smoothie-protein',
    kind: 'real',
    meal: 'breakfast',
    text:
      '2/3 a cup skyr yoghurt 1/3 of a cup Greek vanilla yoghurt one cup of protein one third a cup ' +
      'of orange juice and one cup of frozen strawberries',
    kcal: 390,
    protein_g: 45,
    kcalTol: 0.35,
    proteinTol: 0.35,
    flag: ['protein'],
    why:
      'skyr 2/3 cup 150 g 95 kcal 17 g P · vanilla Greek 1/3 cup 80 g 75 kcal 7 g P · "one cup of ' +
      'protein" is unclear — most likely one scoop of powder, ~120 kcal 24 g P · OJ 1/3 cup 37 kcal · ' +
      'strawberries 1 cup frozen 150 g 52 kcal',
  },
  {
    id: 'real-coffee-cream',
    kind: 'real',
    meal: 'breakfast',
    text: 'coffee with cream',
    kcal: 45,
    protein_g: 0.6,
    kcalTol: 0.6,
    proteinTol: 3,
    flag: ['cream'],
    why: 'no amounts: a mug of brewed coffee ~2 kcal + 1–2 tbsp cream (half-and-half 20/tbsp, 35% 50/tbsp)',
  },
  {
    id: 'real-banana',
    kind: 'real',
    meal: 'breakfast',
    text: 'a banana',
    kcal: 105,
    protein_g: 1.3,
    proteinTol: 0.5,
    why: 'one medium banana, 118 g',
  },

  // ── Near-miss pairs ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pair-pb',
    kind: 'pair',
    meal: 'snack',
    text: '2 tbsp peanut butter',
    kcal: 190,
    protein_g: 7,
    why: '32 g smooth peanut butter',
  },
  {
    id: 'pair-pb-powder',
    kind: 'pair',
    meal: 'snack',
    text: '2 tbsp powdered peanut butter',
    kcal: 60,
    protein_g: 6,
    kcalTol: 0.3,
    why: 'PB2-style powder, 12–13 g per 2 tbsp',
  },
  {
    id: 'pair-rice-cooked',
    kind: 'pair',
    meal: 'dinner',
    text: '1 cup cooked white rice',
    kcal: 205,
    protein_g: 4.3,
    why: 'long-grain white rice, cooked, 158 g',
  },
  {
    id: 'pair-rice-dry',
    kind: 'pair',
    meal: 'dinner',
    text: '1/2 cup uncooked white rice',
    kcal: 340,
    protein_g: 6.6,
    why: 'raw long-grain white rice, 92 g',
  },
  {
    id: 'pair-coconut-canned',
    kind: 'pair',
    meal: 'dinner',
    text: '1/4 cup canned coconut milk',
    kcal: 110,
    protein_g: 1.1,
    kcalTol: 0.25,
    proteinTol: 1,
    why: 'full-fat canned coconut milk, 60 g',
  },
  {
    id: 'pair-coconut-carton',
    kind: 'pair',
    meal: 'breakfast',
    text: '1 cup coconut milk beverage, unsweetened',
    kcal: 45,
    protein_g: 0.5,
    kcalTol: 0.4,
    proteinTol: 2,
    why: 'carton coconut drink (Silk/So Delicious unsweetened), 40–50 kcal',
  },
  {
    id: 'pair-latte-small',
    kind: 'pair',
    meal: 'breakfast',
    text: 'a small latte from the cafe',
    kcal: 150,
    protein_g: 10,
    kcalTol: 0.35,
    proteinTol: 0.35,
    flag: ['latte'],
    why: 'a 12 oz latte with 2% milk ≈ 150 kcal, 10 g protein — size and milk both assumed',
  },
  {
    id: 'pair-chicken',
    kind: 'pair',
    meal: 'dinner',
    text: '6 oz grilled chicken breast',
    kcal: 280,
    protein_g: 53,
    why: 'cooked skinless breast, 170 g',
  },
  {
    id: 'pair-almonds',
    kind: 'pair',
    meal: 'snack',
    text: 'a handful of almonds',
    kcal: 165,
    protein_g: 6,
    kcalTol: 0.4,
    proteinTol: 0.4,
    flag: ['handful'],
    why: '"a handful" ≈ 1 oz, 28 g, ~23 almonds',
  },
  {
    id: 'pair-sweet-potato',
    kind: 'pair',
    meal: 'dinner',
    text: '1 medium baked sweet potato',
    kcal: 103,
    protein_g: 2.3,
    proteinTol: 0.35,
    why: 'baked in skin, 114 g',
  },
];
