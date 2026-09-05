/**
 * Barrel for the session Prescribe / Log / weigh-in surface (API-02 split).
 * Prefer importing from session-generate / session-log / weigh-in / session-normalize directly.
 */
export { getOccurrenceDetail } from './session-generate.ts';
export { logOccurrence } from './session-log.ts';
export { recordWeighIn } from './weigh-in.ts';
export { normalizeSession } from './session-normalize.ts';
