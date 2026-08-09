/* ════════════════════════════════════════════════════════════════
   Copy for the LOCAL nudges — the five the device can schedule itself
   ════════════════════════════════════════════════════════════════ */

import type { NudgeCopy, NudgeCopyInputFor } from './copy-types.ts';
import { capitalize, clockLabel, durationLabel, isPluralish, numberWord, possessive } from './format.ts';
import { pickVariant, type Variants } from './variant.ts';
import type { NudgeRegister } from './pillar.ts';

/**
 * Every sentence in this file is a template with holes for facts the user already gave us. None of
 * it is generated, and none of it may be edited downstream — see copy-types.ts for why.
 *
 * The variant sets are small (two or three) and rotate on activity + weekday. That is enough that
 * the same nudge does not read identically every week, and few enough that the whole catalog can
 * be held in a reviewer's head and pinned by a test.
 */

/* ── weekly_checkin ───────────────────────────────────────────────────────────────────────────
   Calibration, not a status report. It fires the MORNING of the check-in the plan already
   contains, so the body's job is to say "this is here when you want it" and then stop. Anything
   that hinted at a score would turn a two-way conversation into a report card before it opened. */

const WEEKLY_CHECKIN_BODIES = [
  "It's on today's plan — ten minutes to tune next week, whenever suits.",
  "On today's plan: ten minutes to shape next week, whenever suits you.",
  "Ten minutes today to set next week's shape — whenever suits.",
] as const satisfies Variants;

export function weeklyCheckinCopy(input: NudgeCopyInputFor<'weekly_checkin'>): NudgeCopy {
  return {
    title: 'Weekly check-in',
    body: pickVariant(WEEKLY_CHECKIN_BODIES, 'weekly_checkin', input.weekday),
  };
}

/* ── almost_time ──────────────────────────────────────────────────────────────────────────────
   The title is the activity, verbatim: "Your Tuesday run", because that is what the user called
   it. The body names the ONE piece of friction that actually stops the thing happening, and it
   differs by register — kit by the door is true of a run and meaningless about a sit. Untimed
   activities never reach here; the builder skips them rather than inventing an hour. */

const ALMOST_TIME_BODIES: Record<NudgeRegister, Variants> = {
  body: [
    'Coming up at {time}. Kit by the door is the hard part.',
    'Coming up at {time}. The first ten minutes are the whole trick.',
    'At {time}. Shoes on is most of it.',
  ],
  mind: [
    "Ten minutes before the house gets loud. Cushion's where you left it.",
    "At {time}. The cushion's where you left it.",
    'Coming up at {time}. Ten quiet minutes before the day fills up.',
  ],
  neutral: [
    "Coming up at {time}. Whenever you're ready.",
    'At {time}, if it still fits.',
    'Coming up at {time}. A short one counts.',
  ],
};

export function almostTimeCopy(input: NudgeCopyInputFor<'almost_time'>): NudgeCopy {
  const template = pickVariant(ALMOST_TIME_BODIES[input.register], input.activityId, input.weekday);
  return {
    title: input.activityTitle.trim(),
    body: template.replace('{time}', clockLabel(input.hour, input.minute)),
  };
}

/* ── milestone_waypoint ───────────────────────────────────────────────────────────────────────
   A countdown read as anticipation, never as pressure. The number going DOWN is the good news
   here, so the body's job is to confirm the plan is intact — "right where the plan wants you" —
   and offer a fact if there is one worth having. Skipped entirely during a detour, upstream: a
   countdown to a day you have already told us you cannot train for is the definition of pressure. */

const WAYPOINT_BODIES = [
  'Right where the plan wants you.',
  'Right on the shape of it. Nothing to change today.',
  'Right where the plan wants you. Nothing to change today.',
] as const satisfies Variants;

const WAYPOINT_MIND_BODIES = [
  'Nearly done. The last stretch is just more of the same.',
  'Nearly there. What is left is more of the same, which is the point.',
] as const satisfies Variants;

