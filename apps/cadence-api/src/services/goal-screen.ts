/**
 * Goal screen — deterministic scope + safety pass over a goal BEFORE it becomes a plan.
 *
 * Sibling to goal-guardrail.ts (which asks "how many?"); this one asks "should Cadence coach this
 * at all?". It exists because the persona alone is a soft guarantee: a prompt can be talked around
 * over a long conversation, and the Broker's `capture_extract` will happily write down whatever the
 * conversation contained. This runs in app code on the persist path, so the answer does not depend
 * on how the last 40 turns went.
 *
 * TWO verdicts, deliberately asymmetric:
 *
 *  • 'refuse'  — a narrow, unambiguous list: goals whose whole point is self-harm (purging, starving,
 *                cutting water for a weigh-in, unprescribed drug protocols). These never persist.
 *                Small on purpose — a false 'refuse' tells someone their goal is unspeakable, which
 *                is the exact opposite of what a coach should do with a person who just disclosed it.
 *  • 'reshape' — plausibly fine, plausibly not: goals that read as out of Cadence's scope, or as a
 *                rate/floor a coach should push back on. These DO persist (nothing is deleted behind
 *                the user's back) but carry a note the coach must raise. Someone who says "1,000
 *                calories a day" usually wants a result, not harm, and the coaching move is to say
 *                so out loud — not to silently drop the card and act like they never spoke.
 *
 * Everything else passes. This is a tripwire, not a morality filter: it fires on a handful of things
 * that are actually dangerous or actually not coaching, and stays out of the way otherwise.
 */
import type { GoalArea, GoalMeasure, GoalType, Timeframe } from '@cadence/shared';

export type GoalVerdict = 'ok' | 'reshape' | 'refuse';

export interface GoalScreenResult {
  verdict: GoalVerdict;
  /** Machine tag for logs/tests — never shown to the user. */
  code?: string;
  /**
   * What the COACH should say out loud about it, in the coach's own register. Injected into the
   * session as context, so the pushback happens in conversation rather than as a silent rejection.
   */
  note?: string;
}

export interface ScreenableGoal {
  title?: string;
  area?: GoalArea | string;
  type?: GoalType | string;
  measure?: Partial<GoalMeasure>;
  timeframe?: Partial<Timeframe>;
}

/**
 * Word-boundary matcher — substring matching turns "assist" into a hit for "sist". Tolerates the
 * common inflections ("laxative" → "laxatives") so the term list stays readable instead of becoming
 * a plural table, but still refuses to match mid-word.
 */
function has(text: string, terms: readonly string[]): string | null {
  for (const t of terms) {
    if (new RegExp(`(^|[^a-z])${t.replace(/ /g, '[ -]?')}(s|es|d|ed|ing)?([^a-z]|$)`, 'i').test(text)) return t;
  }
  return null;
}

/**
 * Unambiguous harm. Every term here names the harmful ACT, not a body goal or a food choice —
 * "lose weight", "cut", "fast", and "diet" are all deliberately absent, because each is ordinary
 * and the false positive would be brutal.
 */
const HARM_TERMS = [
  'purge',
  'purging',
  'make myself (throw up|vomit|sick)',
  'self.?induced vomiting',
  'laxative',
  'diuretic',
  'water cut',
  'sweat suit',
  'starve',
  'starving myself',
  'stop eating',
  'not eat(ing)? at all',
  'anorexi',
  'bulimi',
  'thinspo',
  'pro.?ana',
  'cut myself',
  'self.?harm',
  'anabolic',
  'steroid cycle',
  'sarms?',
  'clenbuterol',
  'dnp',
  'ozempic',
  'semaglutide',
  'tirzepatide',
  'appetite suppressant',
] as const;

/**
 * Habits that build a dependency rather than a rhythm. 'reshape', not 'refuse' — someone whose goal
 * is "drink less" is exactly who a coach should help, and only the *building* direction is a problem.
 */
const SUBSTANCE_TERMS = ['drink more', 'drinking more', 'vap(e|ing) more', 'smoke more', 'nicotine', 'kratom'] as const;

/**
 * Out of scope: the tell is that the deliverable is CADENCE'S output, not the person's practice.
 * "practice rust for 30 minutes daily" is a legitimate practice-area rhythm and must pass — only
 * "write my code" is caught, and even then it only reshapes, so the coach can offer the real version.
 */
const DO_MY_WORK_TERMS = [
  'write (my|the) (code|script|app|program|essay|paper|thesis|report|email|emails)',
  'debug (my|the)',
  'do my (homework|taxes|assignment|assignments)',
  'answer my (email|emails|messages)',
  'build (my|the) (app|website|saas) for me',
  'write it for me',
  'fix (my|the) (code|bug)',
] as const;

