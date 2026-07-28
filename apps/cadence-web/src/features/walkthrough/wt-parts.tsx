import type { CSSProperties } from 'react';
import type { WalkthroughStep } from '@cadence/shared';
import { YouTubeLink } from './tools/YouTubeLink.tsx';
import { TONE } from './tools/tone.ts';
import { targetChip, chip } from './wt-styles.ts';

/** One progress-bar pip — width = its step's minutes; state is logged / partial / current / skipped
 *  / untouched, so the bar's shape is the session's shape and a long step can't look like a short one. */
export function Pip({
  flex,
  status,
  fraction,
  onClick,
}: {
  flex: number;
  status: string;
  fraction: number;
  onClick: () => void;
}) {
  const base: CSSProperties = { flex, height: 7, borderRadius: 3, cursor: 'pointer', boxSizing: 'border-box' };
  if (status === 'logged') return <div onClick={onClick} style={{ ...base, background: TONE.deep }} />;
  if (status === 'partial' || status === 'current') {
    const pct = Math.round(fraction * 100);
    const grad = `linear-gradient(90deg, ${TONE.deep} ${pct}%, oklch(100% 0 0 / 0.55) ${pct}%)`;
    return (
      <div
        onClick={onClick}
        style={{
          ...base,
          background: grad,
          boxShadow: status === 'current' ? '0 0 0 2px oklch(63% 0.15 68 / 0.28)' : undefined,
        }}
      />
    );
  }
  if (status === 'skipped')
    return (
      <div
        onClick={onClick}
        style={{ ...base, background: 'oklch(100% 0 0 / 0.5)', border: '1px dashed oklch(70% 0.06 62)' }}
      />
    );
  return <div onClick={onClick} style={{ ...base, background: 'oklch(100% 0 0 / 0.5)' }} />;
}

/** The 18px status disc used by the all-steps sheet and the recap. */
export function StatusDisc({ status }: { status: string }) {
  const box: CSSProperties = { width: 18, height: 18, flex: 'none', borderRadius: '50%', boxSizing: 'border-box' };
  if (status === 'logged')
    return (
      <div
        style={{
          ...box,
          background: TONE.deep,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: 'white',
          fontWeight: 900,
        }}
      >
        ✓
      </div>
    );
  if (status === 'partial')
    return <div style={{ ...box, background: `linear-gradient(90deg, ${TONE.deep} 50%, oklch(92% 0.02 74) 50%)` }} />;
  if (status === 'skipped') return <div style={{ ...box, border: '2px dashed oklch(78% 0.03 85)' }} />;
  if (status === 'current') return <div style={{ ...box, border: `2px solid ${TONE.fillA}` }} />;
  return <div style={{ ...box, border: '2px solid oklch(88% 0.02 85)' }} />;
}

/** The common step header (title + target chip + video + cue) — everything but circuits. */
export function StepHeader({ step }: { step: WalkthroughStep }) {
  const target = targetChip(step);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 21, fontWeight: 800, color: TONE.ink2 }}>{step.title}</div>
      {(target || step.video_query) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 9 }}>
          {target && (
            <div style={chip}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 900,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'oklch(55% 0.04 62)',
                }}
              >
                Target
              </span>
              <span style={{ fontSize: 15, fontWeight: 900, color: TONE.ink }}>{target}</span>
            </div>
          )}
          {step.video_query && <YouTubeLink query={step.video_query} label="How-to" />}
        </div>
      )}
      {step.body && (
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'oklch(45% 0.02 150)', marginTop: 8 }}>{step.body}</div>
      )}
    </div>
  );
}
