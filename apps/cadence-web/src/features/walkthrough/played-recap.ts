/**
 * The logs of a rearranged session, read two ways (walkthrough v3 Phase 6):
 *
 *   • `effectiveLogs` — what the shell's pips, status discs and all-steps rows read: the plain
 *     steps' own logs, plus a `group` log for every played group derived from the turn logs, plus
 *     a plain step's turns folded into its ordinary log when its sets were logged elsewhere (a
 *     group that was split back after some of it was done).
 *   • `recapView` — what the Recap lists and Finish writes: one row per group in played order, a
 *     combined group as one row ("Bench + row · circuit · 3 rounds") with each member's numbers
 *     behind it, and a spread step as ONE row ("Dead hang · 3×45 s · one at a time") where its
 *     first set was played.
 *
 * Pure. The turn logs themselves are keyed by turn (`turnKey`), so a set's log survives every move
 * of that set between groups, and Undo in the Rearrange sheet never loses a number.
 */
import {
  type PlayedShape,
  type PlayedStep,
  type TurnLogs,
  type WalkthroughStep,
  distinctSteps,
  foldTurns,
  groupProgress,
  groupRecapTitle,
  isCombined,
  normalizeShape,
  spreadSteps,
  turnMinutes,
} from '@cadence/shared';
import { type StepLog, type StepLogs, logLine } from './state.ts';

type SetsLog = Extract<StepLog, { kind: 'reps' | 'timed_sets' }>;

/** A step's logged turns as the log its own tool would have written. */
function foldedLog(
  step: WalkthroughStep,
  turns: PlayedStep['play'] extends infer P ? (P extends { turns: infer T } ? T : never) : never,
  turnLogs: TurnLogs,
  spread: boolean,
): SetsLog | null {
  const t = step.tool;
  const planLoad = 'load' in t ? t.load : undefined;
  const folded = foldTurns(step.id, turns, turnLogs, planLoad);
  if (!folded) return null;
  const tail = {
    ...(planLoad ? { load: planLoad } : {}),
    ...(folded.loads ? { loads: folded.loads } : {}),
    ...(spread ? { spread: true as const } : {}),
  };
  if (t.kind === 'timer') return { kind: 'timed_sets', sets: folded.sets, targetSec: t.seconds, ...tail };
  return {
    kind: 'reps',
    sets: folded.sets,
    ...(t.kind === 'reps' && t.reps != null ? { target: t.reps } : {}),
    ...tail,
  };
}

/** A played group's own log, from its turns. */
function groupLog(
  play: NonNullable<PlayedStep['play']>,
  turnLogs: TurnLogs,
): Extract<StepLog, { kind: 'group' }> | null {
  const done = groupProgress(play.turns, turnLogs);
  if (done.turns === 0) return null;
  const turns: TurnLogs = {};
  for (const t of play.turns) {
    const key = `${t.stepId}:${t.set}`;
    const log = turnLogs[key];
    if (log) turns[key] = log;
  }
  return {
    kind: 'group',
    ...(play.mode ? { mode: play.mode } : {}),
    turns,
    done,
    total: { turns: play.turns.length, rounds: play.rounds },
  };
}

/**
 * The logs the shell reads against the played steps. A played group's entry comes from the turn
 * logs; a plain step keeps its own log, or, when it has none but its sets were logged as turns
 * before, gets them folded back.
 */
export function effectiveLogs(played: readonly PlayedStep[], logs: StepLogs, turnLogs: TurnLogs): StepLogs {
  if (Object.keys(turnLogs).length === 0) return logs;
  const out: StepLogs = { ...logs };
  for (const step of played) {
    if (step.play) {
      const log = groupLog(step.play, turnLogs);
      if (log) out[step.id] = log;
      else delete out[step.id];
      continue;
    }
    if (out[step.id]) continue;
    const all = Array.from(
      { length: step.tool.kind === 'reps' ? step.tool.sets : step.tool.kind === 'timer' ? (step.tool.sets ?? 1) : 1 },
      (_, set) => ({ stepId: step.id, set }),
    );
    const folded = foldedLog(step, all, turnLogs, false);
    if (folded) out[step.id] = folded;
  }
  return out;
}

export interface RecapView {
  steps: WalkthroughStep[];
  logs: StepLogs;
}

/**
 * One row per thing the person did, in played order. Steps and logs together so Recap.tsx and
 * `recapSummary` read them exactly as they read an ordinary session.
 */
export function recapView(
  steps: readonly WalkthroughStep[],
  shape: PlayedShape,
  logs: StepLogs,
  turnLogs: TurnLogs,
): RecapView {
  const groups = normalizeShape(shape, steps);
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const spread = spreadSteps(groups);
  const rows: WalkthroughStep[] = [];
  const out: StepLogs = {};
  const placed = new Set<string>();

  for (const g of groups) {
    const ids = distinctSteps(g);
    if (isCombined(g)) {
      const members = ids.map((id) => byId.get(id)).filter((s): s is WalkthroughStep => !!s);
      const row: WalkthroughStep = {
        id: g.id,
        title: groupRecapTitle(members.map((m) => m.title)),
        minutes: g.turns.reduce(
          (n, t) => n + turnMinutes(byId.get(t.stepId) ?? { tool: { kind: 'read' }, minutes: 1 }),
          0,
        ),
        tool: { kind: 'circuit', rounds: g.turns.reduce((m, t) => Math.max(m, t.set + 1), 0), exercises: [] },
        skippable: true,
      };
      rows.push(row);
      const log = groupLog(
        {
          groupId: g.id,
          mode: g.mode,
          turns: g.turns,
          rounds: row.tool.kind === 'circuit' ? row.tool.rounds : 1,
          names: [],
        },
        turnLogs,
      );
      if (log) {
        log.members = members
          .map((m) => {
            const folded = foldedLog(m, g.turns, turnLogs, false);
            return folded ? { title: m.title, line: logLine(m, folded) } : null;
          })
          .filter((m): m is { title: string; line: string } => !!m);
        out[g.id] = log;
      }
      continue;
    }
    for (const id of ids) {
      const step = byId.get(id);
      if (!step || placed.has(id)) continue;
      placed.add(id);
      rows.push(step);
      const singles = spread.get(id);
      if (!singles) {
        // A plain group, or the whole of a step in one place: its own log first, else its turns.
        const own = logs[id];
        const folded = own ?? foldedLog(step, g.turns, turnLogs, false);
        if (folded) out[id] = folded;
        continue;
      }
      const turns = singles.filter((x) => !isCombined(x)).flatMap((x) => x.turns);
      const folded = foldedLog(step, turns, turnLogs, true);
      if (folded) out[id] = folded;
      else if (logs[id]) out[id] = logs[id]!;
    }
  }
  return { steps: rows, logs: out };
}
