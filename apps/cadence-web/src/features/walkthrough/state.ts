import {
  type CombineMode,
  type GroundingGame,
  type SetLoads,
  type TurnLogs,
  type WalkthroughStep,
  SPREAD_TAIL,
  feelingLogLine,
  groundingLogLine,
  groupLogLine,
  groupSummary,
  intervalLogLine,
  loadTail,
  sitLogLine,
  swappedTail,
  timedSetsLogLine,
} from '@cadence/shared';

/**
 * The walkthrough v2 capture model (design "browse / do / commit"). Moving through steps logs
 * NOTHING; only a tool writes a `StepLog`, and nothing is committed until Finish. The shell holds a
 * `StepLogs` map keyed by step id; these pure helpers derive the progress bar, the all-steps list,
 * the recap, and the final log line from it.
 */
/**
 * Load per set (walkthrough v3 Phase 5): `load` stays what the plan said for the step — every
 * reader that compared or printed it is unchanged — and `loads` is what was actually lifted, one
 * entry per set in the same order as `sets`, written only once the person changed a weight during
 * the step. A parallel list rather than `{reps, load}` objects so `sets: number[]` keeps feeding
 * `stepFraction`, the chips and the edit-a-set path untouched; the one reader of the pair is the
 * log line, through `loadTail`. A circuit has no per-set log, so its loads are keyed by move index.
 */
/**
 * `spread` (walkthrough v3 Phase 6) marks a reps or timed-sets log folded from sets the person
 * played one at a time, in places of their own: the line reads "3×45 s · one at a time".
 * A `group` log is a rearranged group's own record (played-shape.ts): what each turn logged, keyed
 * by turn, with the progress counted so the pips and the line can read it without the turn list.
 * The recap folds a group's turns back into its member steps' lines (played-recap.ts).
 */
export type StepLog =
  | { kind: 'reps'; sets: number[]; target?: number; load?: string; loads?: SetLoads; spread?: true }
  | { kind: 'circuit'; roundsDone: number; totalRounds: number; loads?: Record<string, string> }
  | { kind: 'timer'; elapsedSec: number; targetSec: number; done: boolean }
  // Sets of a timed effort (walkthrough v3 R1): the seconds each set actually ran, in order, and
  // the target one set was set for. Its own kind rather than a list on `timer`: a timer log is one
  // number read as elapsed-over-target, and every reader of it would have had to branch; this is
  // read like `reps` — sets logged over sets asked — with a load so the line reads "4×40 s @ 2×40 lb".
  | { kind: 'timed_sets'; sets: number[]; targetSec: number; load?: string; loads?: SetLoads; spread?: true }
  | {
      kind: 'group';
      mode?: CombineMode;
      turns: TurnLogs;
      done: { turns: number; rounds: number };
      total: { turns: number; rounds: number };
      /** Each member step's own line, written by the recap fold — the numbers behind the group's. */
      members?: { title: string; line: string }[];
    }
  // An interval run logs the ROUNDS finished and the seconds actually spent — never the
  // prescription. `shorthand` is carried rather than re-derived because the person may have
  // edited the plan before starting, and the receipt has to describe what they ran.
  | {
      kind: 'interval';
      roundsDone: number;
      totalRounds: number;
      elapsedSec: number;
      targetSec: number;
      shorthand: string;
    }
  // Breathing logs ROUNDS, never anything about the person. Partial is the normal case.
  | { kind: 'breathing'; roundsDone: number; totalRounds: number; pattern: string }
  // `returns` is context for the coach ("a busy day, not a bad sit") — never a metric, never
  // charted, never part of XP or a streak.
  | { kind: 'meditate'; elapsedSec: number; targetSec: number; returns: number; done: boolean }
  | { kind: 'grounding'; game: string; stepsDone: number; total: number; openEnded: boolean }
  // The instrument's capture: a word, how much room it's taking (1-3, never rendered), an optional
  // line. Available to the coach as context; there is no surface anywhere that shows it back.
  | { kind: 'feeling_log'; word: string; family: string | null; room: 1 | 2 | 3; note?: string }
  // A journal step's words. They ride the walkthrough's commit rules — nothing reaches the store
  // until Finish — and carry their own key, because a session is a perfectly ordinary place to
  // write something you don't want the coach to read.
  | { kind: 'journal'; note: string; secret: boolean; bank: string | null; prompt: string | null }
  // A measure step's one number, kept as the exact string typed (never reparsed/rounded — the
  // honest-log rule) plus the unit/metric it was entered under, so the log line and any later
  // reader can render it without looking the step back up.
  | { kind: 'measure'; value: string; unit: string; metric: string }
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
    // Sets logged over sets asked, like reps — a short set still counts as a set done.
    case 'timed_sets': {
      const target = step.tool.kind === 'timer' && step.tool.sets ? step.tool.sets : log.sets.length;
      return target > 0 ? Math.min(1, log.sets.length / target) : log.sets.length > 0 ? 1 : 0;
    }
    case 'circuit':
    case 'breathing':
    case 'interval':
      return log.totalRounds > 0 ? Math.min(1, log.roundsDone / log.totalRounds) : log.roundsDone > 0 ? 1 : 0;
    // Turns logged over turns in the group.
    case 'group':
      return log.total.turns > 0 ? Math.min(1, log.done.turns / log.total.turns) : 0;
    case 'timer':
    case 'meditate':
      return log.targetSec > 0 ? Math.min(1, log.elapsedSec / log.targetSec) : log.done ? 1 : 0;
    // Leaving a grounding flow IS finishing it — there is no required length, so it never reads
    // as partial on the pips or the recap.
    case 'grounding':
      return 1;
    case 'feeling_log':
      return 1;
    case 'journal':
      return log.note.trim() ? 1 : 0;
    // One number, one shot — there is no partial reading, only logged or not.
    case 'measure':
      return log.value.trim() ? 1 : 0;
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