/** kcal/day below this is not a target a coach sets — it is one a clinician supervises. */
export const MIN_DAILY_KCAL = 1200;
/** Fraction of body weight per week above which loss is not a rate, it is an emergency. */
export const MAX_WEEKLY_LOSS_FRACTION = 0.015;
/** Hours of sleep below which "sleep less" stops being discipline. */
export const MIN_SLEEP_HOURS = 6;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Numeric floors/rates the words alone would miss — "eat 800 a day" reads perfectly innocent. */
function screenNumbers(g: ScreenableGoal, bodyWeightKg?: number): GoalScreenResult | null {
  const metric = `${g.measure?.metric ?? ''} ${g.measure?.unit ?? ''}`.toLowerCase();
  const target = num(g.measure?.target);

  if (target != null && /cal|kcal|energy/.test(metric) && target > 0 && target < MIN_DAILY_KCAL) {
    return {
      verdict: 'reshape',
      code: 'kcal_floor',
      note: `Their stated intake target (${target}) is below ${MIN_DAILY_KCAL} kcal/day. Say plainly that you will not build a plan around eating that little and why — it is not a level to train or live on unsupervised — then offer to work toward the same result at a floor you can coach, and suggest a dietitian or doctor if they want to go lower.`,
    };
  }

  if (target != null && /sleep/.test(metric) && /h|hour/.test(metric) && target > 0 && target < MIN_SLEEP_HOURS) {
    return {
      verdict: 'reshape',
      code: 'sleep_floor',
      note: `They want to sleep ${target}h. Do not build a plan that cuts sleep — say plainly that sleep is what makes the rest of it work, and ask what they were trying to buy with the extra hours.`,
    };
  }

  // Weight-loss RATE, from where they are to where they want to be over the stated window.
  // Units are the trap here: the goal's own `start` is in the GOAL's unit (often lb) while the
  // baseline fallback is always kg, so each has to be converted on its own terms — treating a
  // kg baseline as pounds would under-report the rate by half and silently pass a crash diet.
  const goalToKg = /lb/.test(metric) ? 0.4536 : 1;
  const goalStart = num(g.measure?.start);
  const startKg = goalStart != null ? goalStart * goalToKg : (bodyWeightKg ?? null);
  const end = g.timeframe?.end ? Date.parse(g.timeframe.end) : NaN;
  const from = g.timeframe?.start ? Date.parse(g.timeframe.start) : Date.now();
  if (startKg != null && target != null && /weight|kg|lb/.test(metric) && Number.isFinite(end) && end > from) {
    const weeks = (end - from) / (7 * 24 * 3600 * 1000);
    const lossKg = startKg - target * goalToKg;
    if (weeks >= 0.5 && lossKg > 0 && lossKg / weeks > startKg * MAX_WEEKLY_LOSS_FRACTION) {
      const perWeek = (lossKg / weeks).toFixed(1);
      return {
        verdict: 'reshape',
        code: 'loss_rate',
        note: `That target works out to about ${perWeek} kg/week, faster than is safe or holdable. Do not just write it down — say what the honest rate is, and offer either a later date or a nearer target so the plan is one they can actually keep.`,
      };
    }
  }
  return null;
}

/**
 * Screen ONE goal. Pure — no I/O, so capture, Review, and tests all get the same answer.
 * `bodyWeightKg` (from the baseline) only sharpens the loss-rate check; omit it and that check
 * falls back to the goal's own start value.
 */
export function screenGoal(g: ScreenableGoal, bodyWeightKg?: number): GoalScreenResult {
  const text = `${g.title ?? ''} ${g.measure?.metric ?? ''} ${g.measure?.unit ?? ''}`.toLowerCase();

  const harm = has(text, HARM_TERMS);
  if (harm) {
    return {
      verdict: 'refuse',
      code: 'harm',
      note: 'This is not a goal to coach or record. Do not build a plan around it and do not argue about it. Say warmly and without flinching that you are glad they told you, that this is past what a coach should carry alone, and point them to a professional or someone they trust. Then stay with them — you are still here for the rest.',
    };
  }

  const substance = has(text, SUBSTANCE_TERMS);
  if (substance) {
    return {
      verdict: 'reshape',
      code: 'substance',
      note: 'This asks you to build a habit of using more of something. You do not do that. Say so plainly, without a lecture, and ask what it is doing for them — cutting down is a rhythm you can absolutely coach.',
    };
  }

  const doMyWork = has(text, DO_MY_WORK_TERMS);
  if (doMyWork) {
    return {
      verdict: 'reshape',
      code: 'out_of_scope',
      note: 'This asks you to do the work rather than coach the rhythm of doing it. Say plainly that you do not write the thing — but that the practice of sitting down to it is exactly your job, and offer that version. Offer once; if they only wanted the work done, let it go without repeating yourself.',
    };
  }

  return screenNumbers(g, bodyWeightKg) ?? { verdict: 'ok' };
}

/** Render the notes from a batch of screened goals as a context block for the coach. */
export function renderScreenNotes(results: Array<{ title: string; result: GoalScreenResult }>): string | null {
  const flagged = results.filter((r) => r.result.verdict !== 'ok' && r.result.note);
  if (!flagged.length) return null;
  return [
    '== RAISE THIS (deterministic screen — the app already applied it; your job is to say it out loud) ==',
    ...flagged.map((f) => `"${f.title}" [${f.result.verdict}] — ${f.result.note}`),
  ].join('\n');
}
