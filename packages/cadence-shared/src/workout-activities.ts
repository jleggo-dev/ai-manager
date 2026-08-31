/**
 * The activity vocabulary — one catalog, three consumers.
 *
 * Every entry's `name` is an `HKWorkoutActivityType` case with a lowercased first letter, so the
 * mapping to HealthKit is mechanical rather than a judgement. The Swift side is GENERATED from
 * this file (`npm run gen:workout-activities`), because the same table previously existed by hand
 * in three places — the TypeScript union, the iOS plugin's switch and the watch's — and three
 * hand-written copies of one table is a drift waiting to happen.
 *
 * **Why this got wider (owner, 2026-08-30):** the vocabulary was eleven activities plus `other`,
 * so a Pilates, dance, boxing, elliptical or rowing-machine session composed to `.other` and
 * handed off to Apple as an unnamed workout. That was a live defect in shipped code, not only a
 * gap for what comes next.
 *
 * Two cases in HealthKit are deliberately absent: `swimBikeRun` and `transition` are multisport
 * machinery rather than a session anybody is prescribed, and WorkoutKit models multisport as its
 * own composition type (`SwimBikeRunWorkout`) which we do not build. `other` stays as the honest
 * fallback for everything unrecognised.
 */

/**
 * Where the work happens unless the text says otherwise.
 *
 * WorkoutKit treats this as a real dimension: an outdoor run and a treadmill run are different
 * workouts, different goals are legal for each, and only one uses GPS.
 *
 * **Only assert what the activity definitionally implies.** Strength, HIIT, core and yoga are
 * usually indoors, but "usually" is not knowledge — they stay `unknown`, which is WorkoutKit's own
 * answer for "do not care" and lets the text decide (see `INDOOR_WORDS`). Guessing here would make
 * a garage session illegal for a goal shape it should support. Swimming and rowing are `unknown`
 * for the same reason: pool or open water, erg or boat, is a fact about the session and not about
 * the sport.
 */
export type ActivityLocation = 'outdoor' | 'indoor' | 'unknown';

/**
 * What KIND of session it is, which decides which face runs it.
 *
 * `tracked` — a continuous effort whose value is measurement: distance, pace, heart rate,
 * a route. Running, cycling, swimming, rowing, skiing, a game of basketball. Our own live
 * session runs these (`OutdoorSessionView`), with Apple's Workout app available as an
 * alternative rather than the destination.
 *
 * `guided` — a structured session whose value is OUR choreography: the interval ring and its
 * chimes, the set-log's crown, a sit with no heart rate on screen. Nothing measures its way to
 * being useful; the shape is the point.
 *
 * Named for what the session IS, not for which app opens it — the app is a consequence.
 */
export type ActivitySessionStyle = 'guided' | 'tracked';

export interface ActivitySpec {
  /** Matches an `HKWorkoutActivityType` case, first letter lowercased. */
  name: string;
  /** Words that mean this activity. LONGEST match wins, so "rowing machine" beats "row". */
  words: readonly string[];
  location: ActivityLocation;
  style: ActivitySessionStyle;
  /**
   * OS versions that have this case, when it is NEWER than our deployment floors (iOS 15 /
   * watchOS 10). The generator wraps those in `if #available` and falls back to `.other`, because
   * an older OS genuinely does not have the type — reporting `.other` there is honest, and the
   * alternative is a build that does not compile.
   *
   * Only cases above the floors need it; today that is `underwaterDiving` alone. The compiler is
   * what enforces this — a missing entry fails the build rather than shipping.
   */
  since?: { ios: number; watchos: number };
}

/**
 * The catalog.
 *
 * `words` are matched as substrings against the session title and its item names together, so a
 * short word here is a liability — "row" would steal "throwing" without the word-boundary check
 * in `inferActivity`. Entries carry only the words worth matching; an activity whose own name is
 * the only sensible cue simply lists it.
 */
