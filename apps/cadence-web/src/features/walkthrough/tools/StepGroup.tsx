import { useState, type CSSProperties } from 'react';
import {
  type PlayedStep,
  type Turn,
  type TurnLog,
  type TurnLogs,
  type WalkthroughStep,
  groupEyebrow,
  groupNick,
  turnChip,
  turnKey,
  turnTarget,
} from '@cadence/shared';
import { TONE, COMMIT } from './tone.ts';
import { YouTubeLink } from './YouTubeLink.tsx';
import { ChangeButton, SwappedPill } from './change-parts.tsx';
import { Cue } from '../wt-cue.tsx';
import { useHandoff } from './useHandoff.ts';
import { StepTimedSets } from './StepTimedSets.tsx';
import { dialBtn } from './timerStyles.ts';

/**
 * A rearranged group, played one turn at a time (walkthrough v3 Phase 6, design board
 * "Playing an alternated pair"): the eyebrow says where you are ("Circuit · Round 1 of 3 ·
 * bench + row"), the current move's name, target, Change and Form, a row of turn chips (Bench R1,
 * Row R1 … — the one in hand amber-edged, done ones green), then the usual tool for this ONE turn:
 * the reps dial with a green Log, or the timed-set clock for a held move. Each turn logs itself by
 * `turnKey`, so a set's log survives any later move of that set. A group of one turn — a set
 * dragged out on its own — is the same screen without the eyebrow or the chips.
 *
 * Logging the last turn hands off to the next step after a beat (useHandoff). "Skip circuit ›"
 * is the shell's footer, as for a prescribed circuit.
 */
