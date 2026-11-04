import type { CSSProperties } from 'react';
import { type PlayedShape, type PlayedStep, type WalkthroughStep, isCombined, secondsText } from '@cadence/shared';
import { type StepLog, type StepLogs, stepStatus, stepFraction, minutesLeft } from './state.ts';
import { sheetScrim, sheetFrame, sheetGrab } from './tools/sheet-styles.ts';
import { Pill, RowFrame } from './tools/rearrange-parts.tsx';
import { groupPills, groupWords } from './tools/rearrange-words.ts';
import { pillRow, rowMeta, rowTitle, splitBtn } from './tools/rearrange-styles.ts';
import { outlineBtn } from './wt-styles.ts';

/**
 * The All-steps sheet (walkthrough v3 Phase 6, design board "All steps"): every row is a group
 * of sets and every pill one set, in the order you'll do them. Tap a row to jump; looking around
 * changes nothing. A done row is oat with green pills, the row you are on is amber-edged and
 * reads "here now", a combined group shows Split. Rearrange in the header opens the sheet;
 * Review & finish is still reachable from here so you can stop early.
 */
export function AllSteps({
  steps,
  shape,
  stepOf,
  logs,
  idx,
  visited,
  onClose,
  onJump,
  onReview,
  onRearrange,
  onSplit,
}: {
  /** The steps as played, one per group of `shape`, in the same order. */
  steps: PlayedStep[];
  shape: PlayedShape;
  stepOf: (id: string) => WalkthroughStep | undefined;
  logs: StepLogs;
  idx: number;
  visited: ReadonlySet<number>;
  onClose: () => void;
  onJump: (i: number) => void;
  onReview: () => void;
  onRearrange?: () => void;
  onSplit?: (groupId: string) => void;
}) {
  const left = minutesLeft(steps, idx, visited);
  return (
    <>
      <div style={sheetScrim} onClick={onClose} aria-hidden />
      <div role="dialog" aria-label="All steps" style={{ ...sheetFrame, height: '96.5%', maxHeight: '96.5%', gap: 0, padding: '10px 0 0' }}>
        <div style={sheetGrab} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px 0' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2c2f33' }}>All steps</div>
            <div style={rowMeta}>
              {steps.length} STEPS · {left} MIN LEFT
            </div>
          </div>
          {onRearrange && (
            <button type="button" onClick={onRearrange} style={rearrangeBtn}>
              Rearrange
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((s, i) => {
            const group = shape[i];
            const st = stepStatus(i, idx, visited, s, logs[s.id]);
            const done = st === 'logged';
            const cur = i === idx;
            const combined = !!group && isCombined(group);
            const words = group ? groupWords(group, stepOf) : { title: s.title, meta: '' };
            const pills = group ? groupPills(group, stepOf) : [];
            const logged = loggedLabels(s, logs[s.id], stepOf);
            return (
              <div key={s.id} data-row onClick={() => onJump(i)} style={{ cursor: 'pointer' }}>
                <RowFrame look={cur ? 'current' : done ? 'done' : combined ? 'combined' : 'plain'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={rowTitle}>
                      {words.title}
                      {s.swapped_from && <div style={{ fontSize: 11, fontWeight: 700, color: '#5c5f63' }}>Swapped from {s.swapped_from}</div>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ ...rowMeta, ...(cur ? { color: 'oklch(40% 0.08 62)' } : {}) }}>{cur ? 'here now' : done ? 'done' : words.meta}</span>
                      {combined && onSplit && group && (
                        <button
                          type="button"
                          style={splitBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSplit(group.id);
                          }}
                        >
                          Split
                        </button>
                      )}
                    </span>
                  </div>
                  <div style={pillRow}>
                    {pills.length === 0 ? (
                      <Pill label={`${s.minutes} min`} done={done} current={cur} />
                    ) : (
                      pills.map((p, ti) => (
                        <Pill
                          key={p.key}
                          label={logged[ti] ?? p.label}
                          alt={p.alt}
                          timed={p.timed}
                          done={logged[ti] != null}
                          current={cur && logged[ti] == null && ti === logged.filter((l) => l != null).length}
                        />
                      ))
                    )}
                  </div>
                </RowFrame>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '12px 16px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={outlineBtn} onClick={onReview}>
            Review &amp; finish ›
          </button>
        </div>
      </div>
    </>
  );
}

/** What each pill reads once its set is logged: "5", "45 s", a minute count for a whole step. */
function loggedLabels(step: PlayedStep, log: StepLog | undefined, stepOf: (id: string) => WalkthroughStep | undefined): (string | null)[] {
  if (!log) return [];
  if (log.kind === 'reps') return log.sets.map((r) => String(r));
  if (log.kind === 'timed_sets') return log.sets.map((s) => secondsText(s));
  if (log.kind === 'group' && step.play) {
    return step.play.turns.map((t) => {
      const l = log.turns[`${t.stepId}:${t.set}`];
      if (!l) return null;
      return stepOf(t.stepId)?.tool.kind === 'timer' ? secondsText(l.value) : String(l.value);
    });
  }
  return stepFraction(step, log) >= 1 ? [`${step.minutes} min`] : [];
}

const rearrangeBtn: CSSProperties = {
  height: 44,
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid #dcd2bc',
  background: 'white',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13.5,
  fontWeight: 900,
  color: '#2c2f33',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
