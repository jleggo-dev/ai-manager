import { runJobBySlug } from '../ai/aim.ts';
import type { CaptureExtractResult, Constraint, EquipmentCategory } from '@cadence/shared';
import { insertEquipment, listEquipment, updateEquipment } from '../repos/equipment.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import {
  getUser,
  mergeBaseline,
  mergeCapturedConstraints,
  setHomeLocation,
  setName,
  setTimezoneIfUnset,
} from '../repos/users.ts';
import { geocodeCity } from './weather/weather.ts';
import { logAi } from './ai-log.ts';
import { normalizeBaseline, normalizeTimezone } from './capture-normalize.ts';
import { extractCity } from './capture-location.ts';
import { persistCapturedGoals } from './capture-goals.ts';
import type { GoalScreenResult } from './goal-screen.ts';

const EQUIP_CATEGORIES: EquipmentCategory[] = [
  'footwear',
  'cardio',
  'strength',
  'accessory',
  'reading',
  'practice',
  'craft',
  'study',
  'other',
];

export interface CaptureResult extends CaptureExtractResult {
  persisted: { goals: number; equipment: number; baseline: boolean };
  /** Deterministic scope/safety screen verdicts — the caller injects the notes for the coach. */
  screened: Array<{ title: string; result: GoalScreenResult }>;
}

/**
 * Broker job `capture_extract` (spec §6.1, §C4) + persistence. Conversation window
 * in → flat top-level JSON out → captured records upserted (status 'captured').
 * The job's build-rule chain does the first contract pass; we re-validate here and
 * only persist rows that satisfy the DB CHECK constraints.
 */
