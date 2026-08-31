import { randomUUID } from 'node:crypto';
import {
  getUser,
  mergeCapturedConstraints,
  removeCapturedConstraint,
  renameCapturedConstraint,
} from '../repos/users.ts';
import { sameConstraint } from './constraint-merge.ts';
import { factTokens } from './fact-tokens.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `update_constraint` — the safety input to every plan, and the one action tool whose wording the
 * user can also edit themselves (Settings → "What we work around").
 *
 * Split out of coach-actions.ts when that file crossed the 500-line gate. It earns its own file
 * anyway: constraints carry the most delicate semantics in the harness — recovered is not
 * mis-captured, and only an explicit "that was never true" deletes.
 */

/**
 * Read the constraints back after writing them, so the answer describes the OBSERVED state.
 *
 * Owner, 2026-08-16: *"Cadence should actually invoke the tool and then double-check to see if
 * their action worked or not."* Right — and better as a rule about the TOOL than about her, because
 * a model can be wrong about whether it checked and a query cannot.
 *
 * The day earned this twice. She told him a session was logged (the tool had said it found nothing)
 * and that a constraint was removed (it was still there, `plan_around: true`, and she went on
 * repeating the claim for turns afterwards). In both cases the tool's own answer was correct and
 * the *claim* was not, so no amount of describing the tool better would have helped.
 *
 * Generalises TOOL-HARNESS.md §5: a tool's return must never claim an effect the tool did not
 * produce — which means the safest return is one that says what a fresh read can see.
 */
export async function verifyConstraints(userId: string): Promise<Array<{ label: string; plan_around?: boolean }>> {
  const u = await getUser(userId);
  return (u?.baseline?.constraints ?? []) as Array<{ label: string; plan_around?: boolean }>;
}

