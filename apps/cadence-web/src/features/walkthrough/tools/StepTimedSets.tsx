import { useEffect, useState } from 'react';
import { secondsText } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE, RING_C, COMMIT } from './tone.ts';
import { CHIME_SWITCH, playChime, playTones, unlockAudio } from './chime.ts';
import { useHandoff } from './useHandoff.ts';
import { useWallClock } from './useWallClock.ts';
import { bookTimerAlarm, cancelTimerAlarm } from './timerAlarm.ts';
import { formatClock } from './timer.ts';
import { card, logBtn as amberBtn, greyBtn, banner, dialBtn } from './timerStyles.ts';
import { SetChips } from './SetChips.tsx';
import type { TimerClock } from './StepTimer.tsx';

type TimedSetsLog = Extract<StepLog, { kind: 'timed_sets' }>;
type Phase = 'idle' | 'running' | 'review';

/**
 * Sets of a timed effort — a carry, a hang, a plank done three times (walkthrough v3 R1, design B;
 * owner rulings 2026-11-03). The `timer` tool with `sets`, played as sets:
 *
 *  • The ring is THIS set's clock, not the set count; the chips under it carry the sets.
 *  • Start runs the clock down to the target and chimes there. It does NOT log or stop: the ring
 *    stays full and goes hashed while the clock keeps counting up ("8 s over") until Stop. A
 *    single hold (StepTimer) still logs itself at its target; a set is only ever logged by Log.
 *  • Stop halts the clock and opens the review: the seconds with − / +, "8 over target" or
 *    "13 under target" in the same off-target colour either way, Reset to the target, then Log
 *    (writes this set) or Keep going (back to the running clock, time carried).
 *  • After Log the next set waits for a Start tap. Rest is not drawn; `rest_sec` is stored for
 *    a later rest clock.
 *  • Switch sides chimes at the halfway point of every set. Tapping a logged chip re-opens it.
 *
 * Time is the wall clock (`useWallClock`), a pocket bell is booked for the target, and a running
 * clock is reported through `onClock` so a remembered session reopens on the same set with the
 * clock caught up (sessionInProgress.ts); the set index is the logged sets, which the session
 * keeps anyway. What the session does not keep: a review in progress — Stop then a dead phone
 * comes back on Start for the same set.
 *
 * Stop and Start only move the clock, so they wear the amber do-tone; Log writes, so it is green;
 * Keep going is the grey of a step back (tools/tone.ts, pinned in commit-tone.test.tsx).
 *
 * `workingLoad` is the weight the person added this session (walkthrough v3 Phase 5): each set
 * logged from then on carries it in `loads`, and the chips show each set's load. `load` stays the plan.
 */
