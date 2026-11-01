import { runJobBySlug } from '../ai/aim.ts';
import { getUser } from '../repos/users.ts';
import { listEquipment } from '../repos/equipment.ts';
import { listGoals } from '../repos/goals.ts';
import { listEpisodeRanges } from '../repos/episodes.ts';
import { listOpenFollowUps, noteFollowUp } from '../repos/follow-ups.ts';
import { buildReviewDossier, renderDossier, shiftDay, type ReviewFact } from './fact-review-dossier.ts';
import { checkFindings, selectFindings, storedEvidence, type DroppedCounts } from './fact-review-findings.ts';

/**
 * The weekly fact review (HARNESS-V3 C7): find the facts in someone's file that disagree, and turn
 * each into a question for the coach — never into an edit.
 *
 * The dossier grows for months and starts to contradict itself ("has a gym membership" beside a
 * later "the gym closed"). Capture merges at write time and never drops anything by silence, which
 * is right, and it means nothing ever notices that two true-sounding facts cannot both be true.
 * This does: it reads one person's facts, hands them to the `fact-review` job, checks what comes
 * back (evidence required — fact-review-findings.ts), and writes each surviving finding as a
 * follow-up with `source: 'fact-review'` (0062). The coach sees it in her list of things to come
 * back to and raises it in her own words when it fits; the person's answer goes through capture or
 * Settings like anything else they tell her.
 *
 * **It writes nothing to any fact.** Its only write is `noteFollowUp`, and
 * fact-review-no-write.test.ts reads this file's imports and fails on anything else that writes.
 * Allergies and dietary choices are not even read (see fact-review-dossier.ts).
 *
 * Bounded so one bad run cannot crowd her context: at most MAX_FINDINGS_PER_RUN per run, and never
 * more than MAX_OPEN_FACT_REVIEWS of its questions open at once. A question already open is not
 * asked again — the job is told which are open, and an exact repeat is skipped here as well.
 *
 * When it runs is fact-review-trigger.ts's business, not this file's.
 */

export const FACT_REVIEW_JOB = 'fact-review';
/** Findings one run may add. */
export const MAX_FINDINGS_PER_RUN = 3;
/** Fact-review questions open at once, across weeks. Her follow-up list shows eight; these never take more than three. */
export const MAX_OPEN_FACT_REVIEWS = 3;
/** Detours read: the past year, and the next three months (a trip already booked can overtake a fact too). */
const DETOUR_LOOKBACK_DAYS = 365;
const DETOUR_LOOKAHEAD_DAYS = 90;
/** Enough to see every open follow-up of anyone real; only the fact-review ones are used. */
const OPEN_READ_LIMIT = 50;

export type FactReviewReason =
  /** The trigger had no recap week to claim. */
  | 'no_week'
  /** This week (or one within the cadence's gap) was already reviewed. */
  | 'already_reviewed'
  /** Fewer than two facts on file — nothing can disagree. No model call. */
  | 'too_few_facts'
  /** Its open questions are already at the ceiling. No model call. */
  | 'no_room'
  /** The job answered with something that is not a findings list. */
  | 'unreadable'
  | 'reviewed'
  /** Something threw; logged, and the check-in it rode on is unaffected. */
  | 'failed';

export interface FactReviewOutcome {
  /** Whether the job was called. */
  ran: boolean;
  reason: FactReviewReason;
  facts: number;
  /** Findings that passed the checks. */
  found: number;
  written: number;
  already_open: number;
  over_cap: number;
  dropped: DroppedCounts;
}

export function emptyOutcome(reason: FactReviewReason, facts = 0): FactReviewOutcome {
  return {
    ran: false,
    reason,
    facts,
    found: 0,
    written: 0,
    already_open: 0,
    over_cap: 0,
    dropped: { no_evidence: 0, unknown_fact: 0, bad_shape: 0, repeated: 0 },
  };
}

/** One person's facts, from the repos capture and the dedup script already read. Reads only. */
export async function gatherReviewFacts(userId: string, today: string): Promise<ReviewFact[]> {
  const [user, equipment, goals, detours] = await Promise.all([
    getUser(userId),
    listEquipment(userId),
    listGoals(userId),
    listEpisodeRanges(userId, shiftDay(today, -DETOUR_LOOKBACK_DAYS), shiftDay(today, DETOUR_LOOKAHEAD_DAYS)),
  ]);
  const baseline = user?.baseline;
  return buildReviewDossier({
    constraints: Array.isArray(baseline?.constraints) ? baseline.constraints : [],
    doingNow: Array.isArray(baseline?.starting_point?.doing_now) ? baseline.starting_point.doing_now : [],
    equipment,
    goals,
    detours,
    today,
  });
}

/** The open questions, as the job reads them — so it does not find the same thing again. */
export function renderAlreadyAsked(questions: string[]): string {
  return questions.length ? questions.map((q) => `- ${q}`).join('\n') : '(none)';
}

/** Review one person's facts now. Throws on a failed read or job; the trigger catches. */
export async function runFactReview(
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<FactReviewOutcome> {
  const [facts, open] = await Promise.all([
    gatherReviewFacts(userId, today),
    listOpenFollowUps(userId, OPEN_READ_LIMIT),
  ]);
  const openQuestions = open.filter((f) => f.source === 'fact-review').map((f) => f.text);
  if (facts.length < 2) return emptyOutcome('too_few_facts', facts.length);
  const room = Math.min(MAX_FINDINGS_PER_RUN, MAX_OPEN_FACT_REVIEWS - openQuestions.length);
  if (room <= 0) return emptyOutcome('no_room', facts.length);

  const res = await runJobBySlug(userId, FACT_REVIEW_JOB, {
    facts: renderDossier(facts),
    already_asked: renderAlreadyAsked(openQuestions),
  });
  const checked = checkFindings(res.formatted ?? res.raw ?? '', facts);
  const picked = selectFindings(checked.findings, openQuestions, room);
  for (const finding of picked.write) {
    await noteFollowUp(userId, {
      text: finding.question,
      source: 'fact-review',
      evidence: storedEvidence(finding, facts),
    });
  }
  return {
    ran: true,
    reason: checked.parsed ? 'reviewed' : 'unreadable',
    facts: facts.length,
    found: checked.findings.length,
    written: picked.write.length,
    already_open: picked.already_open,
    over_cap: picked.over_cap,
    dropped: checked.dropped,
  };
}
