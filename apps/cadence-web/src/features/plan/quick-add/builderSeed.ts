import type { OccurrenceSession } from '@cadence/shared';
import type { UserRoutine, UserRoutineProvenance } from '../../../lib/api.ts';

/**
 * What "Build my own" hands the Activity Builder (`features/builder/ActivityBuilder.tsx`) to open
 * pre-filled — mirrors that component's own `initial` prop field-for-field. Defined here rather
 * than imported from there: `ActivityBuilder.tsx` belongs to another parcel building in parallel
 * and exports no named type for it, so this is a STRUCTURAL match, not a re-export — passing one
 * straight through as `initial={seed}` type-checks with no translation layer, and if that prop
 * shape ever changes shape this type (and every call site here) needs updating to match.
 *
 * `undefined` (no seed at all) is the "Blank" path — the builder opens on its own type-first
 * entry screen exactly as if reached with nothing to say, same as a bare ＋ → Build your own.
 */
export interface BuilderSeed {
  name?: string;
  session?: OccurrenceSession;
  provenance?: UserRoutineProvenance;
  area?: UserRoutine['area'];
}
