import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  type MetronomeSpec,
  type SessionItemAlternative,
  type Walkthrough as WalkthroughData,
  structureDiff,
} from '@cadence/shared';
import { StepCircuit } from './tools/StepCircuit.tsx';
import { StepGroup } from './tools/StepGroup.tsx';
import { StepInterval, type StepChrome } from './tools/StepInterval.tsx';
import { MetronomeSlot, type StepArea } from './tools/MetronomeSlot.tsx';
import { ChangeFlow } from './tools/ChangeFlow.tsx';
import { RearrangeSheet } from './tools/RearrangeSheet.tsx';
import { HEADER_EDGE, HEADER_INK } from './tools/change-parts.tsx';
import { renderTool } from './renderTool.tsx';
import { changeKey, changeTarget, loadChange, takesLoad, workingLoad } from './changes.ts';
import { TONE } from './tools/tone.ts';
import { Recap } from './Recap.tsx';
import { AllSteps } from './AllSteps.tsx';
import { WalkthroughDone } from './WalkthroughDone.tsx';
import { Pip, StepHeader } from './wt-parts.tsx';
import { overlay, closeBtn, caption, navBtn, shortTitle } from './wt-styles.ts';
import { type StepLog, type StepLogs, stepStatus, stepFraction, minutesLeft, recapSummary } from './state.ts';
import { effectiveLogs, recapView } from './played-recap.ts';
import { usePlayedSession } from './usePlayedSession.ts';
import { keepJournalEntry, settleTempo } from '../../lib/api.ts';
import { clearSessionInProgress, type RunningClock, type SessionSnapshot } from './sessionInProgress.ts';
import { useRememberSession } from './useRememberSession.ts';
import { unregisterClock, useRunningClock } from './runningClock.ts';

/**
 * The task walkthrough (v2 — design "browse / do / commit"). Moving between steps (Back ↔ Next, the
 * pips, or the All-steps sheet) logs NOTHING and loses nothing — only a tool writes a StepLog, and
 * nothing commits until Finish. The header bar is the workout to scale (one pip per step, width = its
 * minutes) and captions where you are; the last step hands to the Recap; Finish is the single write,
 * then a celebration. Free browsing before touching a tool IS the preview — no separate mode.
 *
 * A plan task's walkthrough (one with an `occurrenceId`) is remembered on disk as it goes and
 * forgotten on close or Finish, so the app coming back after iOS reclaimed it reopens the session
 * where it was — step, logs, tempos and a running timer, caught up (sessionInProgress.ts).
 *
 * A running clock lives at app level, not here (runningClock.ts): leaving this screen, switching
 * tab or moving to another step never stops it or its chimes, and the tool for its step opens
 * caught up when it is next on screen. Close and Finish let it go with the session.
 *
 * What the person changes about the session lives beside the prescription, never in it
 * (usePlayedSession.ts): "Change this move" (Phase 5) swaps a move or adds a weight; Rearrange
 * (Phase 6) regroups the sets — alternate two moves, spread a hang through the session — and a
 * regrouped step plays one turn at a time (StepGroup). The Recap reads it all back as facts.
 */
