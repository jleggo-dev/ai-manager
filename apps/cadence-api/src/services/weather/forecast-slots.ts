/**
 * Forecast SLOTS — the shape, the mapping, and the three questions asked of them. Pure: no HTTP,
 * no config, no cache. `forecast.ts` fetches; this decides what a slot means.
 *
 * Split from the fetcher on purpose. These predicates are the ones that determine whether a
 * notification goes out at all, so they need to be testable without a network, a key, or a
 * database URL — and a producer that imports them must not drag the config loader in behind them.
 */
import type { OwmForecastPayload } from './weather-map.ts';

export interface ForecastSlot {
  /** The instant this slot describes. OWM's `dt` is seconds; the series steps every 3 hours. */
  at: Date;
  tempC: number;
  /** OWM's own description, lowercased: "light rain", "clear sky". */
  conditions: string;
  /** 0..1 probability of precipitation for the slot. */
  precipChance: number;
}

/** Map a raw OWM forecast payload to slots, dropping anything missing a time or a temperature —
 *  a half-populated slot is not a fact we can build a sentence on. */
export function mapForecastSlots(payload: OwmForecastPayload | null | undefined): ForecastSlot[] {
  const list = Array.isArray(payload?.list) ? payload.list : [];
  const out: ForecastSlot[] = [];
  for (const item of list) {
    const dt = typeof item.dt === 'number' ? item.dt : null;
    const tempC = typeof item.main?.temp === 'number' ? item.main.temp : null;
    if (dt == null || tempC == null) continue;
    const first = item.weather?.[0];
    out.push({
      at: new Date(dt * 1000),
      tempC,
      conditions: (first?.description ?? first?.main ?? '').toLowerCase().trim(),
      precipChance: typeof item.pop === 'number' ? item.pop : 0,
    });
  }
  return out;
}

/** Words that mean an outdoor session is meaningfully worse. The slot series carries no wind, so
 *  this is precipitation and storms only — claiming a windy hour from data we do not have would be
 *  exactly the kind of confident wrongness this nudge must never produce. */
const WET = /\b(rain|drizzle|shower|snow|sleet|hail|storm|thunder|blizzard)\b/;

/** True when this slot argues with an outdoor session: likely precipitation, or already wet. */
export function slotConflicts(slot: ForecastSlot): boolean {
  return slot.precipChance >= 0.5 || WET.test(slot.conditions);
}

/**
 * True when this slot is a genuinely better place to put the session.
 *
 * The bar is "clear", not "less bad", and the gap between the two thresholds (0.5 and 0.2) is
 * deliberate dead space: offering to move a session from a 55% chance to a 45% one is a
 * notification that spends the user's attention on noise.
 */
export function slotIsClear(slot: ForecastSlot): boolean {
  return slot.precipChance <= 0.2 && !WET.test(slot.conditions);
}

/**
 * The slot covering an instant. Returns null when the nearest slot is more than three hours away,
 * because past that we are outside the series and the nearest entry says nothing useful about the
 * session's actual hour.
 */
export function slotAt(slots: ForecastSlot[], at: Date): ForecastSlot | null {
  let best: ForecastSlot | null = null;
  let bestGap = Infinity;
  for (const s of slots) {
    const gap = Math.abs(s.at.getTime() - at.getTime());
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best && bestGap <= 3 * 3600_000 ? best : null;
}

/** A short, plain word for a slot's weather: the title says "Rain at 6", never "light rain at 6". */
export function conditionWord(conditions: string): string {
  if (/thunder|storm/.test(conditions)) return 'Storms';
  if (/snow|blizzard/.test(conditions)) return 'Snow';
  if (/sleet|hail/.test(conditions)) return 'Hail';
  if (/rain|drizzle|shower/.test(conditions)) return 'Rain';
  return 'Wet weather';
}
