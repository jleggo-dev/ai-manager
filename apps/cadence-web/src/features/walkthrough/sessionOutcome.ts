import type { WalkthroughStep } from '@cadence/shared';
import { stepFraction, type StepLogs } from './state.ts';

/**
 * What Cadence already knows about the session that just ended.
 *
 * The design's rule is that the objective outcome is never asked for — it is read out of the
 * walkthrough's own StepLogs and *stated*. So everything here is derived, and the one thing that
 * isn't derivable (how it felt) is the only thing the card asks.
 *
 * Mind vs movement is decided by the TOOLS the session actually used, not by the activity's
 * title or category. A "walk" that turns out to be a walking meditation should get the mind
 * question, and title-matching would never know that.
 *
 * By the MINUTES, though — not by the presence of one mind tool. A 50-minute ruck with a
 * one-minute check-in at the end is a ruck; it was asked "how's your head now?" (2026-09-06)
 * because a single feeling_log made the whole session mind. The session is what most of its
 * time was.
 */

/** Tools whose whole point is interior state — these make a session a mind session. */
const MIND_TOOLS = new Set(['breathing', 'meditate', 'grounding', 'feeling_log', 'journal']);

export interface SessionOutcome {
  kind: 'movement' | 'mind';
  logged: number;
  total: number;
  /** True when the session ended with steps untouched or a tool left partway. */
  partial: boolean;
  /** Cadence stating what happened. Always factual, always from the logs. */
  statement: string;
  /** The single question the chips answer. */
  question: string;
  /** Movement only: partial sessions ask WHY, complete ones ask how hard it felt. */
  asks: 'rpe' | 'reason' | 'felt_state';
}

const totalMinutes = (steps: WalkthroughStep[]) => steps.reduce((n, s) => n + Math.max(1, s.minutes), 0);
const mindMinutes = (steps: WalkthroughStep[]) =>
  steps.reduce((n, s) => n + (MIND_TOOLS.has(s.tool.kind) ? Math.max(1, s.minutes) : 0), 0);

export function sessionOutcome(steps: WalkthroughStep[], logs: StepLogs): SessionOutcome {
  const kind: SessionOutcome['kind'] = mindMinutes(steps) * 2 > totalMinutes(steps) ? 'mind' : 'movement';
  const total = steps.length;
  const logged = steps.filter((s) => logs[s.id]).length;
  const anyPartialTool = steps.some((s) => {
    const log = logs[s.id];
    return !!log && stepFraction(s, log) < 1;
  });
  const partial = logged < total || anyPartialTool;

  if (kind === 'mind') {
    // Never framed as a shortfall: on the mind pillar a stopped session is a completed rep, so
    // the statement counts what happened and stops there. No reason codes follow it.
    return {
      kind,
      logged,
      total,
      partial,
      statement: partial ? 'You stopped partway — that still counts.' : "That's the whole thing, logged.",
      question: "How's your head now?",
      asks: 'felt_state',
    };
  }

  if (partial) {
    return {
      kind,
      logged,
      total,
      partial,
      statement: `You did ${logged} of ${total} ${total === 1 ? 'step' : 'steps'}.`,
      question: 'Want to tell me what happened?',
      asks: 'reason',
    };
  }

  return {
    kind,
    logged,
    total,
    partial,
    statement: `That's all ${total} ${total === 1 ? 'step' : 'steps'}, start to finish.`,
    question: 'How did it feel?',
    asks: 'rpe',
  };
}
