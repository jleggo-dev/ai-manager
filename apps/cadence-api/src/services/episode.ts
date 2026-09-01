import type { Activity, DisruptedEpisode, Equipment } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities, insertActivities } from '../repos/activities.ts';
import {
  getActiveEpisode,
  insertEpisode,
  endActiveEpisode,
  updateEpisodeEquipment,
  updateEpisodeStart,
  mergeEpisodeConstraints,
} from '../repos/episodes.ts';
import { getUser, setPendingProposal } from '../repos/users.ts';
import {
  pauseUserOccurrencesInWindow,
  restorePausedOccurrencesFrom,
  insertTempOccurrences,
  deleteFutureTempOccurrences,
  restorePausedOccurrencesOn,
  deleteTempOccurrencesOn,
} from '../repos/occurrences.ts';
import { normalizeTempActivity, computeTempOccurrenceDates } from './episode-overlay.ts';
import { prefetchImminentSessions } from './session-generate.ts';
import { runInBackground } from './background.ts';

const DAY = 86_400_000;
const DEFAULT_EPISODE_DAYS = 7;
const REBASELINE_GAP_DAYS = 7; // a detour this long → offer a coach re-baseline on the way out (Req 4)
const todayIso = (): string => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
};
const addDaysIso = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const daysBetweenIso = (a: string, b: string): number => {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0]!, pb[1]! - 1, pb[2]!) - Date.UTC(pa[0]!, pa[1]! - 1, pa[2]!)) / DAY);
};

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface EnterEpisodeInput {
  type: DisruptedEpisode['type'];
  /** Arrival date for a detour agreed in ADVANCE (owner, 2026-08-04). The plan pauses only from
   *  this date — agreeing on Monday to a Thursday trip must not shelve Tuesday's session. Past or
   *  absent → today. */
  start?: string;
  end?: string; // explicit end date; else start + days
  days?: number; // window length when `end` is omitted
  tone?: DisruptedEpisode['tone'];
  available_equipment?: Partial<Equipment>[];
  constraints?: Record<string, unknown>;
}

/**
 * Run the `disrupted_plan` job (AI Admin machinery — no hand-authored prompt) to draft the episode's
 * lighter "do what you can" activities from the episode + available equipment + base plan. Best-effort:
 * a job/parse failure returns [] so the episode still enters (base paused, guilt-free) with no options
 * rather than blocking the user from going into a detour.
 */
async function draftTempActivities(
  userId: string,
  episode: {
    type: string;
    start: string;
    end: string;
    available_equipment: Partial<Equipment>[];
    constraints: Record<string, unknown>;
  },
  baseActivities: Activity[],
): Promise<{ temp: Partial<Activity>[]; note: string }> {
  try {
    const res = await runJobBySlug(userId, 'disrupted-plan', {
      episode: JSON.stringify(episode),
      available_equipment: JSON.stringify(episode.available_equipment),
      base_plan: JSON.stringify(baseActivities.map((a) => ({ title: a.title, kind: a.kind, schedule: a.schedule }))),
      constraints: JSON.stringify(episode.constraints),
    });
    const out = parseJson(res.formatted ?? res.raw ?? '');
    const temp = (Array.isArray(out?.temp_activities) ? out!.temp_activities : [])
      .map(normalizeTempActivity)
      .filter((a): a is Partial<Activity> => a !== null);
    const note = typeof out?.note === 'string' ? out.note.trim() : '';
    return { temp, note };
  } catch (e) {
    console.error('[disrupted_plan]', e);
    return { temp: [], note: '' };
  }
}

/**
 * Enter a disrupted episode (Req 4): an ADDITIVE temporary overlay, not a plan rewrite. Pauses the
 * base plan's effortful (user) occurrences across the window so they can't become slips, and adds
 * the `disrupted_plan` job's lighter options as episode-tagged occurrences. The base plan is
 * untouched and resumes on `endEpisode`. Returns null when there's no committed plan to overlay;
 * returns the EXISTING active episode unchanged if one is already open (at most one at a time).
 */
export async function enterEpisode(
  userId: string,
  input: EnterEpisodeInput,
): Promise<{ episode: DisruptedEpisode; note: string } | null> {
  const existing = await getActiveEpisode(userId);
  if (existing) return { episode: existing, note: '' };

  const plan = await getActivePlan(userId);
  if (!plan) return null;

  const today = todayIso();
  const start = input.start && input.start > today ? input.start : today;
  const end = input.end ?? addDaysIso(start, input.days ?? DEFAULT_EPISODE_DAYS);
  const available_equipment = input.available_equipment ?? [];
  const constraints = input.constraints ?? {};

  const baseActivities = await listActivities(plan.plan_id);
  const { temp, note } = await draftTempActivities(
    userId,
    { type: input.type, start, end, available_equipment, constraints },
    baseActivities,
  );

  const episode = await insertEpisode(userId, {
    type: input.type,
    start,
    end,
    available_equipment,
    constraints,
    temp_activities: temp,
    tone: input.tone,
  });

  // Additive overlay: shelve base user work in the window, then materialize the temp options.
  await pauseUserOccurrencesInWindow(userId, start, end);
  if (temp.length) {
    const inserted = await insertActivities(userId, plan.plan_id, temp);
    const rows = inserted.flatMap((a) =>
      computeTempOccurrenceDates(a.schedule?.recurrence, start, end).map((date) => ({
        activity_id: a.activity_id,
        user_id: userId,
        date,
        episode_id: episode.episode_id,
      })),
    );
    await insertTempOccurrences(rows);
    // Detour sessions were the one cohort nobody warmed: commits kick the prefetch, but this path
    // inserted its temp occurrences and stopped, so every detour tap was a cold ~34s generation —
    // and a detour is exactly when the user is most likely to open tomorrow blind. The temp rows
    // are user-kind and pending, so the standard warm-up covers them. Never awaited: entering a
    // detour must not wait on a coach call.
    runInBackground('detour-warm', prefetchImminentSessions(userId));
  }

  return { episode, note };
}

