/**
 * CASES for the food-photo eval — the ground truth, and the honest limits of it.
 *
 * A case is a photo plus what was ACTUALLY on the plate. The scoring is only ever as good as this
 * file, so two rules hold it together:
 *
 *   1. NOTHING HERE IS INVENTED. A field nobody can verify is `null`, and a null field is SKIPPED
 *      in scoring rather than guessed at. A harness that scores against made-up truth reports
 *      confident numbers about nothing, which is worse than reporting no numbers at all.
 *   2. Ground truth is written by the person who ate the meal. The two seed cases are the owner's
 *      own logs from 2026-08-20 — the two photos that came back empty and were stored as settled
 *      0-kcal meals. Their captions establish some of the truth; the rest is marked `null` and
 *      waits for him. `truth: 'caption-only'` says so out loud on every line it affects.
 *
 * WHY REAL LOGS RATHER THAN A STOCK PHOTO SET. The failure being measured happened on these exact
 * images, through this exact path — uploaded from a phone, stored, re-signed, fetched by a model.
 * A curated benchmark of clean studio plates would have scored 100% the same morning the owner's
 * breakfast logged as zero calories. Photos are referenced by `photoRef` and signed at run time,
 * never copied into the repo: they are somebody's actual breakfast.
 */

/** Everything a scorer may know about one photo. `null` means "not established" — never "absent". */
export interface FoodVisionCase {
  key: string;
  /** Storage ref, signed at run time — same path the app uses. Or `file` for a local image. */
  photoRef?: string;
  file?: string;
  /** What the user typed alongside the photo, if anything. The model gets this too. */
  caption: string | null;
  mealHint: string | null;
  /** How far the truth below can be trusted. Printed in the report next to every score. */
  truth: 'caption-only' | 'owner-confirmed' | 'label-verified';
  /** Foods that ARE present. `aliases` make matching deterministic — no LLM judge, no drift. */
  components: Array<{ name: string; aliases: string[]; qty?: string | null }>;
  /**
   * Foods a model must NOT claim. Not "everything absent" — that is unbounded — but the specific
   * confusions worth catching: the plausible neighbour, the upgrade, the invented side.
   */
  mustNotClaim: string[];
  /** Known nutrition, when it can be established. null = skipped, never scored as a miss. */
  kcal: number | null;
  proteinG: number | null;
  /** Free-text note for whoever reads the report. */
  note: string;
}

export const FOOD_VISION_CASES: FoodVisionCase[] = [
  {
    key: 'parfait',
    photoRef: '91e914fa-f014-4e26-accf-c50ca316660e/2026-08-20/a16b8963-7fa2-4ce2-89ed-ee45cd77d071.jpg',
    caption: 'I also had this small parfait of yogurt',
    mealHint: 'breakfast',
    truth: 'caption-only',
    components: [
      { name: 'yogurt', aliases: ['yoghurt', 'greek yogurt', 'parfait', 'curd'], qty: null },
      // The caption says parfait, which implies layering; what is layered IN is not established.
      // Listed with no aliases beyond the obvious so a model naming fruit is credited, not punished.
      { name: 'berries', aliases: ['berry', 'blueberr', 'strawberr', 'raspberr', 'fruit'], qty: null },
    ],
    mustNotClaim: ['ice cream', 'milkshake', 'soup', 'salad', 'oatmeal'],
    kcal: null,
    proteinG: null,
    note: 'Logged 2026-08-20, stored with items:[] and macros:{} as a SETTLED 0-kcal meal. The whole reason this harness exists.',
  },
  {
    key: 'latte',
    photoRef: '91e914fa-f014-4e26-accf-c50ca316660e/2026-08-20/3de365b9-8f4f-479b-a4e1-dc3d41876113.jpg',
    caption: 'This is another smaller latte from Starbucks',
    mealHint: 'breakfast',
    truth: 'caption-only',
    components: [
      { name: 'latte', aliases: ['coffee', 'espresso', 'cappuccino', 'cafe au lait', 'flat white'], qty: null },
    ],
    // A latte is milk and espresso. Claiming a pastry beside it, or calling it a dessert drink,
    // is the failure that matters: an invented item silently adds calories to somebody's day.
    mustNotClaim: ['pastry', 'croissant', 'muffin', 'sandwich', 'whipped cream', 'frappuccino'],
    kcal: null,
    proteinG: null,
    note: 'Same upload batch, same empty result. Size ("smaller") is in the caption but the cup is the real evidence — a good portion read should reason from the cup.',
  },
];

/**
 * A description is only useful if it says HOW MUCH. These are the words that mean a model anchored
 * its portion estimate to something in the frame rather than guessing — the behaviour the two-stage
 * split is meant to buy, and the one thing a JSON-only answer never shows you.
 */
export const PORTION_ANCHORS = [
  'cup',
  'mug',
  'glass',
  'bowl',
  'plate',
  'fork',
  'spoon',
  'hand',
  'palm',
  'thumb',
  'oz',
  'ounce',
  'ml',
  'gram',
  'g)',
  'tablespoon',
  'tbsp',
  'teaspoon',
  'tsp',
  'inch',
  'cm',
  'diameter',
  'compared',
  'roughly the size',
  'about the size',
  'tall',
  'grande',
  'venti',
  'small',
  'medium',
  'large',
];

/** Hedges. A model that says what it CANNOT tell is more useful than one that guesses silently. */
export const UNCERTAINTY_MARKERS = [
  'appears',
  'likely',
  'possibly',
  'hard to tell',
  "can't tell",
  'cannot tell',
  'unclear',
  'obscured',
  'not visible',
  'uncertain',
  'estimate',
  'roughly',
  'approximately',
  'may be',
];
