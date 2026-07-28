import type { WalkthroughStep } from '@cadence/shared';
import { type StepLogs, stepStatus, minutesLeft } from './state.ts';
import { StatusDisc } from './wt-parts.tsx';
import { TONE } from './tools/tone.ts';
import { sheet, grab, greenBtn, outlineBtn, targetChip, rowReceipt } from './wt-styles.ts';

/**
 * The All-steps sheet (design C) — one of three ways back, all pure navigation. Jump to any step;
 * looking around changes nothing. Review & finish is reachable from here so you can stop early. Rows
 * carry state (done ✓ / passed-over dashed / here-now haloed / untouched) + a receipt second line.
 */
export function AllSteps({
  steps,
  logs,
  idx,
  visited,
  onClose,
  onJump,
  onReview,
}: {
  steps: WalkthroughStep[];
  logs: StepLogs;
  idx: number;
  visited: ReadonlySet<number>;
  onClose: () => void;
  onJump: (i: number) => void;
  onReview: () => void;
}) {
  const done = steps.filter((s, i) => stepStatus(i, idx, visited, s, logs[s.id]) === 'logged').length;
  const skipped = steps.filter((s, i) => stepStatus(i, idx, visited, s, logs[s.id]) === 'skipped').length;
  const left = minutesLeft(steps, idx, visited);
  return (
    <>
      <div
        style={{ position: 'absolute', inset: 0, background: 'oklch(22% 0.03 262 / 0.42)' }}
        onClick={onClose}
        aria-hidden
      />
      <div style={sheet}>
        <div style={grab} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--display), serif', fontWeight: 600, fontSize: 19, color: TONE.ink }}>
            All steps
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', color: TONE.sub }}>
            {done} DONE · {skipped} SKIPPED · {left} MIN LEFT
          </div>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'oklch(45% 0.02 150)', marginTop: 6 }}>
          Jump anywhere. Looking around changes nothing — only the tools log.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            margin: '16px 0 18px',
            maxHeight: '42vh',
            overflowY: 'auto',
          }}
        >
          {steps.map((s, i) => {
            const st = stepStatus(i, idx, visited, s, logs[s.id]);
            const cur = i === idx;
            return (
              <div
                key={s.id}
                onClick={() => onJump(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'white',
                  border: cur
                    ? `1.5px solid ${TONE.fillA}`
                    : st === 'skipped'
                      ? '1px dashed oklch(84% 0.03 85)'
                      : '1px solid oklch(91% 0.015 85)',
                  boxShadow: cur ? '0 0 0 3px oklch(79% 0.16 70 / 0.16)' : undefined,
                  borderRadius: 12,
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <StatusDisc status={st} />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: cur ? 900 : 700,
                      color: st === 'skipped' ? TONE.sub : 'oklch(32% 0.02 150)',
                    }}
                  >
                    {s.title}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cur ? TONE.deep : TONE.sub, marginTop: 1 }}>
                    {rowReceipt(s, logs[s.id], cur, st)}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: TONE.sub }}>
                  {targetChip(s) || `${s.minutes} min`}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={greenBtn} onClick={onClose}>
            Back to {steps[idx]!.title}
          </button>
          <button style={outlineBtn} onClick={onReview}>
            Review &amp; finish ›
          </button>
        </div>
      </div>
    </>
  );
}
