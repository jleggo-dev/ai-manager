import type { WalkthroughStep } from '@cadence/shared';

/**
 * The walkthrough v2 capture model (design "browse / do / commit"). Moving through steps logs
 * NOTHING; only a tool writes a `StepLog`, and nothing is committed until Finish. The shell holds a
 * `StepLogs` map keyed by step id; these pure helpers derive the progress bar, the all-steps list,
 * the recap, and the final log line from it.
 */
export type StepLog =
  | { kind: 'reps'; sets: number[]; target?: number; load?: string }
  | { kind: 'circuit'; roundsDone: number; totalRounds: number }
  | { kind: 'timer'; elapsedSec: number; targetSec: number; done: boolean }
  | { kind: 'done'; note?: string }; // checkoff / read / journal (journal carries the note)

export type StepLogs = Record<string, StepLog>;

export type StepStatus = 'logged' | 'partial' | 'current' | 'skipped' | 'untouched';

/** 0–1 completion of a step's capture — drives the partial pip, the ring fills, and the recap. */
export function stepFraction(step: WalkthroughStep, log?: StepLog): number {
  if (!log) return 0;
  switch (log.kind) {
    case 'reps': {
      const target = step.tool.kind === 'reps' ? step.tool.sets : log.sets.length;
      return target > 0 ? Math.min(1, log.sets.length / target) : log.sets.length > 0 ? 1 : 0;
    }
    case 'circuit':
      return log.totalRounds > 0 ? Math.min(1, log.roundsDone / log.totalRounds) : log.roundsDone > 0 ? 1 : 0;
    case 'timer':
      return log.targetSec > 0 ? Math.min(1, log.elapsedSec / log.targetSec) : log.done ? 1 : 0;
    case 'done':
      return log.note != null || log.kind === 'done' ? 1 : 0;
  }
}

/**
 * A step's status. `current` wins; a step with a log is logged (fraction ≥ 1) or partial; a
 * visited-but-unlogged step is skipped ("passed over"); a step never reached is untouched.
 */
export function stepStatus(
  index: number,
  currentIndex: number,
  visited: ReadonlySet<number>,
  step: WalkthroughStep,
  log?: StepLog,
): StepStatus {
  if (index === currentIndex) return 'current';
  if (log) return stepFraction(step, log) >= 1 ? 'logged' : 'partial';
  return visited.has(index) ? 'skipped' : 'untouched';
}

/** Minutes still ahead of you — untouched steps only, so it drops as you log AND as you skip. */
export function minutesLeft(steps: WalkthroughStep[], currentIndex: number, visited: ReadonlySet<number>): number {
  return steps.reduce((n, _s, i) => (i !== currentIndex && !visited.has(i) ? n + steps[i]!.minutes : n), 0);
}

/** The one-line receipt a logged step contributes to the occurrence log ("4×12 @ 40 kg"). */
export function logLine(step: WalkthroughStep, log: StepLog): string {
  switch (log.kind) {
    case 'reps': {
      const sets = log.sets;
      const load = log.load ? ` @ ${log.load}` : '';
      if (sets.length === 0) return step.title;
      const first = sets[0]!;
      const uniform = sets.every((r) => r === first);
      const base = uniform ? `${sets.length}×${first}` : `${sets.length}×[${sets.join(',')}]`;
      return `${base}${load}`;
    }
    case 'circuit':
      return `${log.roundsDone} of ${log.totalRounds} rounds`;
    case 'timer': {
      const m = Math.floor(log.elapsedSec / 60);
      const s = log.elapsedSec % 60;
      return log.done ? `${Math.round(log.targetSec / 60)} min` : `${m}:${String(s).padStart(2, '0')}`;
    }
    case 'done':
      return log.note?.trim() || 'done';
  }
}

/** The whole-task summary written on Finish — "squat 4×12 @ 40 kg · circuit 2/3 · 2 steps left". */
export function recapSummary(steps: WalkthroughStep[], logs: StepLogs): string {
  const parts = steps.filter((s) => logs[s.id]).map((s) => `${s.title.toLowerCase()} ${logLine(s, logs[s.id]!)}`);
  const skipped = steps.filter((s) => !logs[s.id]).length;
  if (skipped > 0) parts.push(`${skipped} step${skipped === 1 ? '' : 's'} left`);
  return parts.join(' · ');
}
