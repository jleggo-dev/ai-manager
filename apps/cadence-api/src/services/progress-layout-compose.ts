/**
 * The Progress Engine's composition orchestrator (Wave 3 — "the progress talk",
 * docs/cadence/PROGRESS-ENGINE.md). Builds the `progress-layout-compose` job's input, runs it
 * through AI Admin (never a direct provider call), validates the result deterministically
 * (progress-layout-validate.ts — the model's shape is never trusted beyond the schema), and only
 * on success writes it as a draft (`insertDraft`) for the user to see and confirm.
 *
 * Orchestration only: the catalog, the availability summary, and the validator each earned their
 * own file (CLAUDE.md — "a distinct responsibility gets its own file from day one"), so this one
 * stays small and reads as the sequence it is.
 */
import type { ProgressLayout } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getCommitted, insertDraft } from '../repos/progress-layouts.ts';
import { defaultLayout } from './progress-layout.ts';
import { widgetCatalog } from './progress-layout-catalog.ts';
import { buildAvailability } from './progress-layout-availability.ts';
import { validateComposedLayout } from './progress-layout-validate.ts';
import { logAi } from './ai-log.ts';

export type ComposeProgressLayoutResult =
  { ok: true; draft_id: string; layout: ProgressLayout } | { ok: false; reasons: string[] };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The goal fields the job actually needs, in prompt-stable shape — never the full `Goal` row
 * (constraints, timestamps, internal ids the model has no use for and the description-audit
 * discipline would flag as noise if they leaked into a coach-facing surface).
 */
function goalsForPrompt(goals: Awaited<ReturnType<typeof listGoalsByStatus>>) {
  return goals.map((g) => ({
    goal_id: g.goal_id,
    title: g.title,
    area: g.area,
    type: g.type,
    measure: g.measure ?? null,
  }));
}

/**
 * `whatTheyWant` is the coach's own compact summary of what the user said progress means to them
 * (the action's `what_they_want` param) — never re-derived here, because SHE heard the actual
 * words and this call trusts her read of them, the same trust `log_session`'s `report` field asks
 * for on the user's own words.
 */
export async function composeProgressLayout(
  userId: string,
  whatTheyWant: string,
): Promise<ComposeProgressLayoutResult> {
  const goals = await listGoalsByStatus(userId, ['confirmed', 'committed']);
  const [committed, availability] = await Promise.all([getCommitted(userId), buildAvailability(userId)]);
  const currentLayout = committed?.layout ?? defaultLayout(goals);
  const goalIds = goals.map((g) => g.goal_id);

  const res = await runJobBySlug(userId, 'progress-layout-compose', {
    what_they_want: whatTheyWant,
    goals: JSON.stringify(goalsForPrompt(goals)),
    current_layout: JSON.stringify(currentLayout),
    availability: JSON.stringify(availability),
    catalog: JSON.stringify(widgetCatalog()),
  });

  const raw = parseJson(res.formatted ?? res.raw ?? '');
  const result = validateComposedLayout(raw, { availability, goalIds });

  // Best-effort audit trail (logAi never throws) — kept even on rejection: a run that fails
  // validation is exactly the case worth being able to look back at.
  void logAi(userId, {
    kind: 'progress_layout_compose',
    input: { what_they_want: whatTheyWant, goal_count: goals.length },
    output: result.ok ? result.layout : { rejected: result.reasons },
    meta: { ok: result.ok },
  });

  if (!result.ok) return { ok: false, reasons: result.reasons };

  const row = await insertDraft(userId, result.layout);
  return { ok: true, draft_id: row.id, layout: row.layout };
}
