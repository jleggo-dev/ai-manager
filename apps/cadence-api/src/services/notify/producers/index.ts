import type { RegisteredProducer } from '../tick.ts';
import { freezeSaveProducer } from './freeze-save.ts';
import { detourEndingProducer } from './detour-ending.ts';
import { reEntryProducer } from './re-entry.ts';
import { weatherMoveProducer } from './weather-move.ts';

/**
 * The four PUSH producers, in the order the tick runs them.
 *
 * Order matters slightly and only in one direction: the daily cap is first-come, so whatever runs
 * earlier wins a contested day. `freeze_save` and `detour_ending` go first because they are the
 * two the user is most likely to be waiting on — one is news about something that already happened
 * to them, the other needs an answer by tomorrow. `weather_move` is last: it is a convenience, and
 * a convenience is the right thing to lose when only one message fits.
 *
 * The five LOCAL nudges are deliberately absent. They are scheduled on the device from the
 * committed plan (see @cadence/shared's `buildLocalNudges`), because the device already knows
 * everything they need, fires them exactly on time, and does it offline and for free.
 *
 * There is no placeholder here and never should be: an "example" producer nobody wired is how a
 * test notification reaches a real phone.
 */
export const PUSH_PRODUCERS: RegisteredProducer[] = [
  freezeSaveProducer,
  detourEndingProducer,
  reEntryProducer,
  weatherMoveProducer,
];

export { freezeSaveProducer, detourEndingProducer, reEntryProducer, weatherMoveProducer };
