import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  INTERVAL_HOW,
  expandIntervalPhases,
  intervalShorthand,
  intervalTotalSeconds,
  positionAt,
  type IntervalPlan,
  type WalkthroughStep,
} from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { INTERVAL_KIND, RING_C, TONE } from './tone.ts';
import { CHIME_DONE, CHIME_RECOVER, CHIME_WORK, playTones } from './chime.ts';
import { formatClock } from './timer.ts';
import { ringSegments } from './intervalRing.ts';
import { useIntervalClock } from './useIntervalClock.ts';
import { useHandsFree, type HandsFreeCommand } from './useHandsFree.ts';
import { useHandoff } from './useHandoff.ts';
import { HandsFree } from './HandsFree.tsx';
import { IntervalEditSheet } from './IntervalEditSheet.tsx';
import { WhatsThis } from './WhatsThis.tsx';

type IntervalLog = Extract<StepLog, { kind: 'interval' }>;

const PREROLL = 5;
const RING_PX = 232;

type Status = 'idle' | 'preroll' | 'live' | 'paused' | 'done';

/** The frame colours a step can claim from the walkthrough shell while it is on screen. */
export interface StepChrome {
  tint: string;
  ink: string;
  sub: string;
}

/**
 * The interval player (interval design A/B) — **one timer that changes colour**.
 *
 * One press of Start runs the whole thing: warm-up → (work / recover) × rounds → cool-down, phases
 * handing over on their own with a chime and a full-frame colour change. This is StepTimer's
 * auto-advance generalised from one phase to a list, and the design rules that follow from "the
 * phone is on the floor, three metres away":
 *
 *   • **the frame is the instruction.** Amber means push, green means breathe, grey means neither.
 *     Colour plus the chime carry the whole message; the numbers are confirmation, not the signal.
 *   • **the ring is the session, not the phase** — one wedge per phase, sized by its seconds, so a
 *     long warm-up is a long wedge and the pattern ahead is readable before you start.
 *   • **the whole ring is a button.** Mid-burpee nobody aims at a 50px target, so 232px of ring is
 *     pause/resume, and hands-free voice is the third layer on top of that.
 *   • **the primary never changes colour.** Colour-codes the state, never the controls — a pause
 *     button that turns green would read as a different button.
 *   • **the log is honest.** Pausing out early logs the rounds actually finished, never the
 *     prescription, and seconds jumped with "Skip phase" are not counted as done.
 *
 * Position is a pure function of elapsed time (`positionAt`), so a backgrounded tab resumes in the
 * right phase rather than however many ticks behind it fell.
 */
