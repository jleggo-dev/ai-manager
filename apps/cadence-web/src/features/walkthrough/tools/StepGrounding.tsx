import { useEffect, useState, type CSSProperties } from 'react';
import { type GroundingSpec, groundingLogLine } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE } from './tone.ts';
import { playChime } from './chime.ts';
import { WhatsThis } from './WhatsThis.tsx';
import { markHelpedAsked } from './helped-gate.ts';

type GroundingLog = Extract<StepLog, { kind: 'grounding' }>;

/**
 * Chrome B — the stepped micro-flow (REQ9 §4.3), proven with `grounding`.
 *
 * **Four zones that never move:** spine, prompt, field, forward. A payload may only fill the
 * *field*; zones 1, 2 and 4 are identical for every game, which is what makes this a chrome rather
 * than a screen — chained practices and the stepped programme inherit the same shell later.
 *
 * The constraints that shape it, all from the fact that whoever is using this is **dysregulated**:
 * big targets, nothing to read, no decisions, and **no counts anywhere on screen** (no "3 of 5",
 * no timer digits, no score). It is a *pacing* surface — nothing accepts text, and nothing is ever
 * checked. Leaving is **done, not abandoned**: grounding has no required length, so there is no
 * such thing as a short one, and closing early logs what happened without comment.
 */
export function StepGrounding({
  spec,
  askHelped = true,
  onLog,
  onDone,
}: {
  spec: GroundingSpec;
  /** "Did that help?" is asked at most once a day across all mind surfaces — the caller owns that
   *  gate, because only it can see the other surfaces. */
  askHelped?: boolean;
  onLog: (l: GroundingLog) => void;
  onDone: () => void;
}) {
  // No `log` prop on purpose: leaving a grounding flow IS finishing it, so there is no partial
  // state to restore and re-entering starts fresh rather than resuming a half-walked sweep.
  const [idx, setIdx] = useState(0);
  const [tapped, setTapped] = useState<number[]>([]);
  const [closed, setClosed] = useState(false);
  const [arcElapsed, setArcElapsed] = useState(0);

  const step = spec.steps[idx];
  const total = spec.steps.length;

  // The timed field (`object`) sweeps once and chimes; it is the only step that ends itself.
  useEffect(() => {
    if (!step || step.field !== 'arc' || closed) return undefined;
    const id = setInterval(() => setArcElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [step, closed]);

  useEffect(() => {
    if (step?.field === 'arc' && step.seconds && arcElapsed >= step.seconds && !closed) {
      playChime();
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcElapsed, step, closed]);

  function finish() {
    setClosed(true);
    // Mark on SHOW, not on answer — a person who skips was still asked, and asking again the
    // same day is exactly what the once-a-day rule forbids.
    if (askHelped) markHelpedAsked();
    onLog({
      kind: 'grounding',
      game: spec.game,
      stepsDone: idx + (spec.openEnded ? 0 : 1),
      total,
      openEnded: spec.openEnded,
      helped: null,
    });
  }

  function advance() {
    setTapped([]);
    if (idx + 1 >= total) finish();
    else setIdx(idx + 1);
  }

  function answerHelped(helped: boolean | null) {
    onLog({
      kind: 'grounding',
      game: spec.game,
      stepsDone: spec.openEnded ? idx + 1 : Math.min(idx + 1, total),
      total,
      openEnded: spec.openEnded,
      helped,
    });
    onDone();
  }

  if (closed) {
    return (
      <div style={card}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0' }}>
          {/* Credit is settled BEFORE anything is asked. */}
          <div style={creditLine}>{groundingLogLine(spec.game, idx + 1, total, spec.openEnded)}</div>
          {askHelped && (
            <div style={{ fontSize: 15, fontWeight: 700, color: 'oklch(40% 0.02 150)' }}>Did that help?</div>
          )}
        </div>
        {askHelped ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...forwardBtn, flex: 1 }} onClick={() => answerHelped(true)}>
                Yes
              </button>
              {/* An outline, never a red or a frown — a tool not landing is information. */}
              <button style={{ ...outlineBtn, flex: 1 }} onClick={() => answerHelped(false)}>
                Not really
              </button>
            </div>
            <button style={textBtn} onClick={() => answerHelped(null)}>
              Skip
            </button>
          </div>
        ) : (
          <button style={forwardBtn} onClick={() => answerHelped(null)}>
            Done
          </button>
        )}
      </div>
    );
  }

  if (!step) return null;
  const arcFrac = step.field === 'arc' && step.seconds ? Math.min(1, arcElapsed / step.seconds) : 0;
  const allTapped = step.targets !== undefined && tapped.length >= step.targets;

  return (
    <div style={card}>
      {/* ── Zone 1 · spine. Known-length flows get segments; open-ended ones get a static label,
             never a bar that cannot fill. ── */}
      <div style={spineRow}>
        {spec.openEnded || spec.steps.length < 2 ? (
          <div style={staticLabel}>{spec.label}</div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flex: 1 }}>
            {spec.steps.map((_, i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background:
                    i < idx ? 'oklch(84% 0.09 60)' : i === idx ? 'oklch(84% 0.09 60 / 0.55)' : 'oklch(90% 0.015 85)',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Zone 2 · prompt. One line, no body copy in this chrome. ── */}
      <div style={promptZone}>
        <div style={promptStyle}>{step.prompt}</div>
        {step.instruction && <div style={instructionStyle}>{step.instruction}</div>}
      </div>

      {/* ── Zone 3 · field. The only variable region. ── */}
      <div style={fieldStyle}>
        {step.field === 'targets' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {Array.from({ length: step.targets ?? 0 }, (_, i) => {
              const on = tapped.includes(i);
              return (
                <button
                  key={i}
                  aria-label={on ? 'noticed' : 'tap when you notice one'}
                  onClick={() => setTapped((t) => (t.includes(i) ? t : [...t, i]))}
                  style={on ? targetOn : targetOff}
                />
              );
            })}
          </div>
        )}
        {step.field === 'letter' && (
          <div style={{ textAlign: 'center' }}>
            <div style={bigLetter}>{step.letter}</div>
          </div>
        )}
        {step.field === 'arc' && (
          <svg width="180" height="180" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="44" fill="none" stroke="oklch(93% 0.02 80)" strokeWidth={5} />
            {/* A sweep with no numerals — the redline is explicit that no count appears. */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={TONE.fillA}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={`${276.5 * arcFrac} 276.5`}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray 1s linear' }}
            />
          </svg>
        )}
      </div>

      {/* ── Zone 4 · forward. Always present, always enabled, never moves. ── */}
      <div style={{ display: 'flex', gap: 8 }}>
        {step.secondary && (
          <button style={{ ...outlineBtn, flex: 1 }} onClick={advance}>
            {step.secondary}
          </button>
        )}
        <button
          style={{ ...(step.field === 'arc' ? outlineBtn : forwardBtn), flex: step.secondary ? 1.6 : 1 }}
          onClick={step.field === 'arc' ? finish : advance}
        >
          {step.forward}
        </button>
      </div>

      {/* On the opening card only: whoever just met an unfamiliar game is exactly who needs this,
          and someone three steps into a sweep is not reading. */}
      {idx === 0 && <WhatsThis text={spec.how} />}

      {/* Tapping every target is not required — the forward control is never gated on it. */}
      {step.field === 'targets' && allTapped && <div style={quietNote}>that&apos;s all of them</div>}
    </div>
  );
}

const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minHeight: 380,
};
const spineRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 14 };
const staticLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
const promptStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  lineHeight: 1.15,
  color: TONE.ink,
  textWrap: 'pretty',
};
const instructionStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'oklch(56% 0.03 268)' };
/** Zone 2 is reserved for two prompt lines plus a cue whether or not they're used, and zone 3 is a
 *  fixed block — together they keep zone 4 at exactly the same y for every payload, which is what
 *  the redline means by "position and height never do [change]". */
