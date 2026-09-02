/**
 * Suggested names for a bracket — the user's own words first, never an invented cheerful name
 * (MEAL-LOGGING.md: 'she typed "chia bowl" → first chip is *Chia bowl*. Nothing invents a name.').
 *
 * Sources, in order: short phrases the chat door heard verbatim; a plain compound of the first
 * two member names ("Yogurt & chia"); and the canvas's own generic chip, "My usual".
 */

const MAX_RAW_WORDS = 4;
const MAX_RAW_CHARS = 28;

const firstWord = (name: string): string => name.split(/[,·(]/)[0]!.trim().split(/\s+/)[0] ?? '';

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function nameChips(rawTexts: string[], memberNames: string[]): string[] {
  const chips: string[] = [];
  for (const raw of [...rawTexts].reverse()) {
    const t = raw.trim();
    if (!t || t.length > MAX_RAW_CHARS) continue;
    if (t.split(/\s+/).length > MAX_RAW_WORDS) continue;
    chips.push(cap(t));
    break; // one chip from their words is enough — the rest would be noise
  }
  const [a, b] = memberNames;
  if (a && b) {
    const compound = `${cap(firstWord(a))} & ${firstWord(b).toLowerCase()}`;
    if (!chips.some((c) => c.toLowerCase() === compound.toLowerCase())) chips.push(compound);
  }
  chips.push('My usual');
  return chips.slice(0, 3);
}