/**
 * The one-line receipt a logged step contributes to the occurrence log ("4×12 @ 40 kg"). A step
 * the person swapped says so ("· swapped from glute bridge") and one lifted at another load than
 * the plan names both ("@ 15 lb (plan said bodyweight)") — the shapes on the design's Redlines
 * board, so a swap is never read as a skip and the coach reads what was lifted.
 */
export function logLine(step: WalkthroughStep, log: StepLog): string {
  switch (log.kind) {
    case 'reps': {
      const sets = log.sets;
      if (sets.length === 0) return step.title;
      const first = sets[0]!;
      const uniform = sets.every((r) => r === first);
      const base = uniform ? `${sets.length}×${first}` : `${sets.length}×[${sets.join(',')}]`;
      return `${base}${loadTail(log.load, log.loads)}${swappedTail(step.swapped_from)}${log.spread ? SPREAD_TAIL : ''}`;
    }
    case 'timed_sets':
      return (
        (timedSetsLogLine(log.sets, log.load, log.loads) || step.title) +
        swappedTail(step.swapped_from) +
        (log.spread ? SPREAD_TAIL : '')
      );
    case 'circuit':
      return `${log.roundsDone} of ${log.totalRounds} rounds${circuitChanges(step, log.loads)}`;
    // "circuit · 3 rounds" for alternating turns, "in sequence" for one step's sets then the other's.
    case 'group':
      return groupLogLine(log.mode ?? 'alternate', log.done, log.total);
    case 'interval':
      return intervalLogLine(log);
    // Never "incomplete" — the rounds you did are the rounds you did.
    case 'breathing':
      return log.roundsDone >= log.totalRounds
        ? `${log.totalRounds} rounds`
        : `${log.roundsDone} of ${log.totalRounds} rounds · that counts`;
    case 'meditate':
      return sitLogLine(log.elapsedSec, log.targetSec);
    case 'grounding':
      return groundingLogLine(log.game as GroundingGame, log.stepsDone, log.total, log.openEnded);
    case 'feeling_log':
      return feelingLogLine(log.word, log.room);
    // The recap shows that words were kept, never the words themselves — a session summary is a
    // receipt, and an entry someone marked secret must not leak through it.
    case 'journal':
      return log.secret ? 'kept, secret' : 'kept';
    // Verbatim — the number the person typed, never reparsed or rounded. `unit` is dropped when
    // absent rather than leaving a trailing space.
    case 'measure':
      return log.unit ? `${log.value} ${log.unit}` : log.value;
    // A finished timer logs the minutes actually spent, never the prescription: a 50-min ruck
    // that ran to 110 reads "110 min". The two only differ when the effort ran over.
    case 'timer': {
      const m = Math.floor(log.elapsedSec / 60);
      const s = log.elapsedSec % 60;
      return log.done ? `${Math.max(1, Math.round(log.elapsedSec / 60))} min` : `${m}:${String(s).padStart(2, '0')}`;
    }
    case 'done':
      return log.note?.trim() || 'done';
  }
}

/**
 * What changed inside a circuit, per move: " · swapped glute bridge for hip thrust" and
 * " · hip thrust @ 15 lb (plan said bodyweight)". Read off the effective step's moves (the player
 * writes `swapped_from` there) and the loads the circuit log kept by move index.
 */
function circuitChanges(step: WalkthroughStep, loads: Record<string, string> | undefined): string {
  if (step.tool.kind !== 'circuit') return '';
  return step.tool.exercises
    .map((ex, i) => {
      const used = loads?.[String(i)];
      const lifted = used && used !== (ex.load ?? undefined) ? ` · ${ex.name}${loadTail(ex.load, [used])}` : '';
      return (ex.swapped_from ? ` · swapped ${ex.swapped_from} for ${ex.name}` : '') + lifted;
    })
    .join('');
}

/** The whole-task summary written on Finish — "squat 4×12 @ 40 kg · circuit 2/3 · 2 steps left". A
 *  rearranged group carries each member's numbers behind its own line:
 *  "bench + row circuit · 3 rounds (bench press 3×8 @ 95 lb, dumbbell row 3×10 @ 40 lb)". */
export function recapSummary(steps: WalkthroughStep[], logs: StepLogs): string {
  const parts = steps
    .filter((s) => logs[s.id])
    .map((s) => {
      const log = logs[s.id]!;
      if (log.kind === 'group') return groupSummary(s.title.toLowerCase(), logLine(s, log), log.members ?? []);
      return `${s.title.toLowerCase()} ${logLine(s, log)}`;
    });
  const skipped = steps.filter((s) => !logs[s.id]).length;
  if (skipped > 0) parts.push(`${skipped} step${skipped === 1 ? '' : 's'} left`);
  return parts.join(' · ');
}
