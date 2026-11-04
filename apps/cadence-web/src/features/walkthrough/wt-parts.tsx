import type { CSSProperties } from 'react';
import type { WalkthroughStep } from '@cadence/shared';
import { YouTubeLink } from './tools/YouTubeLink.tsx';
import { TONE } from './tools/tone.ts';
import { targetText, videoLabel } from './wt-styles.ts';
import { Cue } from './wt-cue.tsx';
import { ChangeButton, SwappedPill } from './tools/change-parts.tsx';

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

/**
 * The common step header (title, then the target as plain text with the Change button and the video
 * link beside it, then the cue) — everything but circuits and intervals. No TARGET label or box: the
 * design ruling of 2026-11-03. `onChange` draws the Change button (walkthrough v3 Phase 5); a step
 * the person swapped carries the "Swapped from … · Undo" pill above its title. `workingLoad` is the
 * weight they added this session, shown in the target in place of the plan's.
 */
export function StepHeader({
  step,
  workingLoad,
  onChange,
  onUndoSwap,
}: {
  step: WalkthroughStep;
  workingLoad?: string;
  onChange?: () => void;
  onUndoSwap?: () => void;
}) {
  const target = targetText(step, workingLoad);
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {step.swapped_from && onUndoSwap && <SwappedPill from={step.swapped_from} onUndo={onUndoSwap} />}
      <div style={{ fontSize: 21, fontWeight: 800, color: TONE.ink2 }}>{step.title}</div>
      {(target || step.video_query || onChange) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          {target && (
            <span style={{ fontSize: 14, fontWeight: 900, color: TONE.ink, marginRight: 2, whiteSpace: 'nowrap' }}>
              {target}
            </span>
          )}
          {onChange && <ChangeButton onClick={onChange} />}
          {step.video_query && <YouTubeLink query={step.video_query} label={videoLabel(step.tool.kind)} />}
        </div>
      )}
      <Cue text={step.body} />
    </div>
  );
}
