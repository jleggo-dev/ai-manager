import { listGoals } from '../repos/goals.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { listRepertoire, upsertRepertoireItem } from '../repos/repertoire.ts';
import { matchActivity } from './plan-edit.ts';
import type { CoachActionTool } from './coach-action-types.ts';
import type { RepertoireStatus } from '@cadence/shared';

/**
 * `update_repertoire` — write down what they are learning and what they already know.
 *
 * Born from the 2026-08-29 piano conversation: asked to "select from the pieces I already know",
 * the coach had nowhere to look, asked the user to type nine pieces, and then had nowhere to put
 * them — they froze into one plan sentence that could never rotate or be read back. Owner ruling
 * 2026-08-30: recording repertoire is proactive — when the user names material they know, are
 * working on, or just learned, storing it is not optional.
 *
 * The status verbs: `working` (learning it now), `known` (already have it — backfill, no
 * anniversary invented), `learned` (crossed the line just now → stored as known + stamped +
 * written to the goal's history as an accomplishment), `parked` (set aside, out of rotation).
 *
 * 'learned' vs 'known' is load-bearing, not pedantry: nine backfilled pieces recorded as
 * 'learned' would put nine accomplishments dated today into progress counts and the recap —
 * "you learned nine pieces this week" — which is exactly the kind of inflated cheer the brand
 * bans. Backfill is quiet; only a real crossing celebrates.
 */

const STATUS_OF: Record<string, { status: RepertoireStatus; markLearned: boolean }> = {
  working: { status: 'working', markLearned: false },
  known: { status: 'known', markLearned: false },
  learned: { status: 'known', markLearned: true },
  parked: { status: 'parked', markLearned: false },
};

interface ItemParam {
  label?: unknown;
  status?: unknown;
  kind?: unknown;
}

export const UPDATE_REPERTOIRE: CoachActionTool = {
  name: 'update_repertoire',
  description:
    'Write down the user\'s repertoire — the pieces, katas, poems, or techniques they are learning or already know — so they never have to list it twice and practice can draw on it. Use the moment they name such material; read it back later with get_repertoire. Takes effect immediately: it is their own account of what they know, so your sentence reflecting it back is the confirmation. Pass {"items": [{"label": "Écossaise (Hummel)", "status": "known", "kind": "piece"}], "goal": "Practice piano"} — "status" is working (learning it now), known (already have it), learned (finished just now — celebrated as an accomplishment), or parked (set aside), and defaults to working. "kind" is plain words, omit if unclear; "goal" names a goal exactly as listed, omit if none fits.',
  parameters: {
    properties: {
      items: {
        type: 'array',
        description: 'One entry per thing they can name. Defaults: "status" working, "kind" none.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            status: { type: 'string', enum: ['working', 'known', 'learned', 'parked'] },
            kind: { type: 'string' },
          },
          required: ['label'],
        },
      },
      goal: {
        type: 'string',
        description:
          'Which goal this material serves, by its title exactly as listed. Omit if none fits — the record still keeps.',
      },
    },
    required: ['items'],
  },
  async run(userId, params) {
    const raw = Array.isArray(params.items) ? (params.items as ItemParam[]) : [];
    const wanted = raw
      .map((i) => ({
        label: typeof i.label === 'string' ? i.label.trim().slice(0, 120) : '',
        statusWord: typeof i.status === 'string' ? i.status.trim().toLowerCase() : 'working',
        kind: typeof i.kind === 'string' && i.kind.trim() ? i.kind.trim().slice(0, 40) : null,
      }))
      .filter((i) => i.label);
    if (!wanted.length) return 'No items were named, so nothing was recorded. Ask what they know or are working on.';

    // Goal link is best-effort: a fuzzy miss records the items unlinked rather than dropping them.
    let goalId: string | null = null;
    let goalNote = '';
    const goalQuery = typeof params.goal === 'string' ? params.goal.trim() : '';
    if (goalQuery) {
      const goals = await listGoals(userId);
      const live = goals.filter((g) => !['completed', 'abandoned'].includes(g.status));
      const goal = matchActivity(live, goalQuery);
      if (goal) goalId = goal.goal_id;
      else goalNote = ` (no goal matched "${goalQuery}" — recorded without a goal link)`;
    }

    const saved: string[] = [];
    const rejected: string[] = [];
    for (const item of wanted.slice(0, 30)) {
      const mapped = STATUS_OF[item.statusWord];
      if (!mapped) {
        rejected.push(`${item.label} — "${item.statusWord}" is not a standing; use working, known, learned, or parked`);
        continue;
      }
      const row = await upsertRepertoireItem(userId, {
        label: item.label,
        status: mapped.status,
        markLearned: mapped.markLearned,
        goal_id: goalId,
        kind: item.kind,
      });
      if (mapped.markLearned) {
        // A real crossing is an accomplishment — it joins the goal's history and the counts.
        await insertGoalEvent(userId, {
          goal_id: goalId,
          kind: 'completion',
          label: `Learned: ${row.label}`,
        }).catch(() => null);
      }
      saved.push(`${row.label} → ${item.statusWord}`);
    }

    // Read back after writing, so the answer describes the OBSERVED state (TOOL-HARNESS.md §5).
    const now = await listRepertoire(userId);
    const counts = { working: 0, known: 0, parked: 0 };
    for (const i of now) counts[i.status] += 1;
    return [
      `Recorded${goalNote}:`,
      ...saved.map((s) => `- ${s}`),
      ...(rejected.length ? ['Not recorded:', ...rejected.map((r) => `- ${r}`)] : []),
      `On file now: ${counts.working} being learned, ${counts.known} known, ${counts.parked} set aside.`,
      'Say in one line what you noted down. Anything marked learned is worth a warm sentence — it is a thing they did.',
    ].join('\n');
  },
};
