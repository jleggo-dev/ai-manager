import type { ReactNode } from 'react';
import type { WalkthroughStep } from '@cadence/shared';
import { StepReps } from './tools/StepReps.tsx';
import { StepTimer, type TimerClock } from './tools/StepTimer.tsx';
import { StepTimedSets } from './tools/StepTimedSets.tsx';
import { StepBreathing } from './tools/StepBreathing.tsx';
import { StepMeditate } from './tools/StepMeditate.tsx';
import { StepGrounding } from './tools/StepGrounding.tsx';
import { StepFeelingLog } from './tools/StepFeelingLog.tsx';
import { StepMeasure } from './tools/StepMeasure.tsx';
import { StepCheckoff, StepJournal } from './tools/SimpleTools.tsx';
import type { StepLog, StepLogs } from './state.ts';

/**
 * Dispatch the current step to its tool card (the tool owns its own log button). Circuits render
 * their whole body directly in the shell, so they aren't here. Out of Walkthrough.tsx so the shell
 * stays under the size gate. `workingLoad` is the weight the person added this session (Phase 5):
 * the reps and timed-sets tools log each set at it.
 */
export function renderTool(
  step: WalkthroughStep,
  logs: StepLogs,
  setLog: (id: string, l: StepLog) => void,
  onAdvance: () => void,
  /** The step's id for the app-level clock store, and the clock already running for it, if any. */
  clock?: { stepId: string; resume: TimerClock | null },
  workingLoad?: string,
): ReactNode {
  const t = step.tool;
  const log = logs[step.id];
  switch (t.kind) {
    case 'reps':
      return (
        <StepReps
          sets={t.sets}
          reps={t.reps}
          load={t.load}
          workingLoad={workingLoad}
          log={log?.kind === 'reps' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
          onDone={onAdvance}
        />
      );
    case 'timer':
      // Two or more sets play as sets of a timed effort (walkthrough v3 R1); one set is the hold
      // it always was. Both share the remembered running clock.
      if (t.sets && t.sets > 1) {
        return (
          <StepTimedSets
            seconds={t.seconds}
            sets={t.sets}
            load={t.load}
            workingLoad={workingLoad}
            chime={t.chime ?? true}
            switchSides={t.switch_sides ?? false}
            title={step.title}
            stepId={clock?.stepId}
            log={log?.kind === 'timed_sets' ? log : undefined}
            resumeClock={clock?.resume}
            onLog={(l) => setLog(step.id, l)}
            onDone={onAdvance}
          />
        );
      }
      return (
        <StepTimer
          seconds={t.seconds}
          chime={t.chime ?? true}
          openEnded={t.open_ended ?? false}
          switchSides={t.switch_sides ?? false}
          title={step.title}
          stepId={clock?.stepId}
          log={log?.kind === 'timer' ? log : undefined}
          resumeClock={clock?.resume}
          onLog={(l) => setLog(step.id, l)}
          onDone={onAdvance}
        />
      );
    // No `title` passed on purpose: the shell header already shows step.title (the coach's own
    // words), so the card names the rhythm instead of repeating the name back.
    case 'breathing':
      return (
        <StepBreathing
          pattern={t.pattern}
          cycles={t.cycles}
          caution={t.pattern.caution}
          stepId={clock?.stepId}
          stepTitle={step.title}
          log={log?.kind === 'breathing' ? log : undefined}
          resumeClock={clock?.resume}
          onLog={(l) => setLog(step.id, l)}
          onDone={onAdvance}
        />
      );
    case 'meditate':
      return (
        <StepMeditate
          seconds={t.seconds}
          bells={t.bells}
          intervalMin={t.intervalMin}
          title={step.title}
          stepId={clock?.stepId}
          log={log?.kind === 'meditate' ? log : undefined}
          resumeClock={clock?.resume}
          onLog={(l) => setLog(step.id, l)}
          onDone={onAdvance}
        />
      );
    case 'grounding':
      return <StepGrounding spec={t.spec} onLog={(l) => setLog(step.id, l)} onDone={onAdvance} />;
    case 'feeling_log':
      return <StepFeelingLog onLog={(l) => setLog(step.id, l)} onDone={onAdvance} />;
    case 'measure':
      return (
        <StepMeasure
          metric={t.metric}
          unit={t.unit}
          log={log?.kind === 'measure' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
        />
      );
    case 'journal': {
      const jl = log?.kind === 'journal' ? log : null;
      return (
        <StepJournal
          prompt={t.prompt}
          minutes={t.minutes}
          note={jl?.note ?? ''}
          secret={jl?.secret ?? false}
          onSecret={(secret) =>
            setLog(step.id, {
              kind: 'journal',
              note: jl?.note ?? '',
              secret,
              bank: t.bank ?? null,
              prompt: t.prompt,
            })
          }
          onLog={(note) =>
            setLog(step.id, {
              kind: 'journal',
              note,
              secret: jl?.secret ?? false,
              bank: t.bank ?? null,
              prompt: t.prompt,
            })
          }
        />
      );
    }
    default:
      return (
        <StepCheckoff
          label={t.kind === 'checkoff' ? t.label : undefined}
          prompt={t.kind === 'checkoff' ? t.prompt : undefined}
          log={log?.kind === 'done' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
        />
      );
  }
}
