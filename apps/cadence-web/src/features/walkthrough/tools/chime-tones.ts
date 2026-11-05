/**
 * The chime's voices, as note lists (Hz). Their own module so the clock store can read them while
 * a test mocks `chime.ts` down to its players — a mock that forgot a constant used to take the
 * whole store with it. The plain two-note chime is `playChime()`, which has no constant here.
 *
 * Intervals need the ear to carry the whole message — phone on the floor, three metres away — so
 * **the chime says which way the phase went**: rising for work, falling for recover, a three-note
 * flourish for the end of the run. Same envelope and timing as the plain chime, so it is
 * recognisably the app rather than a new sound.
 */
export const CHIME_WORK = [660, 880];
export const CHIME_RECOVER = [660, 520];
export const CHIME_DONE = [660, 880, 990];
/** Halfway through a two-sided hold: a down-and-up "turn over", unlike anything that means stop. */
export const CHIME_SWITCH = [880, 660, 880];