export function StepInterval({
  step,
  plan: prescribed,
  log,
  onLog,
  onDone,
  onChrome,
}: {
  step: WalkthroughStep;
  plan: IntervalPlan;
  log?: IntervalLog;
  onLog: (l: IntervalLog) => void;
  onDone: () => void;
  /** Hand the current phase's colours up to the walkthrough shell. The background swap is the
   *  loudest signal this tool has and it only works if it covers the whole screen — and the
   *  header's captions have to come with it, or a green frame with amber captions reads as a bug. */
  onChrome?: (c: StepChrome | null) => void;
}) {
  // The edit sheet's changes apply to TODAY's occurrence only — the coach's plan stays the thing
  // "tap to reset" restores, and tomorrow's prescription is still the coach's call.
  const [plan, setPlan] = useState<IntervalPlan>(prescribed);
  // Coming back to a step you left mid-workout resumes where you were, paused — the same promise
  // the shell makes everywhere else ("Back and Next only move you — nothing is logged or lost").
  const [status, setStatus] = useState<Status>(() =>
    log ? (log.roundsDone >= log.totalRounds ? 'done' : 'paused') : 'idle',
  );
  const [preroll, setPreroll] = useState(PREROLL);
  const [chimeOn, setChimeOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Seconds jumped past with "Skip phase ›". Subtracted from the log — you didn't do them. */
  const [skipped, setSkipped] = useState(0);
  /**
   * Rounds whose WORK phase was cut short with "Skip phase ›" — they don't count as done.
   * Deliberately only the work phase: cutting a recover short means "I'm ready, go", and the
   * effort still happened. Without this, skipping straight through a run would log "8 × 20/10 ·
   * done", which is the exact opposite of the honesty this tool promises.
   */
  const [skippedWork, setSkippedWork] = useState<readonly number[]>([]);
  const finished = useRef(status === 'done');
  const lastPhase = useRef(-1);
  const handoff = useHandoff();

  const { elapsed, start, pause, reset, seek } = useIntervalClock(log?.elapsedSec ?? 0);
  const phases = useMemo(() => expandIntervalPhases(plan), [plan]);
  const total = useMemo(() => intervalTotalSeconds(plan), [plan]);
  const at = positionAt(phases, elapsed);
  const kind = INTERVAL_KIND[status === 'done' ? 'neutral' : at.phase.kind];
  const spent = Math.max(0, Math.min(total, elapsed) - skipped);
  const roundsDone = Math.max(0, at.roundsDone - skippedWork.filter((r) => r <= at.roundsDone).length);

  const emit = (done: boolean) =>
    onLog({
      kind: 'interval',
      roundsDone,
      totalRounds: plan.rounds,
      elapsedSec: Math.round(done ? total - skipped : spent),
      targetSec: total,
      shorthand: intervalShorthand(plan),
    });

  /* ── the grey pre-roll, only when there is no warm-up to serve as one ── */
  useEffect(() => {
    if (status !== 'preroll') return undefined;
    if (preroll <= 0) {
      setStatus('live');
      start();
      if (chimeOn) playTones(CHIME_WORK);
      return undefined;
    }
    const id = setTimeout(() => setPreroll((p) => p - 1), 1000);
    return () => clearTimeout(id);
  }, [status, preroll, chimeOn, start]);

  /* ── the handover chime, fired on the phase INDEX changing (so a skip sounds like a handover
        too). The first index seen after starting is never chimed: starting already announced
        itself, and a second note half a beat later reads as a stutter. ── */
  useEffect(() => {
    if (status !== 'live' || at.done) return;
    if (lastPhase.current === at.index) return;
    const first = lastPhase.current === -1;
    lastPhase.current = at.index;
    if (chimeOn && !first) playTones(at.phase.kind === 'work' ? CHIME_WORK : CHIME_RECOVER);
  }, [status, at.index, at.done, at.phase.kind, chimeOn]);

  /* ── completion: chime, log the full run, hand on like every other timer ── */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const emitRef = useRef(emit);
  emitRef.current = emit;
  useEffect(() => {
    if (status !== 'live' || !at.done || finished.current) return;
    finished.current = true;
    pause();
    setStatus('done');
    if (chimeOn) playTones(CHIME_DONE);
    emitRef.current(true);
    // Never `return () => clearTimeout(...)` here — see useHandoff for why that cancels itself.
    handoff.schedule(() => onDoneRef.current(), 600);
  }, [status, at.done, chimeOn, pause, handoff]);

  /* ── the frame colours, handed to the shell; released when the step goes away ── */
  useEffect(() => {
    onChrome?.({ tint: kind.tint, ink: kind.headInk, sub: kind.headSub });
  }, [kind, onChrome]);
  useEffect(() => () => onChrome?.(null), [onChrome]);

  function startOrPause() {
    if (status === 'live') {
      pause();
      setStatus('paused');
      emit(false);
    } else if (status === 'preroll') {
      setStatus('live');
      start();
    } else if (status === 'done') {
      restart();
    } else if (elapsed > 0) {
      setStatus('live');
      start();
    } else if (plan.warmupSec > 0) {
      // The warm-up IS the time to get in position; a grey count on top of it would be one wait too many.
      setStatus('live');
      start();
      if (chimeOn) playTones(CHIME_WORK);
    } else {
      setPreroll(PREROLL);
      setStatus('preroll');
    }
  }

  function restart() {
    // Restart inside the 600 ms hand-off means stay here — don't move on to the next step.
    handoff.cancel();
    finished.current = false;
    lastPhase.current = -1;
    setSkipped(0);
    setSkippedWork([]);
    reset();
    setStatus('idle');
  }

  /** Jump to the next phase boundary. "+1 min" has no meaning mid-interval; this does. */
  function skipPhase() {
    if (status === 'done') return;
    setSkipped((s) => s + at.remaining);
    if (at.phase.kind === 'work' && at.phase.round != null && at.remaining > 0) {
      const round = at.phase.round;
      setSkippedWork((rs) => (rs.includes(round) ? rs : [...rs, round]));
    }
    seek(Math.min(total, elapsed + at.remaining));
  }

  const voice = useHandsFree(voiceOn, (command: HandsFreeCommand) => {
    if (command === 'restart') restart();
    else if (command === 'skip') skipPhase();
    else if (command === 'pause') {
      if (status === 'live') startOrPause();
    } else if (status !== 'live') startOrPause();
  });

  const isPre = status === 'preroll';
  const isDone = status === 'done';
  const paused = status === 'paused';
  const segments = ringSegments(phases, at.index, isPre || status === 'idle' ? 0 : at.progress, isDone);

  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
        <div style={{ ...badge, background: kind.badge }}>
          <ClockGlyph />
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Intervals
          </span>
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, color: TONE.ink2 }}>{step.title}</div>
        <div style={coachChip}>
          {/* The chip states the run that will actually play. Once someone edits it, calling those
              numbers "coach set" would put words in the coach's mouth — so the label moves to
              "Your set" and the reset back to the prescription lives in the sheet. */}
          <span style={coachLabel}>{plan === prescribed ? 'Coach set' : 'Your set'}</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: TONE.ink }}>{intervalShorthand(plan)}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'oklch(55% 0.04 62)' }}>· {formatClock(total)}</span>
          {/* Pause first: a mid-set fumble must not be able to rewrite the plan. */}
          {(status === 'idle' || paused || isDone) && (
            <button style={editLink} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div
          style={{ ...stage, cursor: isPre ? 'default' : 'pointer' }}
          onClick={isPre ? undefined : startOrPause}
          role="button"
          tabIndex={0}
          aria-label={status === 'live' ? 'Pause' : 'Start'}
          onKeyDown={(e) => e.key === 'Enter' && startOrPause()}
          title="Tap anywhere on the ring to pause / resume"
        >
          <svg width={RING_PX} height={RING_PX} viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
            {isPre ? (
              <>
                <circle cx="64" cy="64" r="54" fill="none" strokeWidth={12} stroke="oklch(94% 0.015 85)" />
                <circle
                  cx="64"
                  cy="64"
                  r="54"
                  fill="none"
                  strokeWidth={12}
                  strokeLinecap="round"
                  stroke="oklch(78% 0.008 250)"
                  strokeDasharray={`${RING_C * (preroll / PREROLL)} ${RING_C}`}
                  transform="rotate(-90 64 64)"
                />
              </>
            ) : (
              segments.map((s) => (
                <circle
                  key={s.key}
                  cx="64"
                  cy="64"
                  r="54"
                  fill="none"
                  strokeWidth={12}
                  strokeLinecap="round"
                  stroke={s.stroke}
                  strokeDasharray={s.dash}
                  strokeDashoffset={s.offset}
                  transform="rotate(-90 64 64)"
                  style={s.animated ? { transition: 'stroke-dasharray 1s linear' } : undefined}
                />
              ))
            )}
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ ...eyebrow, color: isPre ? TONE.sub : kind.deep }}>
              {isPre ? 'Get in position' : isDone ? 'All done' : paused ? `Paused · ${at.phase.label}` : at.phase.label}
            </div>
            {/* Always occupies its line so the countdown doesn't jump between phases, but empty
                on warm-up and cool-down — they sit outside the rounds, and a screen reader must
                not announce "round 1 of 5" during a warm-up that belongs to no round. */}
            <div style={{ ...roundLine, minHeight: 13 }}>
              {at.phase.round && !isDone && !isPre ? `Round ${at.phase.round} of ${plan.rounds}` : ''}
            </div>
            <div style={{ ...numeral, opacity: paused ? 0.62 : 1 }}>
              {isPre ? String(preroll) : formatClock(isDone ? 0 : at.remaining)}
            </div>
            {/* Blank during the pre-roll: this line lives inside a 232px ring, and the pre-roll's
                sentence is a full one — it goes under the ring instead of across the wedges. */}
            <div style={nextLine}>{isPre ? '' : nextLabel(at.next, isDone, paused)}</div>
          </div>
        </div>

        {isPre && (
          <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 800, color: TONE.sub }}>
            {formatClock(total)} starts when the grey runs out
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={metric}>{formatClock(isDone ? total : elapsed)}</span>
            <span style={metricCaps}>elapsed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={metricCaps}>left</span>
            <span style={metric}>{formatClock(isDone ? 0 : total - elapsed)}</span>
          </div>
        </div>

        <button style={isPre ? greyBtn : primaryBtn} onClick={startOrPause}>
          {primaryLabel(status, total, total - elapsed)}
        </button>

        {!isPre && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={secBtn} onClick={restart}>
              Restart
            </button>
            <button style={secBtn} onClick={skipPhase} disabled={isDone}>
              Skip phase&nbsp;›
            </button>
            <button style={{ ...secBtn, ...(chimeOn ? chimeOnStyle : null) }} onClick={() => setChimeOn((v) => !v)}>
              {chimeOn ? '🔔 Chime' : 'Chime off'}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 11 }}>
        <HandsFree state={voice} on={voiceOn} onToggle={() => setVoiceOn((v) => !v)} />
      </div>

      {status === 'idle' && (
        <div style={{ marginTop: 10 }}>
          <WhatsThis text={INTERVAL_HOW} />
        </div>
      )}

      {editing && (
        <IntervalEditSheet
          plan={plan}
          coachPlan={prescribed}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            setPlan(next);
            setEditing(false);
            restart();
          }}
        />
      )}
    </>
  );
}

