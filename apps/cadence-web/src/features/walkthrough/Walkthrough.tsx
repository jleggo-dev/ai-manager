import { useState, type ReactNode } from 'react';
import type { Walkthrough as WalkthroughData, WalkthroughStep } from '@cadence/shared';
import { StepReps } from './tools/StepReps.tsx';
import { StepTimer } from './tools/StepTimer.tsx';
import { StepCircuit } from './tools/StepCircuit.tsx';
import { StepBreathing } from './tools/StepBreathing.tsx';
import { StepMeditate } from './tools/StepMeditate.tsx';
import { StepCheckoff, StepJournal } from './tools/SimpleTools.tsx';
import { TONE } from './tools/tone.ts';
import { Recap } from './Recap.tsx';
import { AllSteps } from './AllSteps.tsx';
import { Pip, StepHeader } from './wt-parts.tsx';
import { overlay, center, closeBtn, caption, navBtn, greenBtn, shortTitle } from './wt-styles.ts';
import { type StepLog, type StepLogs, stepStatus, stepFraction, minutesLeft, recapSummary } from './state.ts';

/**
 * The task walkthrough (v2 — design "browse / do / commit"). Moving between steps (Back ↔ Next, the
 * pips, or the All-steps sheet) logs NOTHING and loses nothing — only a tool writes a StepLog, and
 * nothing commits until Finish. The header bar is the workout to scale (one pip per step, width = its
 * minutes) and captions where you are; the last step hands to the Recap; Finish is the single write,
 * then a celebration. Free browsing before touching a tool IS the preview — no separate mode.
 */
export function Walkthrough({
  walkthrough,
  title,
  onClose,
  onComplete,
}: {
  walkthrough: WalkthroughData;
  title: string;
  onClose: () => void;
  onComplete: (summary: string) => void;
}) {
  const steps = walkthrough.steps;
  const [idx, setIdx] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [logs, setLogs] = useState<StepLogs>({});
  const [phase, setPhase] = useState<'step' | 'recap' | 'done'>('step');
  const [allSteps, setAllSteps] = useState(false);

  const step = steps[idx];
  const left = minutesLeft(steps, idx, visited);

  const go = (i: number) => {
    setIdx(i);
    setVisited((v) => new Set(v).add(i));
    setAllSteps(false);
  };
  const next = () => (idx + 1 < steps.length ? go(idx + 1) : setPhase('recap'));
  const prev = () => idx > 0 && go(idx - 1);
  const setLog = (id: string, log: StepLog) => setLogs((l) => ({ ...l, [id]: log }));

  if (steps.length === 0 || !step) return null;

  if (phase === 'done') {
    return (
      <div style={overlay} role="dialog" aria-label="Task complete">
        <div style={{ ...center, gap: 12 }}>
          <div style={{ fontSize: 64, animation: 'pop 0.5s ease' }} aria-hidden>
            🎉
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: TONE.ink2 }}>Nice work!</div>
          <div style={{ fontSize: 14, color: 'oklch(45% 0.02 150)', textAlign: 'center', maxWidth: 300 }}>
            {recapSummary(steps, logs) || `${title} complete`}
          </div>
          <button style={{ ...greenBtn, marginTop: 8 }} onClick={() => onComplete(recapSummary(steps, logs))}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'recap') {
    return (
      <Recap
        steps={steps}
        logs={logs}
        title={title}
        onBack={() => setPhase('step')}
        onJump={(i) => {
          setPhase('step');
          go(i);
        }}
        onResolve={setLog}
        onFinish={() => setPhase('done')}
      />
    );
  }

  return (
    <div style={overlay} role="dialog" aria-label="Task walkthrough">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'oklch(38% 0.05 60)' }}>{shortTitle(title)}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'oklch(52% 0.04 62)' }}>
              {walkthrough.total_min} MIN TOTAL
            </div>
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {steps.map((s, i) => (
              <Pip
                key={s.id}
                onClick={() => go(i)}
                flex={Math.max(2, s.minutes)}
                status={stepStatus(i, idx, visited, s, logs[s.id])}
                fraction={stepFraction(s, logs[s.id])}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={caption}>
              Step {idx + 1} of {steps.length}
            </div>
            <div style={caption}>{left} min left</div>
          </div>
        </div>
      </div>

      <div
        style={{ marginTop: 20, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {step.tool.kind === 'circuit' ? (
          <StepCircuit
            step={step}
            rounds={step.tool.rounds}
            exercises={step.tool.exercises}
            log={
              logs[step.id]?.kind === 'circuit' ? (logs[step.id] as Extract<StepLog, { kind: 'circuit' }>) : undefined
            }
            onLog={(l) => setLog(step.id, l)}
            onAdvance={next}
          />
        ) : (
          <>
            <StepHeader step={step} />
            <div style={{ marginTop: 18 }}>{renderTool(step, logs, setLog, next, steps[idx + 1]?.title)}</div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
        <div style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: 'oklch(52% 0.04 62)' }}>
          Back and Next only move you — nothing is logged or lost.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            style={{ ...navBtn, width: 62, flex: 'none' }}
            onClick={prev}
            disabled={idx === 0}
            aria-label="Previous step"
          >
            ‹
          </button>
          <button style={{ ...navBtn, flex: 1 }} onClick={() => setAllSteps(true)}>
            <span style={{ fontSize: 13, fontWeight: 900, color: 'oklch(32% 0.02 150)' }}>All steps</span>
          </button>
          {step.tool.kind === 'circuit' ? (
            <button
              style={{
                ...navBtn,
                flex: 'none',
                padding: '0 12px',
                border: '1px solid oklch(84% 0.05 66)',
                whiteSpace: 'nowrap',
              }}
              onClick={next}
            >
              <span style={{ fontSize: 12.5, fontWeight: 900, color: TONE.chipInk }}>Skip circuit&nbsp;›</span>
            </button>
          ) : (
            <button style={{ ...navBtn, width: 62, flex: 'none' }} onClick={next} aria-label="Next step">
              ›
            </button>
          )}
        </div>
      </div>

      {allSteps && (
        <AllSteps
          steps={steps}
          logs={logs}
          idx={idx}
          visited={visited}
          onClose={() => setAllSteps(false)}
          onJump={go}
          onReview={() => {
            setAllSteps(false);
            setPhase('recap');
          }}
        />
      )}
    </div>
  );
}

/** Dispatch the current step to its tool card (the tool owns its own log button). Circuits render
 *  their whole body directly in the shell, so they aren't here. */
function renderTool(
  step: WalkthroughStep,
  logs: StepLogs,
  setLog: (id: string, l: StepLog) => void,
  onAdvance: () => void,
  nextTitle?: string,
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
          log={log?.kind === 'reps' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
        />
      );
    case 'timer':
      return (
        <StepTimer
          seconds={t.seconds}
          chime={t.chime ?? true}
          nextTitle={nextTitle}
          log={log?.kind === 'timer' ? log : undefined}
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
          log={log?.kind === 'breathing' ? log : undefined}
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
          log={log?.kind === 'meditate' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
          onDone={onAdvance}
        />
      );
    case 'journal':
      return (
        <StepJournal
          prompt={t.prompt}
          note={log?.kind === 'done' ? (log.note ?? '') : ''}
          onLog={(note) => setLog(step.id, { kind: 'done', note })}
        />
      );
    default:
      return (
        <StepCheckoff
          label={t.kind === 'checkoff' ? t.label : undefined}
          done={!!log}
          onDone={() => setLog(step.id, { kind: 'done' })}
        />
      );
  }
}