export function StepTimedSets({
  seconds,
  sets,
  load,
  workingLoad,
  chime,
  switchSides = false,
  title,
  log,
  resumeClock,
  onClock,
  onLog,
  onDone,
}: {
  seconds: number;
  sets: number;
  load?: string;
  workingLoad?: string;
  chime: boolean;
  switchSides?: boolean;
  title?: string;
  log?: TimedSetsLog;
  resumeClock?: TimerClock | null;
  onClock?: (clock: TimerClock | null) => void;
  onLog: (l: TimedSetsLog) => void;
  onDone?: () => void;
}) {
  const target = Math.max(1, Math.round(seconds));
  const logged = log?.sets ?? [];
  const [phase, setPhase] = useState<Phase>(resumeClock ? 'running' : 'idle');
  const [base, setBase] = useState(resumeClock?.base ?? 0);
  const [startedAt, setStartedAt] = useState<number | null>(resumeClock?.startedAt ?? null);
  const elapsed = useWallClock(startedAt, base);
  const [dial, setDial] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  // Per-set flags, as state rather than refs: a resumed clock already past its target has to
  // repaint as "over" on its first render, not on the next wall-clock tick.
  const [reached, setReached] = useState(false);
  const [switched, setSwitched] = useState(false);
  const handoff = useHandoff();

  const full = logged.length >= sets;
  const setIndex = editing ?? Math.min(logged.length, sets - 1);
  const running = phase === 'running';
  const over = elapsed - target;
  const isOver = running && reached && over >= 0;

  /** The clock runs from `from` seconds, now. Books the pocket bell for the target still ahead. */
  function run(from: number) {
    const now = Date.now();
    setBase(from);
    setStartedAt(now);
    setPhase('running');
    if (from < target) bookTimerAlarm(now + (target - from) * 1000, title ?? 'Time', formatClock(target));
    onClock?.({ startedAt: now, base: from });
  }

  function start() {
    unlockAudio(); // inside the tap, so the chime at the target — with no finger near the phone — may sound
    if (full) return;
    setReached(false);
    setSwitched(false);
    run(0);
  }

  /** Stop only halts the clock; nothing is written until Log. */
  function stop() {
    unlockAudio();
    setBase(elapsed);
    setStartedAt(null);
    cancelTimerAlarm();
    onClock?.(null);
    setDial(elapsed);
    setPhase('review');
  }

  function keepGoing() {
    unlockAudio();
    run(base);
  }

  const liveLoad = workingLoad ?? load;
  const loadsInPlay = workingLoad != null || log?.loads != null;
  function logSet() {
    const next = logged.slice();
    // Per-set loads, filled with the plan's where none was recorded; an edited set keeps its own.
    const loads = loadsInPlay ? logged.map((_, i) => log?.loads?.[i] ?? load ?? null) : undefined;
    if (editing != null) next[editing] = dial;
    else {
      next.push(dial);
      loads?.push(liveLoad ?? null);
    }
    onLog({
      kind: 'timed_sets',
      sets: next,
      targetSec: target,
      ...(load ? { load } : {}),
      ...(loads ? { loads } : {}),
    });
    const last = editing == null && next.length >= sets;
    setEditing(null);
    setPhase('idle');
    setBase(0);
    setReached(false);
    setSwitched(false);
    if (last && onDone) handoff.schedule(onDone, 700);
  }

  function edit(i: number) {
    if (running) return; // the set in hand keeps its clock
    handoff.cancel(); // re-opening a set inside the hand-off window means stay
    setEditing(i);
    setDial(logged[i]!);
    setPhase('review');
  }

  function back() {
    setEditing(null);
    setPhase('idle');
  }

  // Halfway, for a two-sided carry or hold: a turn-over chime and the banner, once per set.
  useEffect(() => {
    if (!switchSides || !running || switched || elapsed < target / 2) return;
    setSwitched(true);
    if (chime) playTones(CHIME_SWITCH);
    navigator.vibrate?.(30);
  }, [switchSides, running, switched, elapsed, target, chime]);

  // The target: a chime and a buzz, and the clock keeps going. No log, no stop (design B).
  useEffect(() => {
    if (!running || elapsed < target || reached) return;
    setReached(true);
    if (chime) playChime();
    navigator.vibrate?.(60);
    cancelTimerAlarm();
  }, [running, reached, elapsed, target, chime]);

  useEffect(() => () => cancelTimerAlarm(), []);

  const reviewing = phase === 'review';
  const shown = reviewing ? dial : elapsed;
  const frac = Math.min(1, shown / target);
  const hashed = reviewing ? dial > target : isOver;
  const delta = dial - target;
  const showSwitch = switchSides && running && switched && !reached;

  return (
    <div style={card}>
      <div
        style={{ position: 'relative', height: 172, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="172" height="172" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
          <circle cx="64" cy="64" r="54" fill="none" strokeWidth={13} stroke={TONE.track} />
          {frac > 0 && (
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              strokeLinecap="round"
              stroke={hashed ? TONE.deep : TONE.fillA}
              strokeDasharray={`${RING_C * frac} ${RING_C}`}
              transform="rotate(-90 64 64)"
              style={{ transition: running ? 'stroke-dasharray 1s linear' : 'none' }}
            />
          )}
          {/* Past the target the full ring is hashed: a dashed stroke in the off-target colour. */}
          {hashed && (
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              stroke={TONE.off}
              strokeDasharray="5 9"
              transform="rotate(-90 64 64)"
              data-hashed
            />
          )}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={eyebrow}>
            {full && !reviewing ? `Sets logged · ${sets} of ${sets}` : `Set ${setIndex + 1} of ${sets}`}
          </div>
          <div style={{ ...bigNumber, color: TONE.ink }}>
            {reviewing
              ? dial
              : isOver
                ? formatClock(elapsed)
                : running
                  ? formatClock(target - elapsed)
                  : formatClock(target)}
          </div>
          <div style={{ ...eyebrow, color: isOver ? TONE.off : TONE.sub }}>
            {reviewing ? 'seconds' : isOver ? `${over} s over` : `of ${formatClock(target)}`}
          </div>
        </div>
        {reviewing && (
          <>
            <button
              onClick={() => setDial((d) => Math.max(0, d - 1))}
              style={{ ...dialBtn, left: 0 }}
              aria-label="one second less"
            >
              −
            </button>
            <button
              onClick={() => setDial((d) => Math.min(5999, d + 1))}
              style={{ ...dialBtn, right: 0 }}
              aria-label="one second more"
            >
              +
            </button>
          </>
        )}
      </div>

      {showSwitch && <div style={banner}>Switch sides</div>}

      {reviewing && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: delta === 0 ? TONE.green : TONE.off }}>
            {delta === 0 ? 'On target' : delta > 0 ? `${delta} over target` : `${-delta} under target`}
          </span>
          {delta !== 0 && (
            <button style={resetChip} onClick={() => setDial(target)}>
              Reset to {target}
            </button>
          )}
        </div>
      )}

      {reviewing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ ...greyBtn, flex: 'none', padding: '0 14px', fontSize: 13.5 }}
            onClick={editing != null ? back : keepGoing}
          >
            {editing != null ? 'Back' : 'Keep going'}
          </button>
          <button style={{ ...amberBtn, ...COMMIT, flex: 1 }} onClick={logSet}>
            Log
          </button>
        </div>
      ) : (
        <button
          style={{ ...amberBtn, ...(full ? { opacity: 0.62 } : null) }}
          onClick={running ? stop : start}
          disabled={full}
        >
          {full ? `Sets logged · ${sets} of ${sets}` : running ? 'Stop' : 'Start'}
        </button>
      )}

      <SetChips
        count={sets}
        logged={logged.map((s, i) => ({
          label: secondsText(s),
          off: s !== target,
          ...(loadsInPlay ? { sub: log?.loads?.[i] ?? load ?? 'bodyweight' } : {}),
        }))}
        current={
          editing != null
            ? null
            : {
                index: logged.length,
                label: running ? formatClock(elapsed) : reviewing ? secondsText(dial) : undefined,
                ...(loadsInPlay ? { sub: liveLoad ?? 'bodyweight' } : {}),
              }
        }
        onEdit={edit}
      />
    </div>
  );
}

const eyebrow = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase' as const,
  color: TONE.sub,
};
const bigNumber = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 46,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums' as const,
};
const resetChip = {
  height: 32,
  padding: '0 11px',
  border: 'none',
  borderRadius: 999,
  background: 'oklch(97% 0.02 74)',
  fontSize: 12,
  fontWeight: 800,
  color: TONE.chipInk,
  cursor: 'pointer',
};
