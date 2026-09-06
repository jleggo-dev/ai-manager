import { useEffect, useRef, useState } from 'react';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';
import { CHIME_SWITCH, playChime, playTones, unlockAudio } from './chime.ts';
import { useHandoff } from './useHandoff.ts';
import { useHandsFree, type HandsFreeCommand } from './useHandsFree.ts';
import { useWallClock } from './useWallClock.ts';
import { bookTimerAlarm, cancelTimerAlarm } from './timerAlarm.ts';
import { HandsFree } from './HandsFree.tsx';
import { card, logBtn, greyBtn, secBtn, chimeOnStyle, footnote, banner, doneRow, minutesInput } from './timerStyles.ts';

type TimerLog = Extract<StepLog, { kind: 'timer' }>;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const minutesOf = (s: number) => Math.round(s / 60) || 1;
const PREROLL = 5;
const TIMER_COMMANDS: HandsFreeCommand[] = ['start', 'pause', 'restart'];

/**
 * Timer tool (walkthrough v2, design E) — the ring is the clock (one continuous arc), the centre
 * counts m:ss down. Start hands to a **5 s grey pre-roll** (design B3): a cool-grey sweep counting
 * 5→1 with "Get in position", because the phone is on the floor by second two; pre-roll seconds are
 * never logged. At zero the ring resets to full and turns tone, the real clock runs. One tone button
 * toggles Start ⇄ (Skip the count) ⇄ Pause; +1 min / Reset / Chime sit below.
 *
 * Time is kept by the WALL CLOCK (`useWallClock`), so leaving the app mid-ruck loses nothing, and
 * a native alarm is booked for the target so the bell rings from a pocket.
 *
 * Two shapes, decided by the step (step-cues.ts):
 *  • a HOLD — reaching the target chimes, logs the full duration and hands off to the next step
 *    without a tap (see `useHandoff`); Reset inside that window keeps you here.
 *  • an EFFORT (`openEnded`) — reaching the target chimes and logs, but the clock KEEPS RUNNING
 *    over, and "Stop" logs the time actually spent. A 50-minute ruck that ran to 110 is logged
 *    as 110, not 50.
 * `switchSides` adds a chime and a visible cue at the halfway point. "Did it already" logs a
 * session done off the phone — a ruck with the watch, a walk without the app — at the minutes
 * you name. Pause captures partial elapsed (recap shows partial, not skipped); Resume skips the
 * pre-roll.
 */