export function Walkthrough({
  walkthrough,
  title,
  occurrenceId,
  area,
  onClose,
  onComplete,
  onTalk,
  resume,
}: {
  walkthrough: WalkthroughData;
  title: string;
  /** The session's goal area. A `practice` session lets the person add a metronome to a step the
   *  coach left plain (MetronomeSlot); absent or any other area, only the coach attaches one. */
  area?: StepArea;
  /** Ties the post-session answer to the session it belongs to. Absent for ad-hoc runs and
   *  previews — the answer is still worth keeping, it just has nothing to hang off. */
  occurrenceId?: string | null;
  onClose: () => void;
  onComplete: (summary: string) => void;
  /** Opens the coach from the celebration's "Talk to me". Omitted → the button isn't shown,
   *  rather than shown and inert. */
  onTalk?: () => void;
  /** The remembered session this one reopens, when the app came back mid-session. */
  resume?: SessionSnapshot | null;
}) {
  const played = usePlayedSession(walkthrough.steps, resume);
  const { changes, change, prescribed, shape, steps, stepOf, turnLogs } = played;
  // The Change sheet, open for one move: a step, one move inside a circuit, or the step a
  // rearranged turn belongs to; starting on the sheet or straight on the weight control.
  const [changing, setChanging] = useState<{
    key: string;
    stepId?: string;
    moveIndex?: number;
    start: 'change' | 'weight';
  } | null>(null);
  const [idx, setIdx] = useState(resume?.idx ?? 0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set(resume?.visited ?? [0]));
  const [logs, setLogs] = useState<StepLogs>(resume?.logs ?? {});
  const [phase, setPhase] = useState<'step' | 'recap' | 'done'>(resume?.phase ?? 'step');
  // The clock that is RUNNING, from the app-level store, so the remembered session can reopen it
  // running. Until a tool has registered one, the remembered clock stands in — on a relaunch the
  // store is empty and the snapshot is what seeds the tool, which registers it on mount.
  const running = useRunningClock();
  const [seed, setSeed] = useState<RunningClock | null>(resume?.clock ?? null);
  useEffect(() => {
    if (running) setSeed(null);
  }, [running]);
  const clock = useMemo<RunningClock | null>(
    () => (running ? { stepId: running.stepId, startedAt: running.startedAt, base: running.base } : seed),
    [running, seed],
  );
  // Closed or finished: the session is forgotten, and the re-render that letting the clock go
  // causes must not write it back.
  const [closed, setClosed] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const [rearranging, setRearranging] = useState(false);
  // A step may recolour the shell while it is on screen — today only the interval player, whose
  // whole instruction IS the frame colour. Null means the ordinary walkthrough tone.
  const [chrome, setChrome] = useState<StepChrome | null>(null);
  // Tempos settled during the session, keyed by STEP TITLE — that is what the server matches a
  // piece on. Held here rather than posted per change so they ride the walkthrough's own commit
  // rule: nothing about a session reaches the store until Finish.
  const [tempos, setTempos] = useState<Record<string, MetronomeSpec>>(resume?.tempos ?? {});

  useRememberSession(
    occurrenceId && !closed
      ? {
          occurrenceId,
          title,
          area,
          walkthrough,
          idx,
          visited: [...visited],
          logs,
          tempos,
          phase,
          clock,
          changes,
          shape,
          turnLogs,
        }
      : null,
  );
  const close = () => {
    setClosed(true);
    unregisterClock();
    clearSessionInProgress();
    onClose();
  };

  const safeIdx = Math.min(idx, steps.length - 1);
  const step = steps[safeIdx];
  // What the pips, the discs and the all-steps rows read: a rearranged group's log comes from its turns.
  const logsView = useMemo(() => effectiveLogs(steps, logs, turnLogs), [steps, logs, turnLogs]);
  const left = minutesLeft(steps, safeIdx, visited);

  // The step body is the one thing that scrolls. A long step read to the bottom used to hand its
  // scroll position to the next step, which then opened with its title and tool off the top
  // (owner, gym session 2026-11-02). Every step change starts at the top.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [idx]);

  // Moving does not touch a running clock: a step you left keeps counting at app level.
  const go = (i: number) => {
    setIdx(i);
    setVisited((v) => new Set(v).add(i));
    setAllSteps(false);
  };
  const toPhase = (p: 'step' | 'recap' | 'done') => setPhase(p);
  const next = () => (safeIdx + 1 < steps.length ? go(safeIdx + 1) : toPhase('recap'));
  const prev = () => safeIdx > 0 && go(safeIdx - 1);
  const setLog = (id: string, log: StepLog) => setLogs((l) => ({ ...l, [id]: log }));
  const swapMove = (key: string, alt: SessionItemAlternative) => {
    change(key, (c) => ({ ...c, swap: alt }));
    setChanging(null);
  };
  // The move the Change sheet is about: a rearranged turn's own step, else the step on screen.
  const changingStep = (changing?.stepId && stepOf(changing.stepId)) || step;
  // "Use bodyweight" on a move whose plan had no load is not a change, so nothing is recorded
  // (changes.ts loadChange); on a move the plan loaded it IS one, and the log line says so.
  const applyLoad = (key: string, load: string) => {
    const plan = changeTarget(changingStep!, changing?.moveIndex, changes, title, logs[changingStep!.id]).tool;
    change(key, (c) => ({ ...c, load: loadChange('load' in plan ? plan.load : undefined, load) }));
    setChanging(null);
  };
  // Rearranging logs nothing and loses nothing: the step in hand stays in hand, wherever its set went.
  const rearranged = (nextShape: typeof shape) => {
    const anchor = played.anchorAt(safeIdx);
    played.setShape(nextShape);
    setRearranging(false);
    setAllSteps(false);
    const after = played.indexOfTurn(played.steps, anchor);
    setIdx(after);
    setVisited((v) => new Set(v).add(after));
  };
  // The Recap and Finish read the session back one row per thing done (played-recap.ts).
  const view = useMemo(() => recapView(prescribed, shape, logs, turnLogs), [prescribed, shape, logs, turnLogs]);
  const diff = useMemo(() => structureDiff(prescribed, shape), [prescribed, shape]);

  /**
   * Finish is the single write — and journal steps write TWICE by design: the occurrence log gets
   * a receipt ("kept"), and the words themselves go to the journal store where they can be reread.
   * Best-effort and never blocking: a store failure must not cost someone their completed session,
   * and the receipt in the occurrence log survives either way.
   */
  const finish = () => {
    for (const s of view.steps) {
      const log = view.logs[s.id];
      if (log?.kind !== 'journal' || !log.note.trim()) continue;
      void keepJournalEntry({
        bank: log.bank,
        prompt: log.prompt,
        body: log.note,
        secret: log.secret,
        mode: 'typed',
      }).catch(() => undefined);
    }
    // The settled tempos go with it: the piece remembers what they actually play it at, and the
    // coach can see it next time she prescribes. Best-effort like the journal write above — the
    // dock's local copy already holds the tempo, so a failed sync costs the sharing, not the tempo.
    if (occurrenceId) {
      for (const [t, tempo] of Object.entries(tempos)) {
        void settleTempo(occurrenceId, { title: t, bpm: tempo.bpm, meter: tempo.meter }).catch(() => undefined);
      }
    }
    setClosed(true);
    unregisterClock();
    clearSessionInProgress();
    onComplete(recapSummary(view.steps, view.logs));
  };

  if (steps.length === 0 || !step) return null;

  if (phase === 'done') {
    return (
      <WalkthroughDone
        steps={view.steps}
        logs={view.logs}
        title={title}
        occurrenceId={occurrenceId}
        onBack={() => toPhase('recap')}
        onFinish={finish}
        onTalk={onTalk}
      />
    );
  }

  if (phase === 'recap') {
    return (
      <Recap
        steps={view.steps}
        logs={view.logs}
        title={title}
        changes={diff}
        occurrenceId={occurrenceId}
        saveSteps={prescribed}
        onBack={() => toPhase('step')}
        onJump={(i) => {
          toPhase('step');
          go(Math.min(i, steps.length - 1));
        }}
        onResolve={setLog}
        onClose={close}
        onFinish={() => toPhase('done')}
      />
    );
  }

  const skipsCircuit = step.tool.kind === 'circuit' && (!step.play || step.play.names.length > 1);

  return (
    <div
      style={{ ...overlay, background: chrome?.tint ?? overlay.background, transition: 'background 0.7s ease' }}
      role="dialog"
      aria-label="Task walkthrough"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={closeBtn} onClick={close} aria-label="Close">
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
                status={stepStatus(i, safeIdx, visited, s, logsView[s.id])}
                fraction={stepFraction(s, logsView[s.id])}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ ...caption, color: chrome?.sub ?? caption.color }}>
              Step {safeIdx + 1} of {steps.length}
            </div>
            <div style={{ ...caption, color: chrome?.sub ?? caption.color }}>{left} min left</div>
          </div>
        </div>
      </div>

      <div
        ref={body}
        data-step-body
        style={{ marginTop: 20, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {step.play ? (
          // A rearranged group — a set on its own, or two moves alternating — plays one turn at a
          // time; Change opens for the turn's own step.
          <StepGroup
            key={step.id}
            step={step}
            stepOf={stepOf}
            workingLoads={Object.fromEntries(step.play.turns.map((t) => [t.stepId, workingLoad(changes, t.stepId)]))}
            turnLogs={turnLogs}
            onLogTurn={played.logTurn}
            onAdvance={next}
            onChange={(stepId) => setChanging({ key: stepId, stepId, start: 'change' })}
            onUndoSwap={(stepId) => change(stepId, (c) => ({ ...c, swap: undefined }))}
          />
        ) : step.tool.kind === 'circuit' ? (
          <StepCircuit
            step={step}
            rounds={step.tool.rounds}
            exercises={step.tool.exercises}
            workingLoads={Object.fromEntries(
              step.tool.exercises.map((_, i) => [i, workingLoad(changes, changeKey(step.id, i))]).filter(([, l]) => l),
            )}
            log={
              logs[step.id]?.kind === 'circuit' ? (logs[step.id] as Extract<StepLog, { kind: 'circuit' }>) : undefined
            }
            onLog={(l) => setLog(step.id, l)}
            onAdvance={next}
            onChange={(i) => setChanging({ key: changeKey(step.id, i), moveIndex: i, start: 'change' })}
            onUndoSwap={(i) => change(changeKey(step.id, i), (c) => ({ ...c, swap: undefined }))}
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
            resumeClock={clock?.stepId === step.id ? clock : null}
            onLog={(l) => setLog(step.id, l)}
            onDone={next}
            onChrome={setChrome}
          />
        ) : (
          <>
            <StepHeader
              step={step}
              workingLoad={workingLoad(changes, step.id)}
              onChange={
                takesLoad(step.tool) || step.alternatives
                  ? () => setChanging({ key: step.id, start: 'change' })
                  : undefined
              }
              onUndoSwap={() => change(step.id, (c) => ({ ...c, swap: undefined }))}
            />
            {/* Keyed by step so each step gets its OWN tool instance. Without the key React reused
                the calf stretch's timer for the hip flexor stretch — same component type, same
                position — and the new step opened with the old step's finished clock: 0:00 left,
                "Resume" (2026-09-06). */}
            <div key={step.id} style={{ marginTop: 18 }}>
              {renderTool(
                step,
                logs,
                setLog,
                next,
                { stepId: step.id, resume: clock?.stepId === step.id ? clock : null },
                workingLoad(changes, step.id),
              )}
            </div>
            {/* Once a weight is on the move, one quiet button reopens the weight control for the set
                in hand (design A, board 2). Logged sets keep the load they were logged at. */}
            {workingLoad(changes, step.id) && (
              <button
                type="button"
                style={changeWeightBtn}
                onClick={() => setChanging({ key: step.id, start: 'weight' })}
              >
                Change weight
              </button>
            )}
            {/* The metronome rides ALONGSIDE the tool rather than being one, so it is attached here
                — once, under whatever card the step rendered — instead of inside each tool that
                might want it. Circuits and intervals are the two that own their whole body and so
                sit outside this branch; neither is a step anyone practises an instrument to. On a
                practice-area step the slot also offers one where the coach attached none. */}
            <MetronomeSlot
              key={`m-${step.id}`}
              step={step}
              area={area}
              onSettle={(t) => setTempos((all) => ({ ...all, [step.title]: t }))}
            />
          </>
        )}
      </div>

      {/* No line explaining the buttons here: the owner ruled out text that covers for the UI
          (2026-11-03). Moving still logs nothing — that is in the component note at the top. */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          style={{ ...navBtn, width: 62, flex: 'none' }}
          onClick={prev}
          disabled={safeIdx === 0}
          aria-label="Previous step"
        >
          ‹
        </button>
        <button style={{ ...navBtn, flex: 1 }} onClick={() => setAllSteps(true)}>
          <span style={{ fontSize: 13, fontWeight: 900, color: 'oklch(32% 0.02 150)' }}>All steps</span>
        </button>
        {skipsCircuit ? (
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

      {changing && changingStep && (
        <ChangeFlow
          key={changing.key}
          target={changeTarget(changingStep, changing.moveIndex, changes, title, logs[changingStep.id])}
          start={changing.start}
          onSwap={(alt) => swapMove(changing.key, alt)}
          onUseLoad={(load) => applyLoad(changing.key, load)}
          onClose={() => setChanging(null)}
        />
      )}
      {allSteps && !rearranging && (
        <AllSteps
          steps={steps}
          shape={shape}
          stepOf={stepOf}
          logs={logsView}
          idx={safeIdx}
          visited={visited}
          onClose={() => setAllSteps(false)}
          onJump={go}
          onReview={() => {
            setAllSteps(false);
            toPhase('recap');
          }}
          onRearrange={() => setRearranging(true)}
          onSplit={(id) => played.splitGroup(id)}
        />
      )}
      {rearranging && (
        <RearrangeSheet steps={prescribed} shape={shape} onDone={rearranged} onClose={() => setRearranging(false)} />
      )}
    </div>
  );
}

const changeWeightBtn: CSSProperties = {
  marginTop: 12,
  height: 48,
  borderRadius: 14,
  border: HEADER_EDGE,
  background: 'oklch(100% 0 0 / 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 900,
  color: HEADER_INK,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
