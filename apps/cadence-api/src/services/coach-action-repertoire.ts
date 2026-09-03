import { listGoals } from '../repos/goals.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { listRepertoire, upsertRepertoireItem } from '../repos/repertoire.ts';
import {
  canonicalLabel,
  invalidateSessionsFor,
  isResolvable,
  itemNamedIn,
  matchHay,
  samePiece,
} from './repertoire-practice.ts';
import { normTitle } from './goal-identity.ts';
import { matchActivity } from './plan-edit.ts';
import type { CoachActionTool } from './coach-action-types.ts';
import { qualifierMeta, type RepertoireStatus } from '@cadence/shared';

/**
 * `update_repertoire` — write down what they are learning and what they already know.
 *
 * Born from the 2026-08-29 piano conversation: asked to "select from the pieces I already know",
 * the coach had nowhere to look, asked the user to type nine pieces, and then had nowhere to put
 * them — they froze into one plan sentence that could never rotate or be read back. Owner ruling
 * 2026-08-30: recording repertoire is proactive — when the user names material they know, are
 * working on, or just learned, storing it is not optional.
 *
 * The status verbs, against the four standings (owner design 2026-09-02): `queued` (yet to learn,
 * waiting its turn), `working` (learning it now), `known` (already have it — backfill, no
 * anniversary invented), `learned` (crossed the line just now → stored as known + stamped +
 * written to the goal's history as an accomplishment), `retired` (finished, not revisited).
 * An OMITTED status keeps an existing item exactly as it stands (a bare re-mention must never
 * demote a known piece out of the rotation); a new item starts as working.
 *
 * 'learned' vs 'known' is load-bearing, not pedantry: nine backfilled pieces recorded as
 * 'learned' would put nine accomplishments dated today into progress counts and the recap —
 * "you learned nine pieces this week" — which is exactly the kind of inflated cheer the brand
 * bans. Backfill is quiet; only a real crossing celebrates — and only ONCE: a re-mention of an
 * already-learned piece keeps its date and writes no second accomplishment.
 *
 * 'learned' vs 'retired' is the other pair that must not blur, and this one collides by name: the
 * standing the user sees as "Learned" is `retired`, while the VERB `learned` moves a piece into
 * "Keeping up". So `retired` never stamps, and it never clears a `learned_at` either — retiring
 * something is not un-learning it, and "learned this year" must not shrink when a piece leaves
 * the rotation.
 *
 * There is no `parked`. It was a standing until the four-standings design dropped it; a stale
 * prompt still offering it gets the ordinary rejection naming the five verbs, never a quiet
 * aliasing onto `queued` — a silent alias would keep teaching the old vocabulary forever.
 */

/** Verb → what to write. Exported for its table test: it is a router that fails silently (swap
 *  `learned` and `retired` and nothing throws — a finished piece just rejoins the rotation with a
 *  celebration attached), so coach-action-repertoire.test.ts pins every row and the near-misses. */
export const STATUS_OF = new Map<string, { status: RepertoireStatus | undefined; markLearned: boolean }>([
  ['', { status: undefined, markLearned: false }], // omitted: keep existing; new rows default working
  ['queued', { status: 'queued', markLearned: false }],
  ['working', { status: 'working', markLearned: false }],
  ['known', { status: 'known', markLearned: false }],
  ['learned', { status: 'known', markLearned: true }],
  ['retired', { status: 'retired', markLearned: false }],
]);

/** The verbs the description teaches and the schema offers — '' is the omitted case, not a word
 *  she can write, so it never reaches the enum. */
const STATUS_WORDS = [...STATUS_OF.keys()].filter((w) => w !== '');

/** How many items one call will write. Not a silent cap: anything beyond it is reported back. */
const MAX_ITEMS_PER_CALL = 30;

