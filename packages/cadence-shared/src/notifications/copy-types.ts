/* ════════════════════════════════════════════════════════════════
   What each nudge needs to know before it can say anything
   ════════════════════════════════════════════════════════════════ */

import type { NudgeKind } from './kinds.ts';
import type { NudgeRegister } from './pillar.ts';

/** The finished words. Nothing downstream may edit these — a caller that appends is writing copy. */
export interface NudgeCopy {
  title: string;
  body: string;
}

/**
 * One discriminated case per kind, and every field is a FACT the caller already holds: a count, a
 * date, the user's own words for the thing. There is no free-text field anywhere in this union,
 * and that is the design.
 *
 * Copy is deterministic by owner ruling — no AI Admin job, no LLM, no template that accepts a
 * sentence from elsewhere. A notification carries the least context and the most weight of any
 * surface Cadence has: it arrives without the app around it to soften a bad phrasing, and it
 * cannot be recalled. A generated sentence is a sentence nobody reviewed, arriving on a lock
 * screen, at a moment we did not choose.
 *
 * `weekday` is present on the kinds that recur so `variantIndex` can rotate them. 1 = Sunday … 7 =
 * Saturday, matching `IosWeekday`, so a local notification's own trigger weekday is the seed.
 */
export type NudgeCopyInput =
  | { kind: 'weekly_checkin'; weekday: number }
  | {
      kind: 'almost_time';
      /** Seeds the variant rotation, so this activity's Tuesday line is always this sentence. */
      activityId: string;
      /** The user's own words, used verbatim as the title — never a system label. */
      activityTitle: string;
      hour: number;
      minute: number;
      register: NudgeRegister;
      weekday: number;
    }
  | {
      kind: 'milestone_waypoint';
      /** What the day is, in the user's words: "race day", "morning pages". */
      label: string;
      /** 6, 3 or 1 week out; 0 is the day before. The four waypoints the design names. */
      weeksOut: number;
      register: NudgeRegister;
      /** An optional plan fact that earns its place: "Taper starts on the 24th." */
      detail?: string;
      /** Total span of the commitment, when known — lets the one-week line say "Thirty days". */
      totalDays?: number;
      weekday: number;
    }
  | {
      kind: 'before_quiet_hours';
      activityId: string;
      activityTitle: string;
      minutesUntilQuiet: number;
      register: NudgeRegister;
      weekday: number;
    }
  | {
      kind: 'morning_adjust';
      /** A count, never a percentage: "2 of 4". Both numbers are shown, always. */
      done: number;
      planned: number;
      weekday: number;
    }
  | {
      kind: 'freeze_save';
      /** The streak the freeze protected, so the line can end on a number that went UP. */
      streakDays: number;
      /** YYYY-MM-DD of the day absorbed — also the dedupe target, and the variant seed. */
      savedDate: string;
    }
  | { kind: 'detour_ending'; episodeId: string }
  | {
      kind: 're_entry';
      /** 3 = the one honest check-in. 7 = one softer line. There is no third. */
      thresholdDay: number;
    }
  | {
      kind: 'weather_move';
      activityTitle: string;
      /** "Rain", "Snow" — sentence-initial, from the forecast, never adjectival colour. */
      conditionLabel: string;
      /** When the weather lands, on the user's clock: "6". */
      whenLabel: string;
      /** Where the session could go instead, in plain words: "lunch", "the morning". */
      altLabel: string;
      altConditionLabel: string;
      altTempC: number;
      weekday: number;
    };

/** Narrowing helper for the builders and their tests. */
export type NudgeCopyInputFor<K extends NudgeKind> = Extract<NudgeCopyInput, { kind: K }>;
