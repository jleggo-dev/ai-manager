/* ════════════════════════════════════════════════════════════════
   Copy for the PUSH nudges — the four only the server could know
   ════════════════════════════════════════════════════════════════ */

import type { NudgeCopy, NudgeCopyInputFor } from './copy-types.ts';
import { pickVariant, type Variants } from './variant.ts';

/**
 * These four cost more than the local set, and not in money: a push arrives from outside, so it
 * carries an implicit claim that something happened worth interrupting for. Each of these has one.
 * A freeze fired overnight. A detour is ending. Nobody has logged anything for three days.
 * Tomorrow's forecast disagrees with tomorrow's run. None of them is a reminder of something the
 * user already knows.
 */

/* ── freeze_save ──────────────────────────────────────────────────────────────────────────────
   The ONLY streak notification that exists, and it only ever arrives AFTER the save. There is no
   "your streak is at risk", no countdown, no warning — a protected streak that spends its
   protection quietly and then tells you is the whole point of having freezes (BRAND.md amendment
   2026-07-24). It is sent the next morning, never the same night: a 23:59 buzz saying a day off
   was fine would itself be the thing that made the day off not fine. */

const FREEZE_SAVE_BODIES = [
  'You earned that day off. I used a freeze — {n} days, still counting.',
  'That day off is covered. I spent a freeze — {n} days, still counting.',
  'I put a freeze on yesterday. {n} days, still counting.',
] as const satisfies Variants;

export function freezeSaveCopy(input: NudgeCopyInputFor<'freeze_save'>): NudgeCopy {
  const template = pickVariant(FREEZE_SAVE_BODIES, input.savedDate, 0);
  return { title: "Streak's safe", body: template.replace('{n}', String(input.streakDays)) };
}

/* ── detour_ending ────────────────────────────────────────────────────────────────────────────
   Both options are offered as equals, in that order, in one sentence — "both are fine" is doing
   real work. A detour that ends by default, with returning as the only unmarked choice, teaches
   someone that asking for more time is a concession. It isn't. The long-press actions mirror the
   sentence exactly so the reply is one tap either way. */

const DETOUR_ENDING_BODIES = [
  'Ease back in, or take more time — both are fine. Tell me which.',
  'Tomorrow you can ease back in, or keep the detour going. Both are fine — tell me which.',
  'Ease back in tomorrow, or take longer. Either is fine. Tell me which.',
] as const satisfies Variants;

export function detourEndingCopy(input: NudgeCopyInputFor<'detour_ending'>): NudgeCopy {
  return {
    title: 'Your detour ends tomorrow',
    body: pickVariant(DETOUR_ENDING_BODIES, input.episodeId, 0),
  };
}

/* ── re_entry ─────────────────────────────────────────────────────────────────────────────────
   Honest about why the coach is messaging, and honest about the limit of what it knows. "I haven't
   seen you in a few days — that's all" says the observation and then explicitly refuses to build
   on it: no inference about mood, health, motivation or whether anything is wrong. Absence is not
   evidence about a person.

   The ladder DECAYS. Once at day three, one softer line at day seven, then silence — permanently,
   for this absence. Escalation is the natural shape here and it is exactly wrong: the longer
   someone is away, the less a stranger's opinion is welcome. A detour is proposed only after they
   explain the gap, never presumed in the notification. */

/** Day three: the observation, and an explicit refusal to build anything on it. */
const RE_ENTRY_FIRST = "I haven't seen you in a few days — that's all. Want to look at the plan together?";

/** Day seven: quieter, shorter, and it asks for nothing. Then the ladder is finished. */
const RE_ENTRY_SOFTER = 'Still here whenever you want to pick this back up. Nothing to make up.';

export function reEntryCopy(input: NudgeCopyInputFor<'re_entry'>): NudgeCopy {
  return { title: 'Checking in', body: input.thresholdDay >= 7 ? RE_ENTRY_SOFTER : RE_ENTRY_FIRST };
}

/* ── weather_move ─────────────────────────────────────────────────────────────────────────────
   Pure service, zero judgment. It reports a fact, proposes one concrete alternative with the
   numbers behind it, and asks. It never suggests going anyway, never suggests skipping, and never
   comments on the choice — the user may well love running in rain, and this notification has no
   opinion about that. Temperature is spoken ("18 degrees"), not printed as a unit symbol. */

const WEATHER_MOVE_BODIES = [
  'Your {activity} could move to {alt} — {cond} and {temp} degrees. Want me to shift it?',
  '{Activity} could move to {alt} instead — {cond} and {temp} degrees. Want me to shift it?',
] as const satisfies Variants;

export function weatherMoveCopy(input: NudgeCopyInputFor<'weather_move'>): NudgeCopy {
  const activity = input.activityTitle.trim();
  const template = pickVariant(WEATHER_MOVE_BODIES, activity, input.weekday);
  return {
    title: `${input.conditionLabel} at ${input.whenLabel} tomorrow`,
    body: template
      .replace('{Activity}', activity.charAt(0).toUpperCase() + activity.slice(1))
      .replace('{activity}', activity)
      .replace('{alt}', input.altLabel)
      .replace('{cond}', input.altConditionLabel)
      .replace('{temp}', String(Math.round(input.altTempC))),
  };
}
