import { injectCoachContext } from '../ai/aim.ts';
import { getUser } from '../repos/users.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { classifyFoodIntent, FOOD_CONFIRM_CONTEXT } from './coach-food-classify.ts';
import { injectTurnContext } from './turn-context.ts';
import { startingPointGaps } from './intake.ts';

/**
 * Coach context assembly (spec §4.1 role 3, §4.3) — INTENT-AWARE.
 *
 * Division of labor: ALL coaching prompt content — persona, tone, safety, AND the
 * per-intent behavior guides — lives in AI Admin (the `cadence-coach-chat` job's
 * `config.systemPrompt`, editable in Build Rules; seed:
 * config/ai-admin/cadence-coach.system-prompt.md). This module emits no coaching prose:
 * it only states the session's intent *label* and the data (the context pack). The
 * persona reads the "SESSION INTENT" label and behaves accordingly. The UI's "pre-baked
 * buttons" map to these intents/topics.
 */
export type CoachIntent = 'onboarding' | 'initial' | 'ongoing' | 'disrupted';
// Goal-domain-driven topics (was fitness-locked nutrition|training|recipes). The area values
// mirror GoalArea so a session can be scoped to any life area; 'goal' and 'struggles' are the
// domain-neutral general threads.
export type CoachTopic = 'movement' | 'nourishment' | 'mind' | 'practice' | 'goal' | 'struggles';

/**
 * Deterministic onboarding checklist: what's captured vs. still needed before planning.
 * AREA-CONDITIONAL — intake is a function of the goal, not a fixed form: body metrics
 * (weight/height) are only "needed" when a movement/nourishment goal or a numeric body
 * target exists. A journaling or meditation user is never chased for their weight.
 */
export async function onboardingReadiness(userId: string): Promise<string> {
  const [user, goals, equipment] = await Promise.all([
    getUser(userId),
    listGoalsByStatus(userId, ['captured', 'confirmed', 'committed']),
    listEquipment(userId),
  ]);
  const b = (user?.baseline ?? {}) as {
    age?: number;
    height_cm?: number;
    weight_kg?: unknown;
    constraints?: unknown[];
  };
  const bodyRelevant = goals.some(
    (g) =>
      g.area === 'movement' ||
      g.area === 'nourishment' ||
      /\b(kg|lbs?|weight)\b/i.test(String(g.measure?.unit ?? g.measure?.metric ?? '')),
  );
  const have: string[] = [];
  const need: string[] = [];

  (goals.length ? have : need).push(`goals (${goals.length})`);

  // Itemize the baseline instead of treating it as all-or-nothing. The old check counted the
  // baseline as "captured" the moment ANY field existed — so once constraints were captured, the
  // coach stopped chasing age/height/weight and off-ramped to Review with intake half-done.
  (b.age != null ? have : need).push('age');
  if (bodyRelevant) {
    (b.height_cm != null ? have : need).push('height');
    (b.weight_kg != null ? have : need).push('current weight');
  }
  const consCount = Array.isArray(b.constraints) ? b.constraints.length : 0;
  (consCount ? have : need).push(
    consCount ? `${consCount} thing(s) to work around` : 'anything to work around (injury/life)',
  );
  (equipment.length ? have : need).push(`equipment (${equipment.length})`);
  (user?.home_location ? have : need).push('home location + timezone');

  // Goal-specific intake (deterministic): a target goal without a starting point is an open
  // "where are you now?" — the question a real coach asks before prescribing anything.
  const gaps = startingPointGaps(goals);
  for (const gap of gaps) need.push(`where they are today on "${gap.title}" (their current ${gap.metric})`);

  return [
    `Captured so far: ${have.join(', ') || 'nothing yet'}.`,
    `Still to gather before planning: ${need.join(', ') || 'nothing — ready to review and set their rhythm'}.`,
    bodyRelevant
      ? 'This goal is body-related, so age, height, and current weight matter for a safe, realistic plan — gather the missing ones (one at a time) before pointing them to Review.'
      : 'This goal does not need body metrics — do not ask for weight or height unless the user brings them up.',
    ...(gaps.length
      ? [
          'For each numeric goal, a coach’s first question is where they are today — ask for the missing starting point in their own words (one at a time, never as a form).',
        ]
      : []),
  ].join('\n');
}

/**
 * The session-intent LABEL only — data, not prompt. The persona (in AI Admin) reads this
 * line and supplies the actual per-intent behavior; we never restate coaching prose here.
 */
export function intentFraming(intent: CoachIntent, topic?: CoachTopic): string {
  return `== SESSION INTENT: ${intent}${topic ? ` / ${topic}` : ''} ==`;
}

/**
 * Per-turn just-in-time injection hook (spec §4.3). Runs the Broker `context_select` pass for THIS
 * turn and injects any fetched records as a non-triggering `<context>` turn (see `injectTurnContext`),
 * so the coach sees fresh, turn-relevant data instead of only the session-open snapshot. The user's
 * message is always returned UNCHANGED — the retrieval is a side-effect on the session, never mixed
 * into the user's turn. Best-effort: a retrieval failure never blocks the message.
 */
export async function assembleTurn(userId: string, sessionId: string, message: string): Promise<string> {
  await injectTurnContext(userId, sessionId, message).catch((e) => console.error('[assembleTurn]', e));
  // Req 5 coach food surface: confirm-before-commit — remind the model not to claim a log/save.
  if (classifyFoodIntent(message)) {
    await injectCoachContext(userId, sessionId, FOOD_CONFIRM_CONTEXT, {
      source: 'food-confirm',
      version: 1,
    }).catch((e) => console.error('[assembleTurn food-confirm]', e));
  }
  return message;
}
