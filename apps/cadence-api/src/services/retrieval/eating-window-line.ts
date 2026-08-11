import type { EatingWindow, EatingWindowSpan } from '@cadence/shared';
import { describeRecurrence } from '../scheduling.ts';

/**
 * How an eating window reaches a coach TURN — the other half of `baseline.eating_window`.
 *
 * Storage is durable; that is not the same as present in the conversation. The planner reads the
 * window out of `<baseline>` at synthesis time and drops the meal tasks outside it, but the coach
 * only ever sees what the context pack renders, so a stored window nobody renders is a coach who
 * cheerfully offers a 16:8 eater an omelette. It rides inside `get_dietary_profile` (already
 * domains ['nutrition','safety'], already described as "use before suggesting foods/recipes")
 * rather than a fifteenth retrieval function, so `context_select` pulls it on any food turn with no
 * catalog change. `availability` is the cautionary tale: stored faithfully, rendered nowhere.
 *
 * Its own module because rendering is a distinct responsibility from the registry's plumbing, and
 * because this line is the one the user's way of eating is judged by — it deserves its own tests.
 */

/** "Mon, Tue, Wed" from RRULE codes, via the one day vocabulary the app already speaks. */
function describeDays(days: readonly string[]): string {
  return describeRecurrence(`FREQ=WEEKLY;BYDAY=${days.join(',')}`);
}

/** The clock part of one span, or '' when they gave no times. */
function describeClock(span: EatingWindowSpan): string {
  if (span.earliest && span.latest) return `${span.earliest}–${span.latest}`;
  if (span.earliest) return `from ${span.earliest}`;
  if (span.latest) return `until ${span.latest}`;
  return '';
}

function describeSpan(span: EatingWindowSpan): string {
  const clock = describeClock(span);
  const days = span.days?.length ? describeDays(span.days) : '';
  if (days && clock) return `${days} ${clock}`;
  if (days) return `${days} (no times given)`;
  return clock;
}

/**
 * One line for the context pack, or '' when there is no window on file — and '' is the common,
 * correct case. Absent means they never said it, and nothing infers it.
 *
 * The line carries the fact, their words for it, and what to DO: suggest food inside the window and
 * stop asking after meals they do not eat. It deliberately does NOT ask the coach to track
 * adherence to it. There is no off-window flag anywhere in the app, and this line is where that
 * decision would quietly get relitigated — a coach told to "notice when they break it" is a
 * scoreboard with a warm voice (BRAND.md: count what happened, never what broke).
 */
export function renderEatingWindow(w: EatingWindow | null | undefined): string {
  const saidAs = w?.said_as?.trim();
  if (!saidAs) return '';

  const spans = (w?.windows ?? []).map(describeSpan).filter(Boolean);
  // No spans is a real answer ("I just skip breakfast") — keep their words and let her ask.
  const when = spans.length ? `eats ${spans.join('; ')}` : 'they gave no clock times';
  const until = w?.until ? `, until ${w.until}` : '';
  return (
    `Eating window — their words: "${saidAs}"; ${when}${until}. ` +
    'Suggest food inside it and never offer or ask after a meal they do not eat. ' +
    'Eating outside it is not a slip: mention timing warmly if it matters, never keep score of it.'
  );
}