/** "Six weeks", "Three weeks", "One week", or the day-before form. */
function waypointWhen(weeksOut: number): string {
  if (weeksOut <= 0) return 'Tomorrow';
  return `${capitalize(numberWord(weeksOut))} week${weeksOut === 1 ? '' : 's'}`;
}

function waypointTitle(input: NudgeCopyInputFor<'milestone_waypoint'>): string {
  const when = waypointWhen(input.weeksOut);
  if (input.weeksOut <= 0) return `${when}: ${input.label}`;
  // A standing practice runs OUT rather than arriving — "One week of morning pages left" — while a
  // dated goal is somewhere you are heading toward. Same countdown, two different relationships.
  return input.register === 'mind' ? `${when} of ${input.label} left` : `${when} to ${input.label}`;
}

export function milestoneWaypointCopy(input: NudgeCopyInputFor<'milestone_waypoint'>): NudgeCopy {
  const title = waypointTitle(input);
  if (input.detail) return { title, body: `Right where the plan wants you. ${input.detail}` };

  if (input.register === 'mind') {
    // The one place a total span earns its keep: "Thirty days, nearly done" lands because it names
    // how far they have already come, which a weeks-remaining count cannot.
    if (input.weeksOut === 1 && input.totalDays) {
      return {
        title,
        body: `${capitalize(numberWord(input.totalDays))} days, nearly done. The last seven are just more of the same.`,
      };
    }
    return {
      title,
      body: pickVariant(WAYPOINT_MIND_BODIES, input.label, input.weekday),
    };
  }
  return { title, body: pickVariant(WAYPOINT_BODIES, input.label, input.weekday) };
}

/* ── before_quiet_hours ───────────────────────────────────────────────────────────────────────
   Framed as FITS, never as running out. "Your stretch still fits" is an open door; "40 minutes
   left to do your stretch" is a deadline, and a deadline at 8:15pm is how an app earns being
   turned off. Partial credit is in the body by design — ten of the forty is the offer, because a
   nudge that only accepts the whole thing gets ignored on exactly the evenings it was for. */

const QUIET_SOON_BODIES: Record<NudgeRegister, Variants> = {
  body: ['About {gap} until quiet hours. Ten of them is enough.', 'Quiet hours in {gap}. Ten minutes of it counts.'],
  mind: ['Quiet hours in {gap}. The short version counts.', 'About {gap} until quiet hours. The short version counts.'],
  neutral: ['About {gap} until quiet hours. A short one still counts.', 'Quiet hours in {gap}. A short one counts.'],
};

export function beforeQuietHoursCopy(input: NudgeCopyInputFor<'before_quiet_hours'>): NudgeCopy {
  const template = pickVariant(QUIET_SOON_BODIES[input.register], input.activityId, input.weekday);
  const name = input.activityTitle.trim();
  return {
    title: `${possessive(name)} still ${isPluralish(name) ? 'fit' : 'fits'}`,
    body: template.replace('{gap}', durationLabel(input.minutesUntilQuiet)),
  };
}

/* ── morning_adjust ───────────────────────────────────────────────────────────────────────────
   A count, never a percentage, and never the word "only" — "2 of 4" is information, "only 40%" is
   a grade. The offer to lighten today is the whole point of saying anything at all: without it
   this is a scoreboard, and Cadence is a hearth. Suppressed after a freeze-save or during a
   detour, upstream — two notifications about the same day is one too many. */

const MORNING_ADJUST_BODIES = [
  'No catching up needed. Want me to lighten today a little?',
  'Nothing to make up. Want me to lighten today a little?',
  "That's the day as it was. Want me to lighten today a little?",
] as const satisfies Variants;

export function morningAdjustCopy(input: NudgeCopyInputFor<'morning_adjust'>): NudgeCopy {
  return {
    title: `Yesterday: ${input.done} of ${input.planned}`,
    body: pickVariant(MORNING_ADJUST_BODIES, `${input.done}/${input.planned}`, input.weekday),
  };
}
