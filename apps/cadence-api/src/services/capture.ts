import { runJobBySlug } from '../ai/aim.ts';
import type { CaptureExtractResult, EquipmentCategory } from '@cadence/shared';
import { insertEquipment, deleteAllEquipment } from '../repos/equipment.ts';
import { getUser, mergeBaseline, setHomeLocation, setName, setTimezoneIfUnset } from '../repos/users.ts';
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
  const result = await runJobBySlug(userId, 'capture-extract', variables);
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

  // Equipment has no confirm status pre-lock; replace the set when capture returned any (an
  // empty capture leaves existing equipment untouched so we don't wipe on a sparse turn).
  // Unknown categories are coerced to 'other', never dropped.
  const namedEquip = out.equipment.filter((e) => e.name);
  let equipment = 0;
  if (namedEquip.length) {
    await deleteAllEquipment(userId);
    for (const e of namedEquip) {
      let category = e.category;
      if (!category || !EQUIP_CATEGORIES.includes(category)) {
        coerced.push(`equipment category "${String(e.category ?? '(empty)')}" → other`);
        category = 'other';
      }
      await insertEquipment(userId, { ...e, category });
      equipment++;
    }
  }

  let baseline = false;
  const normBaseline = normalizeBaseline((out.baseline_updates ?? {}) as Record<string, unknown>);
  if (Object.keys(normBaseline).length > 0) {
    await mergeBaseline(userId, normBaseline as unknown as Parameters<typeof mergeBaseline>[1]);
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