export async function runCaptureExtract(
  userId: string,
  variables: { conversation_window: string },
): Promise<CaptureResult> {
  // The user's CURRENT goal cards, handed to the model so it re-uses their EXACT titles when
  // re-expressing a goal it already extracted. The lexical matcher downstream is the backstop;
  // this is the fix at the source — a real run produced "Run an Ultra Beast Spartan Race",
  // "Run a Spartan Ultra Beast" AND "Spartan Ultra Beast" as three cards, plus "Lose weight"
  // beside "Drop weight to improve race performance", which no synonym-free matcher can see
  // through. Best-effort: an empty list just means the model consolidates from conversation alone.
  const currentTitles = await listGoalsByStatus(userId, ['captured', 'confirmed', 'committed'])
    .then((gs) => gs.map((g) => g.title).filter(Boolean))
    .catch(() => [] as string[]);
  const result = await runJobBySlug(userId, 'capture-extract', {
    ...variables,
    current_goal_cards: JSON.stringify(currentTitles),
  });
  const text = result.formatted ?? result.raw ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('capture_extract did not return valid JSON');
  }

  const out: CaptureExtractResult = {
    goals: Array.isArray(parsed.goals) ? (parsed.goals as CaptureExtractResult['goals']) : [],
    equipment: Array.isArray(parsed.equipment) ? (parsed.equipment as CaptureExtractResult['equipment']) : [],
    baseline_updates:
      parsed.baseline_updates && typeof parsed.baseline_updates === 'object'
        ? (parsed.baseline_updates as CaptureExtractResult['baseline_updates'])
        : {},
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low',
  };

  // Persist the user's name (top-level, not baseline) when the Broker extracted it.
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (name) await setName(userId, name);

  // Goals are matched and merged against what the user already has, never replaced wholesale —
  // capture re-runs on the whole conversation every turn, so most of what comes back is the model
  // re-wording its own earlier extraction. See capture-goals.ts / capture-goal-merge.ts.
  const weightKg = Number((await getUser(userId))?.baseline?.weight_kg ?? NaN);
  const goalOutcome = await persistCapturedGoals(userId, out.goals, Number.isFinite(weightKg) ? weightKg : undefined);
  const coerced = goalOutcome.coerced;
  const screened: CaptureResult['screened'] = goalOutcome.screened;
  const goals = goalOutcome.persisted;

  /**
   * Equipment MERGES. It used to replace, and it silently ate nineteen items down to one.
   *
   * The old rule was "replace the set when capture returned any", guarded only against an EMPTY
   * capture. One extraction was enough: on 2026-08-17 a conversation about dead hangs mentioned a
   * pull-up bar, capture returned that single item, and the delete took the treadmill, the rowing
   * machine, both bikes, the kettlebell set, the TRX and everything else with it. Owner: *"I had a
   * ton of equipment listed in Cadence, but it looks like it disappeared somehow."*
   *
   * This is the SAME bug, in the same function, as the constraints one described immediately below
   * — capture runs over the whole conversation every turn, so anything it "replaces" is replaced by
   * whatever today happened to mention. Constraints were moved to a merge and equipment was left
   * behind. Rule 1 of constraint-merge.ts applies here word for word: **nothing is ever dropped by
   * silence.** A rowing machine you did not mention today is still in your garage.
   *
   * Removal stays an explicit act and belongs to the review wizard, which still deletes wholesale
   * on purpose — when someone rejects a row there, they mean it.
   *
   * Matched case-insensitively on name, which is how the same item restated ("Treadmill" after
   * "treadmill") updates in place instead of arriving as a twin. Unknown categories are coerced to
   * 'other', never dropped.
   */
  const namedEquip = out.equipment.filter((e) => e.name);
  let equipment = 0;
  if (namedEquip.length) {
    const existing = await listEquipment(userId);
    const known = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e]));
    for (const e of namedEquip) {
      let category = e.category;
      if (!category || !EQUIP_CATEGORIES.includes(category)) {
        coerced.push(`equipment category "${String(e.category ?? '(empty)')}" → other`);
        category = 'other';
      }
      const match = known.get(String(e.name).trim().toLowerCase());
      if (match) {
        // The newest telling wins the details, as with constraints — but the row survives.
        await updateEquipment(userId, match.equipment_id, { ...e, category });
      } else {
        await insertEquipment(userId, { ...e, category });
      }
      equipment++;
    }
  }

  let baseline = false;
  const normBaseline = normalizeBaseline((out.baseline_updates ?? {}) as Record<string, unknown>);
  // Constraints leave the wholesale patch and go through their own MERGE. `mergeBaseline` is a
  // shallow jsonb merge, so including them here replaced the entire stored list with whatever
  // this one conversation happened to mention — silently deleting a knee recorded weeks ago. See
  // constraint-merge.ts; Settings still replaces wholesale, because a delete there is deliberate.
  const { constraints: capturedConstraints, ...restBaseline } = normBaseline as Record<string, unknown> & {
    constraints?: Constraint[];
  };

  /**
   * A weight said in chat updates where they ARE, never where they STARTED.
   *
   * Same shallow-merge trap as the constraints above, and the more expensive one. `normalizeBaseline`
   * has to emit a whole `weight_kg` record, so it fills `start` with the only number it has — the
   * one just spoken. `mergeBaseline` is a shallow jsonb merge, so that record REPLACES the stored
   * one wholesale. Net effect before this: say "I'm 85 now" three months in and the 88.5 you began
   * at is gone, every progress read silently rebases to zero, and the adaptive targets that key off
   * actual weekly rate lose the series they reason from.
   *
   * `weigh-in.ts` has always merged this correctly for the weekly check-in ("update current WITHOUT
   * clobbering .start"); the chat path never got the same care. Preserve the earliest `start` we
   * have — capture may run many times over one conversation, and only the first can be a beginning.
   */
  const spokenWeight = restBaseline.weight_kg as { current?: number; start?: number } | undefined;
  if (spokenWeight && typeof spokenWeight.current === 'number') {
    const priorStart = (await getUser(userId))?.baseline?.weight_kg?.start;
    if (typeof priorStart === 'number') {
      restBaseline.weight_kg = { ...spokenWeight, start: priorStart };
    }
  }

  if (Object.keys(restBaseline).length > 0) {
    await mergeBaseline(userId, restBaseline as unknown as Parameters<typeof mergeBaseline>[1]);
    baseline = true;
  }
  if (capturedConstraints?.length) {
    await mergeCapturedConstraints(userId, capturedConstraints);
    baseline = true;
  }

  // The timezone they stated, when we don't already have one. Separate from — and independent of
  // — the home-location branch below: "I'm in Quebec, so Eastern time" fixes their timezone
  // without naming a city we can geocode, and until now that sentence went nowhere while
  // date-context, the daily check-in and every notification schedule ran on a default. Never
  // overrides an existing zone (the repo guards that), never inferred from language or locale.
  const statedTz = normalizeTimezone(parsed.timezone);
  if (statedTz) await setTimezoneIfUnset(userId, statedTz);

  // Home location the Broker heard — so weather can default from what they told the coach, not a
  // second ask. Geocode the stated city via OWM → coarse coords, and set it ONLY when the user hasn't
  // already chosen a place in Settings (never override an explicit choice). Best-effort: a geocode
  // miss (or an unconfigured weather key) is swallowed — it never fails the capture.
  const statedCity = extractCity(parsed.location);
  if (statedCity) {
    try {
      const user = await getUser(userId);
      if (!user?.home_location) {
        const geo = await geocodeCity(statedCity);
        if (geo)
          await setHomeLocation(userId, { lat: geo.lat, lon: geo.lon, label: geo.label }, user?.timezone ?? null);
      }
    } catch (e) {
      console.warn('[capture] home-location geocode failed (non-fatal):', e);
    }
  }

  const persisted = { goals, equipment, baseline };
  if (coerced.length) console.warn('[capture] coerced out-of-enum values:', coerced.join(' | '));
  const flagged = screened.filter((s) => s.result.verdict !== 'ok');
  if (flagged.length) console.warn('[capture] goal screen fired:', flagged.map((f) => f.result.code).join(', '));
  await logAi(userId, {
    kind: 'capture',
    input: { window: variables.conversation_window },
    output: { raw: text, parsed: out },
    meta: {
      persisted,
      confidence: out.confidence,
      ...(coerced.length ? { coerced } : {}),
      ...(flagged.length ? { screened: flagged } : {}),
    },
  });
  return { ...out, persisted, screened };
}
