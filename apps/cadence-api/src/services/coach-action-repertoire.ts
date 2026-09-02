import { listGoals } from '../repos/goals.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { listRepertoire, upsertRepertoireItem } from '../repos/repertoire.ts';
import { invalidateSessionsFor } from './repertoire-practice.ts';
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
 * An OMITTED status keeps an existing item exactly as it stands (a bare re-mention must never
 * demote a known piece out of the rotation); a new item starts as working.
 *
 * 'learned' vs 'known' is load-bearing, not pedantry: nine backfilled pieces recorded as
 * 'learned' would put nine accomplishments dated today into progress counts and the recap —
 * "you learned nine pieces this week" — which is exactly the kind of inflated cheer the brand
 * bans. Backfill is quiet; only a real crossing celebrates — and only ONCE: a re-mention of an
 * already-learned piece keeps its date and writes no second accomplishment.
 */

const STATUS_OF = new Map<string, { status: RepertoireStatus | undefined; markLearned: boolean }>([
  ['', { status: undefined, markLearned: false }], // omitted: keep existing; new rows default working
  ['working', { status: 'working', markLearned: false }],
  ['known', { status: 'known', markLearned: false }],
  ['learned', { status: 'known', markLearned: true }],
  ['parked', { status: 'parked', markLearned: false }],
]);

/** How many items one call will write. Not a silent cap: anything beyond it is reported back. */
const MAX_ITEMS_PER_CALL = 30;

interface ItemParam {
  label?: unknown;
  status?: unknown;
  kind?: unknown;
}

/*
 * No `tempo_bpm` here, deliberately — and not only because the description is 8 characters under
 * the harness cap.
 *
 * A SETTLED tempo is the person's own datum: the speed they actually play the thing at, reported
 * by the dock once they have engaged with it. What the coach says in chat ("let's take it at 60
 * this week") is a PRESCRIPTION, and prescriptions already have a channel — `metronome_bpm` on the
 * session item, which wins over the settled tempo by the owner's ruling.
 *
 * Letting her write the settled field would collapse those two into one number, and she would read
 * her own suggestion back next week as evidence of what they play. That is the same feedback loop
 * the dock's engagement gate exists to prevent; it should not be reintroduced from the other end.
 */

export const UPDATE_REPERTOIRE: CoachActionTool = {
  name: 'update_repertoire',
  description:
    'Write down the user\'s repertoire — the pieces, katas, poems, or techniques they are learning or already know — so it is never asked for twice and practice can draw on it. Use the moment they name such material; get_repertoire reads it back. Takes effect immediately: it is their own account of what they know, so your sentence reflecting it back is the confirmation. Pass {"items": [{"label": "Écossaise (Hummel)", "status": "known", "kind": "piece"}], "goal": "Practice piano"} — "status" is working (learning it now), known (already have it), learned (finished just now — celebrated, once), or parked (set aside); omitted, it keeps an existing item as it stands, and new items start working. "kind" is plain words, omit if unclear; "goal" names a goal exactly as listed, omit if none fits.',
  parameters: {
    properties: {
      items: {
        type: 'array',
        description: 'One entry per thing they can name. "status" omitted keeps an existing item as it is.',
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
    const seen = new Set<string>();
    const wanted = raw
      .map((i) => ({
        label: typeof i.label === 'string' ? i.label.trim().slice(0, 120) : '',
        statusWord: typeof i.status === 'string' ? i.status.trim().toLowerCase() : '',
        kind: typeof i.kind === 'string' && i.kind.trim() ? i.kind.trim().slice(0, 40) : null,
      }))
      // Dedupe within the call — two entries for one label would race the upsert against itself.
      .filter((i) => {
        const key = i.label.normalize('NFC').toLowerCase();
        if (!i.label || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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

    const batch = wanted.slice(0, MAX_ITEMS_PER_CALL);
    const rejected: string[] = [];
    const accepted = batch.filter((item) => {
      if (STATUS_OF.has(item.statusWord)) return true;
      rejected.push(`${item.label} — "${item.statusWord}" is not a standing; use working, known, learned, or parked`);
      return false;
    });
    // Independent rows — written concurrently so nine pieces cost one round-trip's wait, not nine.
    const written = await Promise.all(
      accepted.map(async (item) => {
        const mapped = STATUS_OF.get(item.statusWord)!;
        const { item: row, learnedNow } = await upsertRepertoireItem(userId, {
          label: item.label,
          status: mapped.status,
          markLearned: mapped.markLearned,
          goal_id: goalId,
          kind: item.kind,
        });
        // A real crossing joins the goal's history exactly once — learnedNow is false when the
        // piece was already learned (a re-mention keeps its date and gets no second cheer).
        let eventFailed = false;
        if (learnedNow) {
          eventFailed = !(await insertGoalEvent(userId, {
            goal_id: goalId,
            kind: 'completion',
            label: `Learned: ${row.label}`,
          }).catch(() => null));
        }
        const said = item.statusWord || (row.status === 'working' ? 'working (new)' : `kept ${row.status}`);
        return { line: `${row.label} → ${said}`, row, learnedNow, eventFailed };
      }),
    );

    // The rotation reads cached prescriptions; a repertoire write makes this goal's stale.
    await invalidateSessionsFor(
      userId,
      written.map((w) => w.row),
    ).catch(() => undefined);

    // Read back after writing, so the answer describes the OBSERVED state (TOOL-HARNESS.md §5).
    const now = await listRepertoire(userId);
    const counts = { working: 0, known: 0, parked: 0 };
    for (const i of now) counts[i.status] += 1;
    const overflow = wanted.length - batch.length;
    const eventFailures = written.filter((w) => w.eventFailed).length;
    return [
      `Recorded${goalNote}:`,
      ...written.map((w) => `- ${w.line}`),
      ...(rejected.length ? ['Not recorded:', ...rejected.map((r) => `- ${r}`)] : []),
      ...(overflow > 0
        ? [
            `NOT recorded — the list was cut at ${MAX_ITEMS_PER_CALL}: the last ${overflow} item(s) were not written. Call again with the rest.`,
          ]
        : []),
      ...(eventFailures > 0
        ? [
            `Note: ${eventFailures} learned item(s) were saved, but adding them to the goal's history failed — do not claim they were celebrated in the record; the standing itself is stored.`,
          ]
        : []),
      `On file now: ${counts.working} being learned, ${counts.known} known, ${counts.parked} set aside.`,
      'Say in one line what you noted down. Anything newly learned is worth a warm sentence — it is a thing they did.',
    ].join('\n');
  },
};
