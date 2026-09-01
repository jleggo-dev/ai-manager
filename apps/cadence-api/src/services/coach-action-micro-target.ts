import {
  MICRONUTRIENT_KEYS,
  microTargetRange,
  resolveMicronutrientTargets,
  sanitizeMicroTargetAmount,
  type MicronutrientKey,
} from '@cadence/shared';
import { getUser, setMacroTargets } from '../repos/users.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `set_micro_target` — the one thing allowed to override a published reference intake.
 *
 * Owner ruling, 2026-09-01, on the back of adding CNF to the trusted micro sources: *"we rely on
 * CNF, but we allow the coach to modify/override it if needed — ex. a user says 'my doctor wants
 * me to get 2000mg of Vitamin C a day'"*. The reference table stays a lookup, because "you need
 * 18mg of iron" is a fact about human biology rather than a judgement about this person. What it
 * cannot know is that this person was told something else by someone who examined them, and a
 * coach who kept coaching to 90mg of vitamin C after hearing "my doctor said 2,000" is ignoring
 * the most authoritative thing in the conversation.
 *
 * So the tool records a number she was TOLD; it never lets her reason one out. That distinction is
 * carried by `why` being required and by the description saying it in as many words — the
 * override's entire claim to authority is where it came from, and one with no attribution is
 * exactly the invented number the reference table exists to prevent.
 *
 * TAIL TIER, deliberately. It changes data, but a doctor's instruction arrives once and then holds
 * for months, which is the "changes data, weekly or rarer" row of the harness checklist — an
 * always-on slot would cost 300+ tokens on every message forever for something most people never
 * do. `DRAWER_HOOKS` carries its line so she can find it.
 *
 * The safe window is enforced twice on purpose: here, so a refusal can explain itself in her
 * words, and again in `resolveMicronutrientTargets` at read time, so a blob written by any other
 * path cannot get a dose past the check by going around this file.
 */

const KEYS = MICRONUTRIENT_KEYS as readonly MicronutrientKey[];

const isKey = (v: unknown): v is MicronutrientKey => KEYS.includes(v as MicronutrientKey);

/** "iron_mg, zinc_mg, …" — what to say back when she names something that isn't one. */
const KEY_LIST = KEYS.join(', ');

export const SET_MICRO_TARGET: CoachActionTool = {
  name: 'set_micro_target',
  description:
    'Record a daily micronutrient target this person was given OUTSIDE the app — a doctor, a prescription, a blood result. Takes effect immediately and stands in for the published reference intake for that one nutrient, in every later read. Use only when they report a number someone gave them: the reference intakes already apply to everybody, so never set one from your own reasoning, and never to make a nutrient easier to hit. Pass {"nutrient": "vitamin_c_mg", "amount": 2000, "why": "her doctor asked for 2000mg a day"}. Omit amount to remove an override and go back to the published figure. An amount outside the published safe range for that nutrient is refused and nothing changes.',
  parameters: {
    properties: {
      nutrient: {
        type: 'string',
        enum: [...KEYS],
        description: 'Which nutrient. sodium_mg is a limit to stay under; every other one is an amount to reach.',
      },
      amount: {
        type: 'number',
        description: "The daily number, in the nutrient's own unit (mg, g, or µg for B12). Omit to clear.",
      },
      why: {
        type: 'string',
        description: 'Who gave them this number and for what. Required — an override with no source is a guess.',
      },
    },
    required: ['nutrient', 'why'],
  },
  async run(userId, params) {
    const nutrient = params.nutrient;
    if (!isKey(nutrient)) {
      return `"${String(nutrient ?? '')}" is not a nutrient this tracks, so nothing changed. The ones with reference intakes are: ${KEY_LIST}.`;
    }

    const why = String(params.why ?? '').trim();
    if (!why) {
      return 'No source was given, so nothing changed. An override only counts because of who said it — ask where the number came from, then set it.';
    }

    const user = await getUser(userId);
    const targets = user?.macro_targets ?? {};
    const current = { ...(targets.micro_targets ?? {}) };
    const clearing = params.amount === undefined || params.amount === null;

    if (clearing) {
      if (!current[nutrient]) {
        return `There was no override on ${nutrient} to remove — they are already coached against the published reference intake for it. Nothing changed.`;
      }
      delete current[nutrient];
    } else {
      const amount = sanitizeMicroTargetAmount(nutrient, params.amount);
      if (amount === null) {
        const range = microTargetRange(nutrient);
        return `${String(params.amount)} is outside the safe daily range for ${nutrient}${range ? ` (${range[0]}–${range[1]})` : ''}, so nothing was changed. Do not set it. Say the number back to them and ask them to check it with whoever gave it.`;
      }
      current[nutrient] = { amount, why, set_at: new Date().toISOString().slice(0, 10) };
    }

    await setMacroTargets(userId, { ...targets, micro_targets: current });

    // Verified against a FRESH read, never against the write's intent — same contract as
    // update_equipment: a tool that reports what it meant to do is how a file ends up disagreeing
    // with what the coach told someone.
    const after = await getUser(userId);
    const resolved = resolveMicronutrientTargets(
      { sex: after?.baseline?.sex ?? null, age: after?.baseline?.age ?? null },
      after?.macro_targets?.micro_targets ?? null,
    ).find((t) => t.key === nutrient);

    if (!resolved) {
      return `Could not read ${nutrient} back after that write. Do not tell them it is set; say you could not save it just now.`;
    }

    if (clearing) {
      if (resolved.origin === 'override') {
        return `The override on ${nutrient} is STILL on their file — the removal did not take. Do not say it is cleared; say you could not change it just now.`;
      }
      await insertGoalEvent(userId, {
        kind: 'note',
        label:
          `${resolved.label} target back to the reference ${String(resolved.amount)}${resolved.unit}: ${why}`.slice(
            0,
            200,
          ),
      }).catch(() => null);
      return `Cleared — ${resolved.label} is back to the published ${String(resolved.amount)}${resolved.unit} a day. Say it back in one line so they know what they are being coached to now.`;
    }

    if (resolved.origin !== 'override') {
      return `${nutrient} did NOT take the new number — their file still reads the published figure. Do not say it is set; say you could not save it just now.`;
    }

    await insertGoalEvent(userId, {
      kind: 'note',
      label: `${resolved.label} target set to ${String(resolved.amount)}${resolved.unit} a day: ${why}`.slice(0, 200),
    }).catch(() => null);

    const direction = resolved.direction === 'ceiling' ? 'to stay under' : 'to reach';
    return `On file and verified: ${resolved.label} ${direction} ${String(resolved.amount)}${resolved.unit} a day, standing in for the published reference intake. Say it back in one short line so they can correct you, then carry on.`;
  },
};