/** "Next · recover 0:20" — the handover is never a surprise. */
function nextLabel(
  next: { kind: string; label: string; seconds: number } | undefined,
  isDone: boolean,
  paused: boolean,
): string {
  // Short by necessity: this line sits INSIDE a 232px ring, so anything conversational bleeds over
  // the wedges. The eyebrow and the primary carry the detail ("All done", "Logged 0:30 ✓").
  if (isDone) return 'Moving on…';
  if (paused) return 'Paused';
  if (!next) return 'Last phase';
  return `Next · ${next.kind === 'neutral' ? next.label.toLowerCase() : next.kind} ${formatClock(next.seconds)}`;
}

/** The button names the state as well as the action, so a glance answers "am I running?". */
function primaryLabel(status: Status, total: number, left: number): string {
  if (status === 'done') return `Logged ${formatClock(total)} ✓`;
  if (status === 'live') return 'Pause';
  if (status === 'preroll') return 'Skip the count · start now';
  if (status === 'paused') return `Resume · ${formatClock(left)} left`;
  return `Start · ${formatClock(total)}`;
}

function ClockGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 3v3" />
      <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      <path d="M12 13l3-3" />
    </svg>
  );
}

const badge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'white',
  borderRadius: 999,
  padding: '5px 12px',
  transition: 'background 0.7s ease',
};
const coachChip: CSSProperties = {
  background: 'oklch(100% 0 0 / 0.7)',
  border: '1px solid oklch(86% 0.04 66)',
  borderRadius: 12,
  padding: '7px 11px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
};
const coachLabel: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'oklch(55% 0.04 62)',
};
const editLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 11,
  fontWeight: 900,
  color: 'oklch(45% 0.09 152)',
  cursor: 'pointer',
};
const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 16,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const stage: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  height: RING_PX,
};
const eyebrow: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  transition: 'color 0.7s ease',
};
const roundLine: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
/** The biggest numeral in the app — this is the phone-on-the-floor screen. */
const numeral: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 56,
  lineHeight: 1,
  color: TONE.ink,
  fontVariantNumeric: 'tabular-nums',
};
const nextLine: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: TONE.sub,
  textAlign: 'center',
  // The ring's inner clearance at r=54 / stroke 12. Anything longer wraps inside the ring rather
  // than running out across the wedges.
  maxWidth: 156,
  lineHeight: 1.25,
};
const metric: CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(32% 0.02 150)',
  fontVariantNumeric: 'tabular-nums',
};
const metricCaps: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
const primaryBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)`,
  boxShadow: `0 5px 0 ${TONE.deep}`,
};
const greyBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(42% 0.02 150)',
  cursor: 'pointer',
  background: 'linear-gradient(180deg, oklch(96% 0.008 85) 0%, oklch(93% 0.01 85) 46%)',
  boxShadow: '0 5px 0 oklch(87% 0.015 85)',
};
const secBtn: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  background: 'white',
  border: '1.5px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '10px 0',
  fontSize: 12,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};
const chimeOnStyle: CSSProperties = {
  background: 'oklch(97% 0.02 74)',
  border: '1.5px solid oklch(86% 0.04 66)',
  color: TONE.chipInk,
};
