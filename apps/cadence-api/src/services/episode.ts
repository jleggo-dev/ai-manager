import type { Activity, DisruptedEpisode, Equipment } from '@cadence/shared';
import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities, insertActivities } from '../repos/activities.ts';
import { getActiveEpisode, insertEpisode, endActiveEpisode } from '../repos/episodes.ts';
import { getUser, setPendingProposal } from '../repos/users.ts';
import {
  pauseUserOccurrencesInWindow,
  restorePausedOccurrencesFrom,
  insertTempOccurrences,
  deleteFutureTempOccurrences,
} from '../repos/occurrences.ts';
import { normalizeTempActivity, computeTempOccurrenceDates } from './episode-overlay.ts';

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
    const res = await runJob(userId, cadenceConfig.aim.jobs.disruptedPlan, {
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

  const start = todayIso();
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
  }

  return { episode, note };
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
