/**
 * What "Ask the coach" sends from inside the builder.
 *
 * The save moment's version of this button (`onAskReview`, SavedMoment) needs nothing but a name:
 * the routine is on the server by then, so her context pack already carries its steps. A DRAFT is
 * on nobody's server. She cannot adjust what she cannot see, so the steps travel in the message.
 *
 * It is sent the way every other steer is — VISIBLY, as the user's own bubble — so what she is
 * reacting to is on screen for the person who asked. That is also why this reads like a person
 * talking rather than a dump: it is going to appear as something they said.
 */
import type { SessionItem } from '@cadence/shared';
import type { BuilderCard } from './builderSession.ts';

/** "3 × 10", "20 min", "5 km, 55 lb" — whatever the step actually specifies, in that order. */
function describeItem(item: SessionItem): string {
  const bits: string[] = [];
  if (item.sets && item.reps) bits.push(`${item.sets} × ${item.reps}`);
  else if (item.sets) bits.push(`${item.sets} sets`);
  else if (item.reps) bits.push(`${item.reps} reps`);
  if (item.duration_min) bits.push(`${item.duration_min} min`);
  if (item.distance_km) bits.push(`${item.distance_km} km`);
  if (item.load) bits.push(item.load);
  if (item.detail) bits.push(item.detail);
  return bits.length ? `${item.name} — ${bits.join(', ')}` : item.name;
}

/**
 * The draft as a short readable list, for the coach ask.
 *
 * Blank steps are skipped rather than sent as bare dashes: a half-added card is noise she would
 * otherwise feel obliged to comment on. An empty draft returns null — there is nothing to ask
 * about, and the caller hides the door.
 */
export function describeDraft(name: string, cards: BuilderCard[]): string | null {
  const lines: string[] = [];
  // A card IS a block and the builder makes one step per card, so consecutive cards routinely
  // share a label — three strength steps are three separate "Main" blocks. Repeating the heading
  // over each of them reads as three sections that happen to be identically named, which is not
  // what the draft says. The heading is written when it CHANGES.
  let heading: string | null = null;
  for (const { block } of cards) {
    const items = block.items.filter((i) => i.name.trim());
    if (!items.length) continue;
    const label = block.label.trim();
    if (label && label !== heading) {
      lines.push(label);
      heading = label;
    }
    for (const item of items) lines.push(`- ${describeItem(item)}`);
  }
  if (!lines.length) return null;

  // Named or not, the ask is the same shape. An unnamed draft just stops early rather than
  // sending an empty pair of quotes she has to guess at.
  const opener = name.trim()
    ? `Can you look at the activity I'm putting together — "${name.trim()}"?`
    : "Can you look at the activity I'm putting together?";
  return [opener, '', ...lines].join('\n');
}