const promptZone: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  textAlign: 'center',
  minHeight: 84,
  justifyContent: 'flex-start',
};
const fieldStyle: CSSProperties = {
  height: 190,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
/** Targets are never smaller than 80px — this is used by someone who is not steady. */
const targetBase: CSSProperties = { width: 80, height: 80, borderRadius: '50%', cursor: 'pointer', border: 'none' };
const targetOff: CSSProperties = {
  ...targetBase,
  background: 'transparent',
  border: '2px dashed oklch(86% 0.02 85)',
};
const targetOn: CSSProperties = {
  ...targetBase,
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 52%)`,
  boxShadow: `0 6px 0 ${TONE.deep}`,
};
const bigLetter: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 120,
  lineHeight: 1,
  color: TONE.ink,
};
const forwardBtn: CSSProperties = {
  border: 'none',
  borderRadius: 18,
  padding: '20px 0',
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)`,
  boxShadow: `0 5px 0 ${TONE.deep}`,
};
const outlineBtn: CSSProperties = {
  border: '1.5px solid oklch(88% 0.02 85)',
  background: 'white',
  borderRadius: 18,
  padding: '20px 0',
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};
const textBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 6,
  fontSize: 13,
  fontWeight: 800,
  color: 'oklch(55% 0.02 150)',
  cursor: 'pointer',
};
const creditLine: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: 'oklch(48% 0.03 268)',
};
const quietNote: CSSProperties = {
  textAlign: 'center',
  fontSize: 11.5,
  fontWeight: 700,
  color: 'oklch(58% 0.02 150)',
  marginTop: -8,
};