export function StepTimer({
  seconds,
  chime,
  openEnded = false,
  switchSides = false,
  title,
  nextTitle,
  log,
  onLog,
  onDone,
}: {
  seconds: number;
  chime: boolean;
  openEnded?: boolean;
  switchSides?: boolean;
  title?: string;
  nextTitle?: string;
  log?: TimerLog;
  onLog: (l: TimerLog) => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'preroll' | 'running'>('idle');
  const [preroll, setPreroll] = useState(PREROLL);
  // The clock: `base` is what was done before the current run; `startedAt` the instant it began.
  const [base, setBase] = useState(log?.done ? log.elapsedSec : (log?.elapsedSec ?? 0));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const elapsed = useWallClock(startedAt, base);
  const [chimeOn, setChimeOn] = useState(chime);
  const [didIt, setDidIt] = useState(false);
  const [didItMin, setDidItMin] = useState(String(minutesOf(seconds)));
  const finished = useRef(log?.done ?? false);
  const switched = useRef(false);
  const handoff = useHandoff();
  const [voiceOn, setVoiceOn] = useState(false);
  const remaining = Math.max(0, seconds - elapsed);
  const over = elapsed - seconds;

  /** Start the clock from `base` — now, from the wall clock. Books the pocket bell. */
  function run() {
    const now = Date.now();
    setStartedAt(now);
    setPhase('running');
    if (base < seconds) bookTimerAlarm(now + (seconds - base) * 1000, title ?? 'Time', mmss(seconds));
  }

  /** Stop the clock at `at` seconds, keeping them. */
  function halt(at: number) {
    setBase(at);
    setStartedAt(null);
    setPhase('idle');
    cancelTimerAlarm();
  }

  useEffect(() => {
    if (phase !== 'preroll') return undefined;
    if (preroll <= 0) {
      run();
      if (chimeOn) playChime();
      return undefined;
    }
    const id = setTimeout(() => setPreroll((p) => p - 1), 1000);
    return () => clearTimeout(id);
  });

  // Halfway, for a two-sided hold: the ear gets a turn-over chime, the eye gets the banner.
  useEffect(() => {
    if (!switchSides || phase !== 'running' || switched.current || elapsed < seconds / 2) return;
    switched.current = true;
    if (chimeOn) playTones(CHIME_SWITCH);
    navigator.vibrate?.(30);
  }, [switchSides, phase, elapsed, seconds, chimeOn]);

  useEffect(() => {
    if (phase !== 'running' || elapsed < seconds || finished.current) return;
    finished.current = true;
    if (chimeOn) playChime();
    navigator.vibrate?.(60);
    cancelTimerAlarm();
    onLog({ kind: 'timer', elapsedSec: seconds, targetSec: seconds, done: true });
    // An effort keeps the clock running; a hold stops here and moves on.
    if (openEnded) return;
    halt(seconds);
    handoff.schedule(onDone, 600);
  });

  // Whatever is booked on the notification centre dies with the tool.
  useEffect(() => () => cancelTimerAlarm(), []);

  function reset() {
    handoff.cancel(); // Reset inside the 600 ms hand-off means stay here, don't move on.
    halt(0);
    finished.current = false;
    switched.current = false;
  }

  /** The effort's own ending: stop the clock and log the time actually spent. */
  function stop() {
    halt(elapsed);
    onLog({ kind: 'timer', elapsedSec: elapsed, targetSec: seconds, done: true });
    handoff.schedule(onDone, 600);
  }

  /** Done off the phone — log the minutes named, then move on. */
  function logDidIt() {
    const min = Math.max(1, Math.round(Number(didItMin) || minutesOf(seconds)));
    finished.current = true;
    halt(min * 60);
    onLog({ kind: 'timer', elapsedSec: min * 60, targetSec: seconds, done: true });
    handoff.schedule(onDone, 600);
  }

  function primary() {
    unlockAudio(); // inside the gesture, so the chimes a minute from now are allowed to sound
    if (phase === 'running') {
      if (finished.current) return stop();
      halt(elapsed);
      onLog({ kind: 'timer', elapsedSec: elapsed, targetSec: seconds, done: false });
    } else if (phase === 'preroll') {
      run(); // skip the count
    } else if (base > 0) {
      run(); // resume — no pre-roll
    } else {
      setPreroll(PREROLL);
      setPhase('preroll');
    }
  }

  // No "skip" here: a countdown is one phase, so there is nothing to skip TO. Offering the word
  // and then ignoring it is worse than not offering it (see useHandsFree's `accepted`).
  const voice = useHandsFree(
    voiceOn,
    (command: HandsFreeCommand) => {
      if (command === 'restart') reset();
      else if (command === 'pause') {
        if (phase === 'running') primary();
      } else if (phase !== 'running') primary();
    },
    TIMER_COMMANDS,
  );

  const isPre = phase === 'preroll';
  const isOver = phase === 'running' && finished.current && over >= 0;
  const frac = isPre ? preroll / PREROLL : seconds > 0 ? Math.min(1, elapsed / seconds) : 0;
  const showSwitch = switchSides && phase === 'running' && switched.current && !finished.current;

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            position: 'relative',
            width: 190,
            height: 190,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="190" height="190" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              stroke={isPre ? 'oklch(94% 0.015 85)' : TONE.track}
            />
            {frac > 0 && (
              <circle
                cx="64"
                cy="64"
                r="54"
                fill="none"
                strokeWidth={13}
                strokeLinecap="round"
                stroke={isPre ? 'oklch(78% 0.008 250)' : isOver ? TONE.deep : TONE.fillA}
                strokeDasharray={`${RING_C * frac} ${RING_C}`}
                transform="rotate(-90 64 64)"
                style={{ transition: isPre ? 'none' : 'stroke-dasharray 1s linear' }}
              />
            )}
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div
              style={{
                fontFamily: 'var(--display), serif',
                fontWeight: 600,
                fontSize: isPre ? 44 : 46,
                lineHeight: 1,
                color: isPre ? 'oklch(55% 0.02 150)' : TONE.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isPre ? preroll : isOver ? `+${mmss(over)}` : mmss(remaining)}
            </div>
            {!isPre && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: '0.09em',
                  textTransform: 'uppercase',
                  color: TONE.sub,
                }}
              >
                {isOver ? `past ${mmss(seconds)}` : `left of ${mmss(seconds)}`}
              </div>
            )}
          </div>
        </div>
        {isPre && (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: TONE.sub,
                whiteSpace: 'nowrap',
              }}
            >
              Get in position
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: TONE.sub, marginTop: 3, whiteSpace: 'nowrap' }}>
              {mmss(seconds)} starts when the grey runs out
            </div>
          </div>
        )}
        {showSwitch && <div style={banner}>Switch sides</div>}
        {isOver && (
          <div style={{ ...banner, background: 'oklch(96% 0.035 62)' }}>Time&apos;s up — keep going or stop</div>
        )}
      </div>

      <button style={isPre ? greyBtn : logBtn} onClick={primary}>
        {isOver
          ? `Stop · log ${minutesOf(elapsed)} min`
          : phase === 'running'
            ? 'Pause'
            : isPre
              ? 'Skip the count · start now'
              : base > 0
                ? 'Resume'
                : `Start · ${minutesOf(seconds)} min`}
      </button>

      {!isPre && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={secBtn} onClick={() => setBase((b) => Math.max(0, b - 60))}>
            +1 min
          </button>
          <button style={secBtn} onClick={reset}>
            Reset
          </button>
          <button style={{ ...secBtn, ...(chimeOn ? chimeOnStyle : null) }} onClick={() => setChimeOn((v) => !v)}>
            {chimeOn ? '🔔 Chime' : 'Chime off'}
          </button>
        </div>
      )}

      {phase === 'idle' && base === 0 && !finished.current && (
        <div style={doneRow}>
          {didIt ? (
            <>
              <input
                style={minutesInput}
                inputMode="numeric"
                aria-label="Minutes done"
                value={didItMin}
                onChange={(e) => setDidItMin(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              />
              <span style={{ fontSize: 12, fontWeight: 800, color: TONE.sub }}>min</span>
              <button style={{ ...secBtn, flex: 'none', padding: '10px 14px' }} onClick={logDidIt}>
                Log it done
              </button>
            </>
          ) : (
            <button style={{ ...secBtn, border: 'none', padding: 4 }} onClick={() => setDidIt(true)}>
              Did it already — log it without the clock
            </button>
          )}
        </div>
      )}

      <HandsFree state={voice} on={voiceOn} onToggle={() => setVoiceOn((v) => !v)} />

      <div style={footnote}>
        {openEnded
          ? `Chimes at ${minutesOf(seconds)} min and keeps counting — stop it when you're done and it logs the time you actually did${nextTitle ? `, then moves to ${nextTitle}` : ''}.`
          : `Logs ${minutesOf(seconds)} min and ${nextTitle ? `moves to ${nextTitle} on its own` : 'moves on'} when it ends.`}
        {switchSides ? ' Chimes halfway to switch sides.' : ''} Pausing keeps the time you&apos;ve done.
      </div>
    </div>
  );
}
