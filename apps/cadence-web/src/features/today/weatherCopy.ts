/**
 * How the weather is written on Plan — the glyph, the chip's line, and the sentence in the sheet.
 *
 * Shared by the header and the weather sheet so the two can never disagree about what the sky is
 * doing: the chip and the sheet's headline are the same reading, one of them just has room for
 * the adjective.
 */

/** "mostly cloudy" → "Mostly cloudy". Provider strings arrive lowercase. */
export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * The condition glyph, by daylight as well as by weather.
 *
 * The night branch is a bug fix: the old version keyed off the condition word alone, so a clear
 * sky at nine at night rendered ☀️ over a navy trail. Only the two clear-sky answers move — rain,
 * snow, thunder and fog read the same after dark, and a moon on a thunderstorm would be worse.
 */
export function wxEmoji(conditions: string, night = false): string {
  const c = conditions.toLowerCase();
  if (/snow|sleet/.test(c)) return '❄️';
  if (/thunder|storm/.test(c)) return '⛈️';
  if (/rain|drizzle|shower/.test(c)) return '🌧️';
  if (/cloud|overcast/.test(c)) return '☁️';
  if (/fog|mist|haze|smoke/.test(c)) return '🌫️';
  if (/clear|sun/.test(c)) return night ? '🌙' : '☀️';
  return night ? '🌙' : '🌤️';
}

/**
 * The chip's one line.
 *
 * With the quiet-hours chip up — evenings only — the condition word yields to it and the line
 * becomes glyph + temperature. That is what keeps the widest row on a 402px screen inside its
 * bounds at "quiet at 10:30", and the adjective is one tap away in the sheet rather than lost.
 */
export function wxLine(conditions: string | undefined, tempC: number | undefined, terse: boolean): string {
  const temp = tempC == null ? '' : `${tempC}°`;
  const word = terse ? '' : cap(conditions ?? '');
  if (!word) return temp || cap(conditions ?? '');
  return temp ? `${word} · ${temp}` : word;
}

type Reading = { conditions?: string; temp_c?: number; precip_chance?: number | null };

/**
 * The coach's line in the weather sheet — composed from the numbers the snapshot actually carries,
 * never generated. Nothing here is a forecast we do not have: `precip_chance` is the provider's own
 * short-range probability, and when it is missing the sentence simply stops after the reading.
 */
export function weatherSentence(w: Reading): string {
  const now = [cap(w.conditions ?? ''), w.temp_c == null ? '' : `${w.temp_c}°`].filter(Boolean).join(' and ');
  const head = now ? `${now} right now` : 'Here is what I have right now';
  if (w.precip_chance == null) return `${head}.`;
  const pct = Math.round(w.precip_chance * 100);
  const wet = w.temp_c != null && w.temp_c <= 1 ? 'snow' : 'rain';
  return pct < 20 ? `${head} — dry for the next few hours.` : `${head} — about a ${pct}% chance of ${wet} later on.`;
}