export const WORKOUT_ACTIVITIES = [
  // ── Over ground, in water, on snow: Apple's tracking wins ──────────────────────────────────
  {
    name: 'running',
    words: ['run', 'jog', 'sprint', 'tempo', 'shakeout', 'fartlek'],
    location: 'outdoor',
    style: 'tracked',
  },
  { name: 'walking', words: ['walk', 'stroll'], location: 'outdoor', style: 'tracked' },
  { name: 'hiking', words: ['hike', 'ruck', 'trek'], location: 'outdoor', style: 'tracked' },
  { name: 'cycling', words: ['bike', 'cycle', 'cycling', 'spin', 'ride'], location: 'outdoor', style: 'tracked' },
  { name: 'handCycling', words: ['hand cycle', 'handcycling'], location: 'outdoor', style: 'tracked' },
  {
    name: 'swimming',
    words: ['swim', 'freestyle', 'breaststroke', 'backstroke', 'butterfly'],
    location: 'unknown',
    style: 'tracked',
  },
  {
    name: 'underwaterDiving',
    words: ['dive', 'diving', 'scuba', 'freedive'],
    location: 'unknown',
    style: 'tracked',
    since: { ios: 17, watchos: 10 },
  },
  { name: 'rowing', words: ['row', 'erg', 'rowing machine', 'sculling'], location: 'unknown', style: 'tracked' },
  { name: 'paddleSports', words: ['paddle', 'kayak', 'canoe', 'sup'], location: 'outdoor', style: 'tracked' },
  { name: 'sailing', words: ['sail', 'sailing'], location: 'outdoor', style: 'tracked' },
  { name: 'surfingSports', words: ['surf', 'surfing'], location: 'outdoor', style: 'tracked' },
  {
    name: 'crossCountrySkiing',
    words: ['cross country ski', 'nordic ski', 'xc ski'],
    location: 'outdoor',
    style: 'tracked',
  },
  { name: 'downhillSkiing', words: ['ski', 'skiing', 'downhill'], location: 'outdoor', style: 'tracked' },
  { name: 'snowboarding', words: ['snowboard'], location: 'outdoor', style: 'tracked' },
  { name: 'snowSports', words: ['snow sport', 'sledding', 'snowshoe'], location: 'outdoor', style: 'tracked' },
  { name: 'skatingSports', words: ['skate', 'skating', 'rollerblade'], location: 'outdoor', style: 'tracked' },
  { name: 'climbing', words: ['climb', 'bouldering', 'belay'], location: 'unknown', style: 'tracked' },
  { name: 'equestrianSports', words: ['horse', 'equestrian', 'riding'], location: 'outdoor', style: 'tracked' },
  { name: 'wheelchairWalkPace', words: ['wheelchair walk'], location: 'outdoor', style: 'tracked' },
  { name: 'wheelchairRunPace', words: ['wheelchair run', 'wheelchair push'], location: 'outdoor', style: 'tracked' },
  { name: 'fishing', words: ['fishing'], location: 'outdoor', style: 'tracked' },
  { name: 'hunting', words: ['hunting'], location: 'outdoor', style: 'tracked' },
  { name: 'golf', words: ['golf'], location: 'outdoor', style: 'tracked' },

  // ── Gym, studio, mat: our frame is the point ───────────────────────────────────────────────
  {
    name: 'traditionalStrengthTraining',
    words: [
      'strength',
      'lift',
      'lifting',
      'deadlift',
      'squat',
      'bench',
      'press',
      'curl',
      'barbell',
      'dumbbell',
      'weights',
    ],
    location: 'unknown',
    style: 'guided',
  },
  {
    name: 'functionalStrengthTraining',
    words: ['circuit', 'kettlebell', 'functional', 'amrap', 'wod', 'metcon'],
    location: 'unknown',
    style: 'guided',
  },
  {
    name: 'highIntensityIntervalTraining',
    words: ['hiit', 'tabata', 'emom', 'intervals', 'interval'],
    location: 'unknown',
    style: 'guided',
  },
  {
    name: 'crossTraining',
    words: ['cross training', 'crosstraining', 'bootcamp'],
    location: 'unknown',
    style: 'guided',
  },
  { name: 'coreTraining', words: ['core', 'abs', 'plank'], location: 'unknown', style: 'guided' },
  { name: 'elliptical', words: ['elliptical'], location: 'indoor', style: 'guided' },
  {
    name: 'stairClimbing',
    words: ['stair climb', 'stairmaster', 'stair machine'],
    location: 'indoor',
    style: 'guided',
  },
  { name: 'stairs', words: ['stairs'], location: 'unknown', style: 'guided' },
  { name: 'stepTraining', words: ['step training', 'step class'], location: 'indoor', style: 'guided' },
  { name: 'jumpRope', words: ['jump rope', 'skipping', 'skip rope'], location: 'unknown', style: 'guided' },
  { name: 'pilates', words: ['pilates', 'reformer'], location: 'unknown', style: 'guided' },
  { name: 'barre', words: ['barre'], location: 'indoor', style: 'guided' },
  { name: 'yoga', words: ['yoga', 'vinyasa', 'ashtanga', 'hatha'], location: 'unknown', style: 'guided' },
  {
    name: 'flexibility',
    words: ['stretch', 'stretching', 'mobility', 'flexibility'],
    location: 'unknown',
    style: 'guided',
  },
  {
    name: 'preparationAndRecovery',
    words: ['warm-up', 'warmup', 'recovery', 'foam roll', 'cooldown'],
    location: 'unknown',
    style: 'guided',
  },
  { name: 'cooldown', words: ['cool-down', 'cool down'], location: 'unknown', style: 'guided' },
  { name: 'mindAndBody', words: ['mind and body', 'meditation', 'breathwork'], location: 'unknown', style: 'guided' },
  { name: 'taiChi', words: ['tai chi', 'qigong'], location: 'unknown', style: 'guided' },
  { name: 'gymnastics', words: ['gymnastics', 'tumbling'], location: 'indoor', style: 'guided' },
  { name: 'waterFitness', words: ['water fitness', 'aqua aerobics', 'aquafit'], location: 'indoor', style: 'guided' },
  { name: 'mixedCardio', words: ['mixed cardio', 'cardio'], location: 'unknown', style: 'guided' },
  { name: 'fitnessGaming', words: ['fitness gaming', 'ring fit'], location: 'indoor', style: 'guided' },
  { name: 'play', words: ['play'], location: 'unknown', style: 'guided' },

  // ── Combat and dance ──────────────────────────────────────────────────────────────────────
  { name: 'boxing', words: ['boxing', 'heavy bag'], location: 'unknown', style: 'guided' },
  { name: 'kickboxing', words: ['kickboxing', 'muay thai'], location: 'unknown', style: 'guided' },
  {
    name: 'martialArts',
    words: ['martial arts', 'karate', 'judo', 'jiu jitsu', 'bjj', 'taekwondo'],
    location: 'unknown',
    style: 'guided',
  },
  { name: 'wrestling', words: ['wrestling'], location: 'unknown', style: 'guided' },
  { name: 'fencing', words: ['fencing'], location: 'unknown', style: 'guided' },
  { name: 'cardioDance', words: ['cardio dance', 'zumba'], location: 'unknown', style: 'guided' },
  {
    name: 'socialDance',
    words: ['social dance', 'salsa', 'ballroom', 'swing dance'],
    location: 'unknown',
    style: 'guided',
  },
  { name: 'danceInspiredTraining', words: ['dance inspired', 'ballet'], location: 'unknown', style: 'guided' },
  { name: 'dance', words: ['dance', 'dancing'], location: 'unknown', style: 'guided' },

  // ── Field, court and the rest: played, not prescribed by the minute ────────────────────────
  { name: 'soccer', words: ['soccer', 'football practice'], location: 'outdoor', style: 'tracked' },
  { name: 'americanFootball', words: ['american football', 'gridiron'], location: 'outdoor', style: 'tracked' },
  { name: 'australianFootball', words: ['australian football', 'afl', 'footy'], location: 'outdoor', style: 'tracked' },
  { name: 'rugby', words: ['rugby'], location: 'outdoor', style: 'tracked' },
  { name: 'basketball', words: ['basketball', 'hoops'], location: 'unknown', style: 'tracked' },
  { name: 'baseball', words: ['baseball'], location: 'outdoor', style: 'tracked' },
  { name: 'softball', words: ['softball'], location: 'outdoor', style: 'tracked' },
  { name: 'cricket', words: ['cricket'], location: 'outdoor', style: 'tracked' },
  { name: 'hockey', words: ['hockey'], location: 'unknown', style: 'tracked' },
  { name: 'lacrosse', words: ['lacrosse'], location: 'outdoor', style: 'tracked' },
  { name: 'volleyball', words: ['volleyball'], location: 'unknown', style: 'tracked' },
  { name: 'handball', words: ['handball'], location: 'indoor', style: 'tracked' },
  { name: 'waterPolo', words: ['water polo'], location: 'indoor', style: 'tracked' },
  { name: 'waterSports', words: ['water sports', 'wakeboard'], location: 'outdoor', style: 'tracked' },
  { name: 'tennis', words: ['tennis'], location: 'unknown', style: 'tracked' },
  { name: 'tableTennis', words: ['table tennis', 'ping pong'], location: 'indoor', style: 'tracked' },
  { name: 'badminton', words: ['badminton'], location: 'indoor', style: 'tracked' },
  { name: 'squash', words: ['squash'], location: 'indoor', style: 'tracked' },
  { name: 'racquetball', words: ['racquetball'], location: 'indoor', style: 'tracked' },
  { name: 'pickleball', words: ['pickleball'], location: 'unknown', style: 'tracked' },
  { name: 'discSports', words: ['disc golf', 'ultimate frisbee', 'frisbee'], location: 'outdoor', style: 'tracked' },
  {
    name: 'trackAndField',
    words: ['track and field', 'shot put', 'javelin', 'high jump', 'long jump'],
    location: 'outdoor',
    style: 'tracked',
  },
  { name: 'bowling', words: ['bowling'], location: 'indoor', style: 'tracked' },
  { name: 'archery', words: ['archery'], location: 'outdoor', style: 'tracked' },
  { name: 'curling', words: ['curling'], location: 'indoor', style: 'tracked' },
  { name: 'mixedMetabolicCardioTraining', words: ['metabolic conditioning'], location: 'unknown', style: 'guided' },

  // The honest fallback. Never inferred from a word — only reached when nothing else matches.
  { name: 'other', words: [], location: 'unknown', style: 'guided' },
  // `satisfies` rather than a type annotation: an annotation would widen every `name` to `string`
  // and the derived union below would become `string`, silently losing the type safety this file
  // exists to provide.
] as const satisfies readonly ActivitySpec[];

/** The literal union of every catalogued activity — what `WorkoutActivity` is. */
export type WorkoutActivityName = (typeof WORKOUT_ACTIVITIES)[number]['name'];

/** Every activity name, for the generated Swift and for tests. */
export const WORKOUT_ACTIVITY_NAMES: readonly WorkoutActivityName[] = WORKOUT_ACTIVITIES.map((a) => a.name);

const BY_NAME: ReadonlyMap<string, ActivitySpec> = new Map(WORKOUT_ACTIVITIES.map((a) => [a.name, a as ActivitySpec]));

export function activitySpec(name: string): ActivitySpec | undefined {
  return BY_NAME.get(name);
}

/**
 * Is this a tracked effort (measured) rather than a guided one (choreographed)?
 *
 * An unknown name answers `false` — a guided session degrades to a timer and a list of names,
 * which is honest, whereas starting a distance tracker for something we could not classify would
 * record a route and a pace for work that may have neither.
 */
export function activityIsTracked(name: string): boolean {
  return BY_NAME.get(name)?.style === 'tracked';
}
