/* ════════════════════════════════════════════════════════════════
   Long-press actions — a reply without opening the app
   ════════════════════════════════════════════════════════════════ */

import type { NudgeKind } from './kinds.ts';

/**
 * iOS calls these notification *categories*: a category id registered at launch, carrying up to
 * four buttons that appear on a long press. The id travels on the notification; the buttons live
 * in the app. That indirection is why the ids here are stable strings and never derived — a
 * notification scheduled last week must still find its buttons after an update.
 *
 * Two rules make these safe:
 *
 * 1. Every category offers a way to say NO that is not dismissal. "Keep it as planned" and
 *    "Extend a few days" are real answers the coach acts on. A menu whose only options are
 *    agreement and silence is not a choice.
 *
 * 2. Anything an action would need to know is composed at SCHEDULE time and carried in the
 *    notification's payload. Nothing is computed when the button is tapped. A tap happens with the
 *    app cold, possibly offline, possibly days later — a lighter version of today's plan worked
 *    out in that moment would be worked out from whatever happened to be cached, which is how a
 *    user taps "Lighten today" and gets last week's session.
 */

export const NUDGE_CATEGORY = {
  morningAdjust: 'cadence.morning_adjust',
  detourEnding: 'cadence.detour_ending',
  reEntry: 'cadence.re_entry',
  weatherMove: 'cadence.weather_move',
} as const;

export type NudgeCategoryId = (typeof NUDGE_CATEGORY)[keyof typeof NUDGE_CATEGORY];

export interface NudgeAction {
  /** Stable id the app switches on when the notification is tapped. */
  id: string;
  /** The button label. Plain, and an answer rather than a command. */
  title: string;
  /** Foreground actions open the app; the rest are answered in place. */
  foreground: boolean;
}

export interface NudgeCategory {
  id: NudgeCategoryId;
  actions: NudgeAction[];
}

/** "Talk it through" appears on every category: there is always a way to reach the coach with
 *  words instead of picking from a menu someone else wrote. */
const TALK: NudgeAction = { id: 'talk', title: 'Talk it through', foreground: true };

export const NUDGE_CATEGORIES: readonly NudgeCategory[] = [
  {
    id: NUDGE_CATEGORY.morningAdjust,
    actions: [
      { id: 'lighten_today', title: 'Lighten today', foreground: false },
      { id: 'keep_as_planned', title: 'Keep it as planned', foreground: false },
      TALK,
    ],
  },
  {
    id: NUDGE_CATEGORY.detourEnding,
    actions: [
      { id: 'ease_back_in', title: 'Ease back in', foreground: false },
      { id: 'extend_detour', title: 'Extend a few days', foreground: false },
      TALK,
    ],
  },
  {
    // The returning-intent check-in is a conversation, not a menu: the user explains the gap in
    // their own words and a detour is proposed only after that. So the one action opens it.
    id: NUDGE_CATEGORY.reEntry,
    actions: [{ id: 'open_checkin', title: 'Look at the plan', foreground: true }],
  },
  {
    id: NUDGE_CATEGORY.weatherMove,
    actions: [
      { id: 'shift_session', title: 'Shift it', foreground: false },
      { id: 'keep_as_planned', title: 'Keep it as planned', foreground: false },
      TALK,
    ],
  },
];

/** The category a kind posts under, or null when a plain tap-to-open is the whole interaction. */
export function categoryForKind(kind: NudgeKind): NudgeCategoryId | null {
  switch (kind) {
    case 'morning_adjust':
      return NUDGE_CATEGORY.morningAdjust;
    case 'detour_ending':
      return NUDGE_CATEGORY.detourEnding;
    case 're_entry':
      return NUDGE_CATEGORY.reEntry;
    case 'weather_move':
      return NUDGE_CATEGORY.weatherMove;
    default:
      return null;
  }
}
