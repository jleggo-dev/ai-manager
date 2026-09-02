/**
 * Units, per axis — because nobody is wholly metric or wholly imperial.
 *
 * Owner, 2026-08-22, describing his own kitchen and gym:
 *
 *   human weight   lbs          food weight    metric (g)
 *   human height   feet/inches  food volume    cups, tablespoons
 *   other distance metric (km)
 *
 * That is Canada, and it is also Britain, and it is a good half of everywhere else. A single
 * metric/imperial switch cannot express ANY of it — set it to imperial and you get grams-free
 * recipes nobody cooks from; set it to metric and you are told your bodyweight in kilos you do not
 * think in. This is why BRAND/PLAN already ruled "two Settings controls… never one metric switch";
 * the owner has now extended that to five.
 *
 * So: one preference per axis, each independently set, over a `system` fallback for anything the
 * user has not had an opinion about. The fallback exists so a new user is never asked five
 * questions to log a meal, not so it can override a choice they made.
 *
 * STORAGE IS ALWAYS CANONICAL. kg, cm, g, ml, km — always, everywhere, whatever these say. These
 * describe DISPLAY, and every conversion happens at the boundary where a number is shown or handed
 * to the coach (see weight-units.ts). Nothing downstream should ever branch on a unit.
 */

export type UnitAxis = 'body_weight' | 'height' | 'food_mass' | 'food_volume' | 'distance' | 'clock';

export type BodyWeightUnit = 'kg' | 'lb';
export type HeightUnit = 'cm' | 'ft_in';
export type FoodMassUnit = 'g' | 'oz';
export type FoodVolumeUnit = 'ml' | 'cup';
export type DistanceUnit = 'km' | 'mi';
/**
 * How a clock time is written: "21:00" or "9:00 pm". An axis like the others because it is the
 * same kind of choice — the owner's plan shows "06:00" while his header said "quiet at 9:00", and
 * a person should be able to pick one and see it everywhere (owner, 2026-09-01). Storage is always
 * "HH:MM" 24-hour; this only says how to SHOW it.
 */
export type ClockUnit = '24h' | '12h';

export interface UnitPrefs {
  /** What to assume for any axis the user has not set. Not an override — see resolveUnit. */
  system?: 'metric' | 'imperial';
  body_weight?: BodyWeightUnit;
  height?: HeightUnit;
  food_mass?: FoodMassUnit;
  food_volume?: FoodVolumeUnit;
  distance?: DistanceUnit;
  clock?: ClockUnit;
}

/** The two ends of each axis, metric first. (For the clock, "metric" is the 24-hour side — the
 *  one that goes with kilometres and the one every stored time is already written in.) */
const AXIS_UNITS: Record<UnitAxis, readonly [string, string]> = {
  body_weight: ['kg', 'lb'],
  height: ['cm', 'ft_in'],
  food_mass: ['g', 'oz'],
  food_volume: ['ml', 'cup'],
  distance: ['km', 'mi'],
  clock: ['24h', '12h'],
};

/** Labels for the settings UI. Plain words, not unit codes — "feet & inches", not "ft_in". */
export const UNIT_LABEL: Record<string, string> = {
  kg: 'kilograms',
  lb: 'pounds',
  cm: 'centimetres',
  ft_in: 'feet & inches',
  g: 'grams',
  oz: 'ounces',
  ml: 'millilitres',
  cup: 'cups & spoons',
  km: 'kilometres',
  mi: 'miles',
  '24h': '24-hour',
  '12h': '12-hour',
};

export const AXIS_LABEL: Record<UnitAxis, string> = {
  body_weight: 'Your weight',
  height: 'Your height',
  food_mass: 'Food weight',
  food_volume: 'Food volume',
  distance: 'Distance',
  clock: 'Clock',
};

export const UNIT_AXES = Object.keys(AXIS_UNITS) as UnitAxis[];

/** The options for one axis, in the order a control should offer them. */
export function axisOptions(axis: UnitAxis): readonly [string, string] {
  return AXIS_UNITS[axis];
}

/**
 * What unit to SHOW for one axis.
 *
 * Order is deliberate and the first rule is the important one: an explicit choice always wins. The
 * `system` fallback only speaks for axes the user never touched, so setting "mostly metric" can
 * never silently undo the pounds they picked.
 *
 * `legacyWeightUnit` keeps `baseline.weight_unit` working. Every existing user has it, the weigh-in
 * flow and Review both write it, and it predates this module — so it is honoured for body weight
 * ahead of the system fallback, and behind an explicit `unit_prefs.body_weight`.
 */
export function resolveUnit(prefs: UnitPrefs | null | undefined, axis: UnitAxis, legacyWeightUnit?: unknown): string {
  const [metric, imperial] = AXIS_UNITS[axis];

  const explicit = prefs?.[axis];
  if (typeof explicit === 'string' && (explicit === metric || explicit === imperial)) return explicit;

  if (axis === 'body_weight') {
    const legacy = String(legacyWeightUnit ?? '')
      .trim()
      .toLowerCase();
    if (legacy === 'lb' || legacy === 'lbs') return 'lb';
    if (legacy === 'kg') return 'kg';
  }

  return prefs?.system === 'imperial' ? imperial : metric;
}

/**
 * The mixed default, and why it is not "metric".
 *
 * A brand-new user has no preferences, and a fallback of pure metric would tell a North American
 * their bodyweight in kilos and their height in centimetres on day one — which is the exact
 * complaint this module exists to answer, just applied to everyone by default instead of one
 * person. These are the settings the owner described for himself; they are also the ones that are
 * least wrong across the English-speaking world, and every one of them is a control away.
 */
export const MIXED_DEFAULT: UnitPrefs = {
  system: 'metric',
  body_weight: 'lb',
  height: 'ft_in',
  food_mass: 'g',
  food_volume: 'cup',
  distance: 'km',
};
