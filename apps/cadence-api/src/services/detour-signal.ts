/**
 * The deterministic gate on conversational detour capture — the tripwires pattern applied to
 * chat (REQ4 entry path #2, conversational door): pure app code decides whether the Broker's
 * `capture-detour` job runs at all. No signal, no LLM call — ambient capture already costs one
 * job per turn, and a second one must earn its keep.
 *
 * The gate reads the WHOLE window (user and coach turns alike), which is what makes a cheap
 * keyword screen safe here: by the time a detour is actually being arranged, the coach's own half
 * of the exchange says "detour", "while you're away", "hotel gym" — so a user paraphrase the list
 * misses still gates in on the coach's reply a turn later. The cost of a false positive is one
 * wasted Broker call; the cost of a false negative is a turn of delay, not a lost detour.
 */

/** Lowercase substrings that suggest a disruption is being discussed or arranged. */
const SIGNALS = [
  // the arrangement itself
  'detour',
  'temporary plan',
  'while you’re away',
  "while you're away",
  // travel
  'travel',
  'trip',
  'flight',
  'flying',
  'airport',
  'hotel',
  'vacation',
  'holiday',
  'out of town',
  'away next',
  'away this',
  'away for',
  // illness / injury / recovery
  'sick',
  'ill ',
  'unwell',
  'flu',
  'covid',
  'injur',
  'sprain',
  'surgery',
  'recovering',
  'recovery week',
  // life
  'rough week',
  'rough stretch',
  'chaos',
  'moving house',
  'funeral',
  'wedding',
];

export function hasDetourSignal(window: string): boolean {
  const text = window.toLowerCase();
  return SIGNALS.some((s) => text.includes(s));
}

/**
 * The UPDATE-mode gate, used only while an episode is ACTIVE: does the window sound like someone
 * reporting what they have with them? Split from `hasDetourSignal` on purpose — words like "gym"
 * saturate ordinary training talk, so gating on them all the time would run the Broker job on
 * half of all conversations. While on a detour, they are exactly the signal that the missing
 * equipment answer has finally arrived ("ok I'm here, the gym has dumbbells and a rower").
 */
const EQUIPMENT_SIGNALS = [
  'gym',
  'equipment',
  'dumbbell',
  'barbell',
  'kettlebell',
  'treadmill',
  'rower',
  'rowing machine',
  'bike',
  'weights',
  'machines',
  'band',
  'bench',
  'pool',
  'nothing here',
  'no gym',
  'just my shoes',
];

export function hasEquipmentSignal(window: string): boolean {
  const text = window.toLowerCase();
  return EQUIPMENT_SIGNALS.some((s) => text.includes(s));
}