/**
 * Revise the ACTIVE episode's equipment mid-window — the "I'll only know when I get there" case
 * (owner, 2026-08-04). A detour is entered when the schedule is known; the gear often isn't until
 * someone is standing in the hotel gym. When it lands — said to the coach, or parsed from a photo
 * — the remaining days get re-drafted around what is actually there. Days already lived stay as
 * honest history, the same rule `endEpisode` follows.
 *
 * The churn guard is deterministic and comes first: the conversational path re-reads a rolling
 * window every turn, so "the gym has dumbbells" would otherwise re-draft the week on every message
 * until the words scrolled out. Same names (case-insensitive, any order) → nothing happens.
 */
export async function reviseEpisodeEquipment(
  userId: string,
  equipment: Array<{ name: string }>,
): Promise<{ revised: boolean; reason: 'no_episode' | 'unchanged' | 'revised'; note?: string }> {
  const active = await getActiveEpisode(userId);
  if (!active) return { revised: false, reason: 'no_episode' };

  const names = (list: Array<{ name?: string }>) =>
    [...new Set(list.map((e) => (e.name ?? '').trim().toLowerCase()).filter(Boolean))].sort().join('|');
  if (names(equipment) === names(active.available_equipment ?? [])) return { revised: false, reason: 'unchanged' };

  const plan = await getActivePlan(userId);
  if (!plan) return { revised: false, reason: 'no_episode' };

  // Re-draft only what is still ahead: from today (or the start, if the window hasn't begun) to
  // the end. Future temp options are replaced; past ones are lived history and stay.
  const today = todayIso();
  const from = today > active.start ? today : active.start;
  const baseActivities = await listActivities(plan.plan_id);
  const { temp, note } = await draftTempActivities(
    userId,
    {
      type: active.type,
      start: from,
      end: active.end,
      available_equipment: equipment,
      constraints: active.constraints,
    },
    baseActivities,
  );

  await updateEpisodeEquipment(userId, active.episode_id, equipment, temp);
  // The arrival card keys off this: [] as an ANSWER ("no gym here") must read differently from
  // [] as silence, and equipment alone cannot carry that distinction.
  await mergeEpisodeConstraints(userId, active.episode_id, { gear_confirmed: true });
  await deleteFutureTempOccurrences(userId, active.episode_id, from);
  if (temp.length) {
    const inserted = await insertActivities(userId, plan.plan_id, temp);
    const rows = inserted.flatMap((a) =>
      computeTempOccurrenceDates(a.schedule?.recurrence, from, active.end).map((date) => ({
        activity_id: a.activity_id,
        user_id: userId,
        date,
        episode_id: active.episode_id,
      })),
    );
    await insertTempOccurrences(rows);
    // Same warm-up as enterEpisode: the replaced days are fresh cold rows, and the person standing
    // in the hotel gym is about to open one of them. Never awaited in the request path.
    runInBackground('detour-warm', prefetchImminentSessions(userId));
  }
  return { revised: true, reason: 'revised', note };
}

/**
 * Arrival day, but they haven't arrived — push the scheduled detour's start one day (owner,
 * 2026-08-04: "the application prompts me if I've arrived yet"). Targeted: the old first day's
 * base occurrences return to the plan, that day's temp options go, the end date stays put — a
 * late flight doesn't extend the trip. A push past the end cancels the whole detour instead:
 * a window with no days left isn't a detour.
 */
export async function postponeEpisodeStart(
  userId: string,
): Promise<{ postponed: boolean; cancelled?: boolean; start?: string }> {
  const active = await getActiveEpisode(userId);
  if (!active) return { postponed: false };
  const today = todayIso();
  // Only meaningful ON/AFTER the scheduled start — before it there is nothing to push.
  if (today < active.start) return { postponed: false };

  const newStart = addDaysIso(active.start, 1);
  if (newStart > active.end) {
    await endEpisode(userId);
    return { postponed: true, cancelled: true };
  }
  await restorePausedOccurrencesOn(userId, active.start);
  await deleteTempOccurrencesOn(userId, active.episode_id, active.start);
  await updateEpisodeStart(userId, active.episode_id, newStart);
  return { postponed: true, start: newStart };
}

/**
 * End the active episode: drop its future temp options, un-pause the base plan from today forward
 * (past paused days stay as honest history), and mark it ended. The base plan resumes untouched.
 */
export async function endEpisode(userId: string): Promise<{ ended: boolean; rebaselineSuggested?: boolean }> {
  const active = await getActiveEpisode(userId);
  if (!active) return { ended: false };
  const today = todayIso();
  await deleteFutureTempOccurrences(userId, active.episode_id, today);
  await restorePausedOccurrencesFrom(userId, today);
  await endActiveEpisode(userId, active.episode_id);

  // A long detour → the base plan may no longer fit where the user is now. Offer a coach
  // re-baseline (a fresh look) rather than silently resuming the old level. Only when nothing else
  // is already pending; it surfaces as the normal proposal banner on the next plan load.
  if (daysBetweenIso(active.start, today) >= REBASELINE_GAP_DAYS) {
    const user = await getUser(userId);
    if (!user?.pending_proposal) {
      await setPendingProposal(userId, {
        action: 'rebaseline',
        reason: "You were on a detour for a bit — want me to take a fresh look at where you're starting from now?",
        suggested_levers: [],
        created_at: new Date().toISOString(),
      });
      return { ended: true, rebaselineSuggested: true };
    }
  }
  return { ended: true };
}
