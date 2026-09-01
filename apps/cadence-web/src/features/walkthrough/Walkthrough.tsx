import { useState, type ReactNode } from 'react';
import type { Walkthrough as WalkthroughData, WalkthroughStep } from '@cadence/shared';
import { StepReps } from './tools/StepReps.tsx';
import { StepTimer } from './tools/StepTimer.tsx';
import { StepCircuit } from './tools/StepCircuit.tsx';
import { StepInterval, type StepChrome } from './tools/StepInterval.tsx';
import { StepBreathing } from './tools/StepBreathing.tsx';
import { StepMeditate } from './tools/StepMeditate.tsx';
import { StepGrounding } from './tools/StepGrounding.tsx';
import { StepFeelingLog } from './tools/StepFeelingLog.tsx';
import { StepMeasure } from './tools/StepMeasure.tsx';
import { StepCheckoff, StepJournal } from './tools/SimpleTools.tsx';
import { Metronome } from './tools/Metronome.tsx';
import { TONE } from './tools/tone.ts';
import { Recap } from './Recap.tsx';
import { AllSteps } from './AllSteps.tsx';
import { WalkthroughDone } from './WalkthroughDone.tsx';
import { Pip, StepHeader } from './wt-parts.tsx';
import { overlay, closeBtn, caption, navBtn, shortTitle } from './wt-styles.ts';
import { type StepLog, type StepLogs, stepStatus, stepFraction, minutesLeft, recapSummary } from './state.ts';
import { keepJournalEntry } from '../../lib/api.ts';

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
  occurrenceId,
  onClose,
  onComplete,
  onTalk,
}: {
  walkthrough: WalkthroughData;
  title: string;
  /** Ties the post-session answer to the session it belongs to. Absent for ad-hoc runs and
   *  previews — the answer is still worth keeping, it just has nothing to hang off. */
  occurrenceId?: string | null;
  onClose: () => void;
  onComplete: (summary: string) => void;
  /** Opens the coach from the celebration's "Talk to me". Omitted → the button isn't shown,
   *  rather than shown and inert. */
  onTalk?: () => void;
}) {
  const steps = walkthrough.steps;
  const [idx, setIdx] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [logs, setLogs] = useState<StepLogs>({});
  const [phase, setPhase] = useState<'step' | 'recap' | 'done'>('step');
  const [allSteps, setAllSteps] = useState(false);
  // A step may recolour the shell while it is on screen — today only the interval player, whose
  // whole instruction IS the frame colour. Null means the ordinary walkthrough tone.
  const [chrome, setChrome] = useState<StepChrome | null>(null);

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

  /**
   * Finish is the single write — and journal steps write TWICE by design: the occurrence log gets
   * a receipt ("kept"), and the words themselves go to the journal store where they can be reread.
   * Best-effort and never blocking: a store failure must not cost someone their completed session,
   * and the receipt in the occurrence log survives either way.
   */
  const finish = () => {
    for (const step of steps) {
      const log = logs[step.id];
      if (log?.kind !== 'journal' || !log.note.trim()) continue;
      void keepJournalEntry({
        bank: log.bank,
        prompt: log.prompt,
        body: log.note,
        secret: log.secret,
        mode: 'typed',
      }).catch(() => undefined);
    }
    onComplete(recapSummary(steps, logs));
  };

  if (steps.length === 0 || !step) return null;

  if (phase === 'done') {
    return (
      <WalkthroughDone
        steps={steps}
        logs={logs}
        title={title}
        occurrenceId={occurrenceId}
        onFinish={finish}
        onTalk={onTalk}
      />
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
    <div
      style={{ ...overlay, background: chrome?.tint ?? overlay.background, transition: 'background 0.7s ease' }}
      role="dialog"
      aria-label="Task walkthrough"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: chrome?.ink ?? 'oklch(38% 0.05 60)' }}>
              {shortTitle(title)}
            </div>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: chrome?.sub ?? 'oklch(52% 0.04 62)',
              }}
            >
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
            <div style={{ ...caption, color: chrome?.sub ?? caption.color }}>
              Step {idx + 1} of {steps.length}
            </div>
            <div style={{ ...caption, color: chrome?.sub ?? caption.color }}>{left} min left</div>
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
        ) : step.tool.kind === 'interval' ? (
          // Like a circuit, the interval player owns its whole body — the coach chip and the phase
          // badge replace the shared step header rather than stacking a second one above them.
          <StepInterval
            step={step}
            plan={step.tool.plan}
            log={
              logs[step.id]?.kind === 'interval' ? (logs[step.id] as Extract<StepLog, { kind: 'interval' }>) : undefined
            }
            onLog={(l) => setLog(step.id, l)}
            onDone={next}
            onChrome={setChrome}
          />
        ) : (
          <>
            <StepHeader step={step} />
            <div style={{ marginTop: 18 }}>{renderTool(step, logs, setLog, next, steps[idx + 1]?.title)}</div>
            {/* The metronome rides ALONGSIDE the tool rather than being one, so it is attached here
                — once, under whatever card the step rendered — instead of inside each tool that
                might want it. Circuits and intervals are the two that own their whole body and so
                sit outside this branch; neither is a step anyone practises an instrument to. */}
            {step.metronome && (
              <div style={{ marginTop: 12 }}>
                <Metronome key={step.id} spec={step.metronome} title={step.title} />
              </div>
            )}
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
          log={log?.kind === 'done' ? log : undefined}
          onLog={(l) => setLog(step.id, l)}
        />
      );
  }
}
