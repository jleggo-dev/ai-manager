/**
 * What Cadence asks for after a session, and what Cadence says back.
 *
 * The rule the design is built on: **the objective outcome is already known.** Rounds, minutes,
 * skipped steps and trims all come out of the walkthrough's own StepLogs, so Cadence *states*
 * them — never asking "did you finish?". These chips capture the one signal telemetry cannot
 * see: how it felt. That is why there is exactly one question per session and it is always
 * optional; "Done" is one tap and feedback never blocks the celebration.
 *
 * Movement asks perceived effort (or, when steps were skipped, a reason code). Mind asks felt
 * state — and deliberately has NO reason codes, because on the mind pillar a stopped session is
 * a completed rep, not a skip, and asking "why did you stop?" would frame it as one.
 *
 * Every `reply` is Cadence in the single coach voice, and each one names the concrete adjustment the
 * answer causes — an answer that changes nothing isn't worth asking for.
 */

export const RPE_CODES = ['too_easy', 'just_right', 'too_hard'] as const;
export type RpeCode = (typeof RPE_CODES)[number];

export const SKIP_REASON_CODES = ['no_time', 'body_off', 'not_feeling_it'] as const;
export type SkipReasonCode = (typeof SKIP_REASON_CODES)[number];

export const FELT_STATE_CODES = ['calmer', 'same', 'more_wound_up'] as const;
export type FeltStateCode = (typeof FELT_STATE_CODES)[number];

export interface FeedbackChip<C extends string> {
  code: C;
  label: string;
  /** Cadence's answer — names the adjustment this causes, never just acknowledgement. */
  reply: string;
}

export const RPE_CHIPS: readonly FeedbackChip<RpeCode>[] = [
  { code: 'too_easy', label: 'Too easy', reply: "Noted — I'll nudge the pace up a touch next time." },
  { code: 'just_right', label: 'Just right', reply: "Perfect. That's exactly where we want to live." },
  { code: 'too_hard', label: 'Too hard', reply: 'Thanks for telling me — tomorrow eases off a notch.' },
];

export const SKIP_REASON_CHIPS: readonly FeedbackChip<SkipReasonCode>[] = [
  { code: 'no_time', label: 'Ran out of time', reply: "Fair. I'll keep cool-downs to 3 minutes on busy days." },
  { code: 'body_off', label: 'Body felt off', reply: "Good call stopping. Tomorrow stays gentle — and I've noted it." },
  {
    code: 'not_feeling_it',
    label: "Wasn't feeling it",
    reply: "That happens. Showing up was the win — I won't pile on.",
  },
];

export const FELT_STATE_CHIPS: readonly FeedbackChip<FeltStateCode>[] = [
  { code: 'calmer', label: 'Calmer', reply: "Good. That's the down-shift working — same time tomorrow." },
  {
    code: 'same',
    label: 'About the same',
    reply: "That's fine — the reps still count. We'll try a different tool next time.",
  },
  {
    code: 'more_wound_up',
    label: 'More wound up',
    reply: 'Thanks for the honesty. Shorter and slower tomorrow — six breaths, nothing more.',
  },
];

export type SessionFeedbackKind = 'movement' | 'mind';

export interface SessionFeedback {
  kind: SessionFeedbackKind;
  rpe?: RpeCode | null;
  felt_state?: FeltStateCode | null;
  reason_code?: SkipReasonCode | null;
}

/** 5-point mood for the daily check-in. Stored 1–5; the labels are the only thing rendered. */
export const MOODS = [
  { value: 1, label: 'ROUGH' },
  { value: 2, label: 'MEH' },
  { value: 3, label: 'OKAY' },
  { value: 4, label: 'GOOD' },
  { value: 5, label: 'GREAT' },
] as const;

export type MoodValue = (typeof MOODS)[number]['value'];

export const CHECKIN_ADJUSTMENTS = ['keep', 'lighter', 'earlier'] as const;
export type CheckinAdjustment = (typeof CHECKIN_ADJUSTMENTS)[number];

export interface CheckinAdjustmentOption {
  code: CheckinAdjustment;
  label: string;
  sub: string;
  /** The steer handed to the ordinary plan-adjust flow — never a bespoke mutation path. */
  steer: string;
  reply: string;
}

/**
 * The three offers. Each one is just a pre-written steer for the SAME suggest→preview→confirm
 * adjust flow the coach already uses, so a check-in can never mutate a plan by a route the user
 * can't see, undo, or argue with.
 */
export const CHECKIN_ADJUSTMENT_OPTIONS: readonly CheckinAdjustmentOption[] = [
  {
    code: 'keep',
    label: 'Keep the week as is',
    sub: 'Yesterday was a blip — carry on',
    steer: '',
    reply: 'Done — the week stays put.',
  },
  {
    code: 'lighter',
    label: 'Make it lighter',
    sub: 'Trim a session, make one optional',
    steer: 'Make the rest of this week lighter — trim one session and make another optional.',
    reply: 'Let me show you what that looks like before anything moves.',
  },
  {
    code: 'earlier',
    label: 'Shift evenings earlier',
    sub: 'Wind-downs keep losing to dinner',
    steer: 'Move my evening sessions earlier — they keep losing to dinner. Aim for before 7pm.',
    reply: 'Let me show you what that looks like before anything moves.',
  },
];

export function isRpeCode(v: unknown): v is RpeCode {
  return typeof v === 'string' && (RPE_CODES as readonly string[]).includes(v);
}
export function isSkipReasonCode(v: unknown): v is SkipReasonCode {
  return typeof v === 'string' && (SKIP_REASON_CODES as readonly string[]).includes(v);
}
export function isFeltStateCode(v: unknown): v is FeltStateCode {
  return typeof v === 'string' && (FELT_STATE_CODES as readonly string[]).includes(v);
}
export function isCheckinAdjustment(v: unknown): v is CheckinAdjustment {
  return typeof v === 'string' && (CHECKIN_ADJUSTMENTS as readonly string[]).includes(v);
}