interface ItemParam {
  label?: unknown;
  status?: unknown;
  kind?: unknown;
  description?: unknown;
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
  // 787 of the 800-char action bound (retrieval/description-audit.test.ts). It teaches five verbs
  // and now a sixth field, so the clauses that could not change a choice went: "mean to learn",
  // "it is their own account", "not revisited", and the per-field "omit if" repeats, which one
  // closing sentence now covers. The standing words are the four definitions, verbatim from
  // `STANDING_MEANS` — she reads them in the shelf render too, and two spellings would drift.
  description:
    'Write down the user\'s repertoire — the pieces, katas, poems, or techniques they are learning or already know. Use the moment they name such material; get_repertoire reads it back. Takes effect immediately: your sentence reflecting it back is the confirmation. Pass {"items": [{"label": "Écossaise (Hummel)", "status": "known", "kind": "piece", "description": "the fast one in G"}], "goal": "Practice piano"} — "status" is queued (not started), working (being worked on), known (learned and still played), learned (crossed just now — stored as known, celebrated once), or retired (finished); omit it to keep an item as it stands, and a new one starts working. "kind" is plain words; "description" is their own words for which one it is; "goal" is a goal\'s exact title. Omit any that do not fit.',
  parameters: {
    properties: {
      items: {
        type: 'array',
        description: 'One entry per thing they can name. "status" omitted keeps an existing item as it is.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            // Derived from STATUS_OF, never hand-copied: a declared verb the table cannot run is
            // rejected at the door, and a runnable one she is never offered is dead code.
            status: { type: 'string', enum: STATUS_WORDS },
            kind: { type: 'string' },
            description: { type: 'string' },
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
        // Their own words for which one it is. Bounded and trimmed by `qualifierMeta` itself, so
        // this only decides whether there is one to write at all.
        description: typeof i.description === 'string' ? i.description.trim() : '',
      }))
      // Dedupe within the call — two entries for one label would race the upsert against itself,
      // and `lower(label)` would not stop them landing as two rows when they differ by an accent.
      // normTitle is the same sameness the rest of the repertoire uses.
      .filter((i) => {
        const key = normTitle(i.label);
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
      rejected.push(`${item.label} — "${item.statusWord}" is not a standing; use ${STATUS_WORDS.join(', ')}`);
      return false;
    });
    // What is already on file, read ONCE for the whole batch: each incoming label is resolved onto
    // an existing row when it is the same piece under normalization, so an accent-variant spelling
    // updates that piece instead of starting a second one beside it. A failed read must not turn a
    // re-mention into a duplicate, so it aborts rather than writing blind.
    const onFile = await listRepertoire(userId).catch((e): null => {
      console.error('[repertoire] pre-write read failed:', e);
      return null;
    });
    if (onFile === null) {
      return 'I could not read what is already on file just now, so I did not write anything — a fault on our side, not an empty record. Try again in a moment.';
    }

    // A title that two pieces already answer to cannot be written as-is: the row would exist and
    // be permanently unfindable, which reads as a record and behaves as a hole. Say which pieces
    // it collides with so the next attempt can qualify it, rather than writing a dead row.
    const resolvable = accepted.filter((item) => {
      if (isResolvable(onFile, item.label)) return true;
      const clash = onFile.filter(
        (i) => !samePiece(i.label, item.label) && itemNamedIn(i.label, matchHay([item.label])),
      );
      rejected.push(
        `${item.label} — already the title of ${clash.map((c) => `"${c.label}"`).join(' and ')}. ` +
          'Add who made it, the collection it comes from, or whatever tells them apart, so the label names one item.',
      );
      return false;
    });

    // Independent rows — written concurrently so nine pieces cost one round-trip's wait, not nine.
    const written = await Promise.all(
      resolvable.map(async (item) => {
        const mapped = STATUS_OF.get(item.statusWord)!;
        const { item: row, learnedNow } = await upsertRepertoireItem(userId, {
          label: canonicalLabel(onFile, item.label),
          status: mapped.status,
          markLearned: mapped.markLearned,
          goal_id: goalId,
          kind: item.kind,
          // Through the one qualifier patch every other writer uses, so it merges into whatever
          // meta already holds rather than replacing it — a tempo settled last month survives a
          // description written tonight. An empty string writes nothing at all.
          meta: item.description ? qualifierMeta({ description: item.description }) : undefined,
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
    const counts: Record<RepertoireStatus, number> = { queued: 0, working: 0, known: 0, retired: 0 };
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
      // Counted in the same words the "status" parameter takes, so the tally she reads back is
      // directly re-usable in her next call — a count labelled "keeping up" would have her
      // writing "keeping up" as a standing and getting it rejected.
      `On file now: ${counts.queued} queued, ${counts.working} working, ${counts.known} known, ${counts.retired} retired.`,
      'Say in one line what you noted down. Anything newly learned is worth a warm sentence — it is a thing they did.',
    ].join('\n');
  },
};