export const UPDATE_CONSTRAINT: CoachActionTool = {
  name: 'update_constraint',
  description:
    'Record a change to something they work around — a knee, a night shift, a hard stretch. Takes effect immediately. Use when one has EASED ("my knee is fine now" → lift, kept on file as quiet so you still know it happened), FLARED again (flare), is genuinely NEW (add), or is worded badly (reword, with new_label). Use remove ONLY when it was recorded wrongly and never true ("I have never had a knee injury") — an error to erase, not history; recovering is never a reason to remove. Read get_constraints first and name it as listed. Pass {"constraint": "left knee", "action": "lift"}; {"constraint": "night shifts", "action": "add", "kind": "life", "plan_around": true, "until": "2026-09-30"}; or {"constraint": "ramp gently", "action": "reword", "new_label": "left ankle tendinitis"}.',
  parameters: {
    properties: {
      constraint: { type: 'string', description: 'Which one, by its label as get_constraints lists it.' },
      action: {
        type: 'string',
        enum: ['add', 'lift', 'flare', 'reword', 'remove'],
        description:
          'add = something new they work around; lift = it has eased, keep it on file as quiet; flare = it is back; reword = same thing, badly described — give new_label; remove = it was recorded wrongly and was never true.',
      },
      new_label: {
        type: 'string',
        description:
          'Required for reword: what it should say instead — their words, naming the thing itself, not what to do about it.',
      },
      kind: {
        type: 'string',
        enum: ['physical', 'life', 'other'],
        description: 'For add: a body thing, a life thing, or neither. Defaults to other.',
      },
      plan_around: {
        type: 'boolean',
        description: 'Whether the plan must work around it. Defaults to true for add and flare.',
      },
      until: {
        type: 'string',
        description: 'YYYY-MM-DD it stops applying, when they said so. Omit for open-ended.',
      },
    },
    required: ['constraint', 'action'],
  },
  async run(userId, params) {
    const label = String(params.constraint ?? '').trim();
    const action = String(params.action ?? '');
    if (!label) return 'No constraint was named, so nothing changed. Ask which one they mean.';

    if (action === 'remove') {
      const removed = await removeCapturedConstraint(userId, label);
      // Re-READ, do not trust the write. See verifyConstraints below.
      const after = await verifyConstraints(userId);
      const stillThere = after.some((c) => sameConstraint(c.label ?? '', label));
      if (stillThere) {
        return `"${label}" is STILL on their file — the removal did not take. Do NOT tell them it is gone. Say you could not remove it just now, and that they can take it off themselves in Settings under "What we work around".`;
      }
      return removed
        ? `Removed "${label}" — verified gone from their file. Say so briefly and move on; do not dwell on the mistake.`
        : `Nothing on file matches "${label}", so nothing was removed. Tell them plainly it was not there.`;
    }

    /**
     * A reword cannot go through the merge path: `mergeConstraints` keeps the LONGER telling, so
     * every attempt to shorten a badly-worded label is discarded without a word. That is why the
     * owner asked repeatedly to fix "ramp gently because of tendinitis" and Cadence agreed
     * repeatedly and nothing ever changed. Same row, same history — only the wording moves.
     */
    if (action === 'reword') {
      const next = String(params.new_label ?? '').trim();
      if (!next) return `No new wording was given, so "${label}" is unchanged. Ask what it should say instead.`;
      const done = await renameCapturedConstraint(userId, label, next);
      if (!done) {
        const names = ((await verifyConstraints(userId)).map((c) => c.label).join(', ') || 'none on file') as string;
        return `Nothing on file matches "${label}", so nothing was reworded. What they work around: ${names}. Ask which they mean.`;
      }
      // Re-READ, do not trust the write.
      const after = await verifyConstraints(userId);
      const landed = after.some((c) => (c.label ?? '').trim() === next);
      return landed
        ? `Reworded: "${done.from}" now reads "${next}" on their file — verified. Say it back in one line so they can tell you if it is still not right.`
        : `"${label}" did NOT get reworded — the change did not take. Do not say it is fixed; say you could not save it just now, and that they can edit the wording themselves in Settings under "What we work around".`;
    }

    const known = ((await getUser(userId))?.baseline?.constraints ?? []) as Array<{ label: string }>;
    const existing = known.find((c) => sameConstraint(c.label ?? '', label));
    if (action !== 'add' && !existing) {
      const names = known.map((c) => c.label).join(', ') || 'none on file';
      return `Nothing on file matches "${label}", so nothing changed. What they work around: ${names}. Ask which they mean, or add it if it is new.`;
    }

    const planAround = typeof params.plan_around === 'boolean' ? params.plan_around : action !== 'lift';
    const kind = ['physical', 'life', 'other'].includes(String(params.kind)) ? String(params.kind) : undefined;
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(params.until ?? '')) ? String(params.until) : undefined;

    await mergeCapturedConstraints(userId, [
      {
        id: randomUUID(),
        label: existing?.label ?? label,
        plan_around: planAround,
        status: action === 'lift' ? 'quiet' : 'active',
        ...(kind ? { kind: kind as 'physical' | 'life' | 'other' } : {}),
        ...(until ? { until } : {}),
      },
    ]);

    // What the file ACTUALLY says now, not what we asked it to say.
    const after = await verifyConstraints(userId);
    const row = after.find((c) => sameConstraint(c.label ?? '', existing?.label ?? label));
    if (!row) {
      return `"${label}" is not on their file after that write — it did not take. Do NOT say it is done; say you could not save it just now.`;
    }
    if (action === 'lift') {
      return row.plan_around === false
        ? `"${row.label}" is marked eased and verified: still on file, so you keep knowing about it, but the plan no longer works around it. Say that back plainly, and if their week was built around it, offer to rebuild.`
        : `"${row.label}" is still being planned around — the change did not take. Do NOT say it is eased; say you could not save it just now.`;
    }
    if (action === 'flare') {
      return row.plan_around
        ? `"${row.label}" is active again and verified: the plan should work around it. Say so, and offer to change the week if it currently ignores it.`
        : `"${row.label}" did not save as active. Do NOT say it is done; say you could not save it just now.`;
    }
    /**
     * A guard reports evidence; she adjudicates (CLAUDE.md). The merge already folds a retelling
     * onto its row, so what reaches here as NEW is genuinely unmatched — but "genuinely unmatched"
     * and "a different fact" are not the same thing ("Wednesday - limit to one workout" beside
     * "Wednesday work schedule — can only do one workout" survived every string rule, 2026-08-31).
     * Name the nearest neighbour instead of deciding, and let her ask.
     */
    const near = !existing ? nearMiss(after, row.label ?? label) : null;
    return `Noted and verified: they work around "${row.label}". Say it back in one line so they can correct you if you have it wrong.${
      near
        ? ` One thing to check: this sits close to "${near}", already on their file — if those are one fact, use reword to fold them into one telling and remove the other.`
        : ''
    }`;
  },
};

/** Another stored label sharing 2+ significant tokens with the one just written — evidence of a
 *  possible twin the containment rule could not merge, for the coach to raise, not act on. */
function nearMiss(rows: Array<{ label?: string }>, written: string): string | null {
  const mine = new Set(factTokens(written));
  for (const r of rows) {
    const label = r.label ?? '';
    if (!label || label === written) continue;
    const overlap = factTokens(label).filter((t) => mine.has(t));
    if (new Set(overlap).size >= 2) return label;
  }
  return null;
}