export function StepGroup({
  step,
  stepOf,
  workingLoads,
  turnLogs,
  onLogTurn,
  onAdvance,
  onChange,
  onUndoSwap,
}: {
  step: PlayedStep;
  /** The prescribed step a turn belongs to, by id (with the person's swaps applied). */
  stepOf: (id: string) => WalkthroughStep | undefined;
  /** The weight the person added this session, by step id. */
  workingLoads: Record<string, string | undefined>;
  turnLogs: TurnLogs;
  onLogTurn: (turn: Turn, log: TurnLog) => void;
  onAdvance?: () => void;
  onChange?: (stepId: string) => void;
  onUndoSwap?: (stepId: string) => void;
}) {
  const play = step.play;
  const turns = play?.turns ?? [];
  const nextUnlogged = turns.findIndex((t) => !turnLogs[turnKey(t)]);
  const [picked, setPicked] = useState<number | null>(null);
  const pos = picked ?? (nextUnlogged < 0 ? turns.length - 1 : nextUnlogged);
  const turn = turns[pos];
  const handoff = useHandoff();
  const allDone = nextUnlogged < 0;
  if (!play || !turn) return null;
  const member = stepOf(turn.stepId);
  if (!member) return null;
  const target = turnTarget(member);
  const working = workingLoads[turn.stepId];
  const load = working ?? target.load;
  const combined = play.names.length > 1;
  const logged = turnLogs[turnKey(turn)];

  function log(value: number) {
    onLogTurn(turn as Turn, { value, ...(load ? { load } : {}) });
    setPicked(null);
    const remaining = turns.filter((t, i) => i !== pos && !turnLogs[turnKey(t)]);
    if (remaining.length === 0 && onAdvance) handoff.schedule(onAdvance, 700);
  }

  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {combined && (
          <div style={eyebrow}>{groupEyebrow(play.mode, turn.set + 1, play.rounds, groupNick(play.names))}</div>
        )}
        {member.swapped_from && onUndoSwap && (
          <div style={{ marginTop: 6 }}>
            <SwappedPill from={member.swapped_from} onUndo={() => onUndoSwap(member.id)} />
          </div>
        )}
        <div style={{ fontSize: 21, fontWeight: 800, color: TONE.ink2, marginTop: combined ? 3 : 0 }}>
          {member.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          {target.value != null && (
            <span style={{ fontSize: 14, fontWeight: 900, color: TONE.ink, marginRight: 2, whiteSpace: 'nowrap' }}>
              {target.kind === 'seconds' ? `${target.value} s` : target.value}
              {load ? ` × ${load}` : ''}
            </span>
          )}
          {onChange && <ChangeButton onClick={() => onChange(member.id)} />}
          {member.video_query && <YouTubeLink query={member.video_query} label="Form" />}
        </div>
        <Cue text={member.body} />
      </div>

      {combined && (
        <div style={{ marginTop: 14, display: 'flex', gap: 4 }}>
          {turns.map((t, i) => {
            const chip = turnChip(stepOf(t.stepId)?.title ?? t.stepId, t.set);
            const done = !!turnLogs[turnKey(t)];
            const current = i === pos;
            return (
              <button
                key={turnKey(t)}
                type="button"
                onClick={() => {
                  handoff.cancel();
                  setPicked(i);
                }}
                aria-label={`${chip.name} ${chip.round}`}
                aria-current={current ? 'step' : undefined}
                style={{
                  ...chipStyle,
                  background: done ? DONE_BG : current ? 'white' : 'oklch(100% 0 0 / 0.55)',
                  border: `1.5px solid ${current ? TONE.fillA : done ? DONE_EDGE : 'transparent'}`,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: current ? 900 : 800,
                    color: done ? DONE_INK : current ? 'oklch(38% 0.06 62)' : 'oklch(40% 0.02 150)',
                  }}
                >
                  {chip.name}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 900,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: done ? DONE_INK : current ? 'oklch(50% 0.04 62)' : 'oklch(55% 0.015 85)',
                  }}
                >
                  {chip.round}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div key={turnKey(turn)} style={{ marginTop: combined ? 12 : 18 }}>
        {target.kind === 'seconds' ? (
          <StepTimedSets
            seconds={target.value ?? 60}
            sets={1}
            load={target.load}
            workingLoad={working}
            chime
            title={member.title}
            log={logged ? { kind: 'timed_sets', sets: [logged.value], targetSec: target.value ?? 60 } : undefined}
            onLog={(l) => {
              const v = l.sets[l.sets.length - 1];
              if (v != null) log(v);
            }}
          />
        ) : (
          <TurnReps
            target={target.value}
            load={load}
            logged={logged?.value}
            onLog={log}
            allDone={allDone && picked == null}
          />
        )}
      </div>
    </>
  );
}

/** The reps dial for one turn: the number, − / +, "reps · 95 lb", and a green Log. */
function TurnReps({
  target,
  load,
  logged,
  onLog,
  allDone,
}: {
  target?: number;
  load?: string;
  logged?: number;
  onLog: (reps: number) => void;
  allDone: boolean;
}) {
  const [dial, setDial] = useState<number | null>(null);
  const reps = dial ?? logged ?? target ?? 10;
  return (
    <div style={card}>
      <div
        style={{ position: 'relative', height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              fontFamily: 'var(--display), serif',
              fontWeight: 600,
              fontSize: 46,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: TONE.ink,
            }}
          >
            {reps}
          </div>
          <div style={eyebrow}>{load ? `reps · ${load}` : 'reps'}</div>
        </div>
        <button
          onClick={() => setDial(Math.max(0, reps - 1))}
          style={{ ...dialBtn, left: 6 }}
          aria-label="one fewer rep"
        >
          −
        </button>
        <button
          onClick={() => setDial(Math.min(99, reps + 1))}
          style={{ ...dialBtn, right: 6 }}
          aria-label="one more rep"
        >
          +
        </button>
      </div>
      <button
        type="button"
        style={{ ...logBtn, opacity: allDone && logged != null ? 0.62 : 1 }}
        onClick={() => {
          onLog(reps);
          setDial(null);
        }}
      >
        {logged != null ? 'Save' : 'Log'}
      </button>
    </div>
  );
}

const DONE_BG = 'oklch(95% 0.03 152)';
const DONE_EDGE = 'oklch(66% 0.11 152)';
const DONE_INK = 'oklch(42% 0.06 152)';

const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'oklch(45% 0.08 62)',
};
const chipStyle: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  borderRadius: 10,
  padding: '6px 0',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const logBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  ...COMMIT,
};
