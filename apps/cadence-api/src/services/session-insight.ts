import { RPE_CHIPS, SKIP_REASON_CHIPS, FELT_STATE_CHIPS } from '@cadence/shared';
import { lastFeedbackForActivity } from '../repos/coach-moments.ts';
import { listRecentLogsByTitle } from '../repos/occurrences.ts';

/**
 * The pre-activity insight — the "Cadence noticed" slot on the start sheet.
 *
 * Three rules, and the third is the one that matters:
 *
 *  1. AT MOST ONE. Two observations is a briefing, and nobody reads a briefing before a run.
 *  2. NO INSIGHT, NO CARD. Returning null is the common case and is completely fine; a slot that
 *     always has something in it trains people to stop reading it.
 *  3. **Only ever restate something already recorded.** Every line below is a read-back of the
 *     user's own last answer or their own last log. Nothing is inferred, averaged, or compared
 *     against a target Cadence cannot actually measure.
 *
 * That third rule is why this does not produce the design's example line ("yesterday's run
 * averaged 5:40/km — that's Zone 3, not Zone 2"). Cadence has no pace or heart-rate telemetry to
 * derive it from, and a coach who invents a number they didn't measure is worse than a coach who
 * says nothing. When per-session telemetry lands, that comparison becomes a fourth source here —
 * ranked above the rest, because measured beats remembered.
 */

export interface SessionInsight {
  /** One sentence, in Cadence's voice. Rendered verbatim under the "CADENCE NOTICED" label. */
  text: string;
  /** Where it came from — so a reader of the logs can tell a read-back from an inference. */
  source: 'last_feedback' | 'last_log';
}

/** Did the user cut this activity short last time? Reads the log's own step accounting. */
function trimmedLastTime(log: { items?: { done?: boolean }[]; summary?: string } | null): boolean {
  if (!log) return false;
  const items = log.items ?? [];
  if (items.length > 0 && items.some((i) => i.done === false)) return true;
  // recapSummary() writes "· N steps left" when the walkthrough finished with untouched steps.
  return /\b\d+ steps? left\b/.test(log.summary ?? '');
}

export async function getSessionInsight(
  userId: string,
  activity: { activity_id: string; title: string },
): Promise<SessionInsight | null> {
  // 1 — What they told us last time about THIS activity. The strongest signal we have, because
  // they chose it themselves rather than us reading it off a sensor.
  const fb = await lastFeedbackForActivity(userId, activity.activity_id).catch(() => null);
  if (fb) {
    if (fb.reason_code) {
      const chip = SKIP_REASON_CHIPS.find((c) => c.code === fb.reason_code);
      if (chip) {
        return {
          source: 'last_feedback',
          text: `Last time you stopped early — "${chip.label.toLowerCase()}". No pressure to make it up today.`,
        };
      }
    }
    if (fb.rpe && fb.rpe !== 'just_right') {
      const chip = RPE_CHIPS.find((c) => c.code === fb.rpe);
      if (chip) {
        return {
          source: 'last_feedback',
          text:
            fb.rpe === 'too_hard'
              ? 'Last time you marked this one too hard.'
              : 'Last time you marked this one too easy.',
        };
      }
    }
    if (fb.felt_state === 'more_wound_up') {
      const chip = FELT_STATE_CHIPS.find((c) => c.code === 'more_wound_up');
      if (chip) {
        return {
          source: 'last_feedback',
          text: 'Last time this left you more wound up. Shorter is fine today — stop whenever you want.',
        };
      }
    }
  }

  // 2 — What the log itself shows. Weaker, but it is still their own record rather than a guess.
  const recent = await listRecentLogsByTitle(userId, activity.title, 1).catch(() => []);
  if (trimmedLastTime(recent[0]?.log ?? null)) {
    return {
      source: 'last_log',
      text: "You cut this one short last time. If today's tight too, say so and we'll trim it on purpose.",
    };
  }

  // 3 — Nothing worth saying. This is the normal answer.
  return null;
}
