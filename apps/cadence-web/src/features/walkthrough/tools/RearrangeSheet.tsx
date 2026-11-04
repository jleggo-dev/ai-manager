import { useState, type CSSProperties } from 'react';
import {
  type CombineMode,
  type PlayedGroup,
  type PlayedShape,
  type WalkthroughStep,
  canRearrangeTurns,
  canUndo,
  combine,
  distinctSteps,
  historyOf,
  isCombined,
  moveGroup,
  moveTurnOut,
  pushShape,
  split,
  undoShape,
} from '@cadence/shared';
import { COMMIT } from './tone.ts';
import { sheetScrim, sheetFrame, sheetGrab } from './sheet-styles.ts';
import { DragHandle, Gap, Lines, PickCircle, Pill, RowFrame, Toast } from './rearrange-parts.tsx';
import { combineToast, groupPills, groupWords } from './rearrange-words.ts';
import { pillRow, rowMeta, rowTitle, splitBtn } from './rearrange-styles.ts';
import { useRearrangeDrag, type Drag } from './useRearrangeDrag.ts';

/**
 * Rearrange (walkthrough v3 Phase 6, design C; R2 — the person may change the structure). A sheet
 * over the step with Undo, the title and a green Done. Every row is a group of sets, every pill
 * one set, in the order you'll do them. Pick two groups and they preview as ONE dashed-green group
 * whose pills reorder live as Alternate | Sequence flips; Combine commits it, with a toast and an
 * Undo. A combined group shows Split. Drag a group by its handle, or drag one pill into a gap
 * elsewhere to leave that set on its own there. Nothing here logs anything; Done hands the shape
 * back, and until then every change is on an undo stack (played-shape.ts). Nothing is marked
 * "moved".
 */
export function RearrangeSheet({
  steps,
  shape,
  onDone,
  onClose,
}: {
  steps: readonly WalkthroughStep[];
  shape: PlayedShape;
  onDone: (shape: PlayedShape) => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState(() => historyOf(shape));
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<CombineMode>('alternate');
  const [toast, setToast] = useState<string | null>(null);
  const stepOf = (id: string) => steps.find((s) => s.id === id);
  const groups = history.shape;

  const apply = (next: PlayedShape) => setHistory((h) => pushShape(h, next));
  const drag = useRearrangeDrag((d: Drag, gap: number) => {
    setPicked([]);
    apply(d.kind === 'group' ? moveGroup(groups, d.groupId, gap) : moveTurnOut(groups, d.groupId, d.turnIndex, gap));
  });

  const [a, b] = picked;
  const preview = a && b ? combine(groups, a, b, mode).find((g) => !groups.some((o) => o.id === g.id)) : undefined;
  const names = (g: PlayedGroup) => distinctSteps(g).map((id) => stepOf(id)?.title ?? id);

  function toggle(id: string) {
    setToast(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1] as string, id] : [...p, id]));
  }
  function doCombine() {
    if (!a || !b || !preview) return;
    const titles = names(preview);
    apply(combine(groups, a, b, mode));
    setPicked([]);
    setToast(combineToast(titles, mode));
  }
  function undo() {
    setHistory(undoShape);
    setPicked([]);
    setToast(null);
  }

  return (
    <>
      <div style={sheetScrim} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Rearrange"
        style={{ ...sheetFrame, height: '96.5%', maxHeight: '96.5%', gap: 0, padding: '10px 0 0' }}
      >
        <div style={sheetGrab} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 18px 0' }}>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo(history)}
            style={{ ...undoBtn, color: canUndo(history) ? '#2c2f33' : '#5c5f63' }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10a6 6 0 010 12h-3" />
            </svg>
            Undo
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#2c2f33' }}>Rearrange</div>
          <button type="button" onClick={() => onDone(groups)} style={doneBtn}>
            Done
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 14px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            position: 'relative',
          }}
        >
          <Gap active={drag.gap === 0} />
          {groups.map((g, i) => {
            const pickedHere = picked.includes(g.id);
            if (preview && g.id === b) return <Gap key={g.id} active={drag.gap === i + 1} />;
            const shown = preview && g.id === a ? preview : g;
            const words = groupWords(shown, stepOf);
            const pills = groupPills(shown, stepOf);
            const lifting = drag.drag?.kind === 'turn' && drag.drag.groupId === g.id ? drag.drag.turnIndex : null;
            const meta =
              lifting != null ? `${shown.turns.length - 1} set${shown.turns.length - 1 === 1 ? '' : 's'}` : words.meta;
            const look = preview && g.id === a ? 'picked' : isCombined(g) ? 'combined' : 'plain';
            const rearrangeable = distinctSteps(g).every((id) => {
              const s = stepOf(id);
              return !!s && canRearrangeTurns(s.tool);
            });
            return (
              <div key={g.id}>
                <div ref={drag.rowRef(i)} data-row>
                  <RowFrame
                    look={look}
                    style={{
                      flexDirection: 'row',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: look === 'picked' ? '10px 12px 12px' : '8px 6px 10px 12px',
                    }}
                  >
                    {look !== 'picked' &&
                      (rearrangeable ? (
                        <PickCircle picked={pickedHere} onToggle={() => toggle(g.id)} label={`Pick ${words.title}`} />
                      ) : (
                        <span style={{ width: 44, flex: 'none' }} />
                      ))}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        paddingTop: look === 'picked' ? 0 : 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={rowTitle}>{words.title}</span>
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={rowMeta}>{meta}</span>
                          {isCombined(g) && look !== 'picked' && (
                            <button
                              type="button"
                              style={splitBtn}
                              onClick={() => {
                                setToast(null);
                                setPicked([]);
                                apply(split(groups, g.id));
                              }}
                            >
                              Split
                            </button>
                          )}
                        </span>
                      </div>
                      <div style={pillRow}>
                        {pills.map((p, ti) =>
                          lifting === ti ? (
                            <Pill key={p.key} label="" hole />
                          ) : (
                            <span
                              key={p.key}
                              onPointerDown={
                                look === 'picked' ? undefined : (e) => drag.startTurn(e, g.id, ti, p.label)
                              }
                              style={{ touchAction: 'none', display: 'inline-flex' }}
                              aria-label={`Drag ${p.label}`}
                            >
                              <Pill
                                label={p.label}
                                alt={p.alt}
                                timed={p.timed}
                                style={look === 'picked' && !p.alt ? { background: 'white' } : undefined}
                              />
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                    {look !== 'picked' && (
                      <DragHandle
                        label={`Drag ${words.title}`}
                        color={isCombined(g) ? '#2c5545' : undefined}
                        onPointerDown={(e) => drag.startGroup(e, g.id)}
                      />
                    )}
                  </RowFrame>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Gap active={drag.gap === i + 1} />
                </div>
              </div>
            );
          })}
          {drag.drag?.kind === 'turn' && (
            <div style={{ ...lifted, left: drag.drag.x - 40, top: drag.drag.y - 20 }} aria-hidden>
              <Lines size={16} />
              {drag.drag.label}
            </div>
          )}
        </div>

        {(preview || toast) && (
          <div style={tray}>
            {preview ? (
              <>
                <div role="radiogroup" aria-label="How to combine" style={well}>
                  {(['alternate', 'sequence'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => setMode(m)}
                      style={{ ...toggleBtn, ...(mode === m ? toggleOn : {}) }}
                    >
                      {m === 'alternate' ? 'Alternate' : 'Sequence'}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={doCombine} style={combineBtn}>
                  Combine
                </button>
              </>
            ) : (
              toast && <Toast words={toast} onUndo={undo} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

const undoBtn: CSSProperties = {
  height: 44,
  padding: '0 4px',
  border: 'none',
  background: 'transparent',
  fontSize: 14,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const doneBtn: CSSProperties = {
  height: 44,
  padding: '0 14px',
  borderRadius: 999,
  border: 'none',
  background: '#2c5545',
  fontSize: 14,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const tray: CSSProperties = {
  padding: '12px 14px 26px',
  borderTop: '1px solid #eae2d0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  boxShadow: '0 -10px 20px -14px rgba(44,40,32,0.3)',
  background: '#fbf9f4',
};
const well: CSSProperties = { display: 'flex', padding: 4, borderRadius: 14, background: '#f1ebdd', gap: 4 };
const toggleBtn: CSSProperties = {
  flex: 1,
  height: 44,
  border: 'none',
  borderRadius: 11,
  background: 'transparent',
  fontSize: 14,
  fontWeight: 800,
  color: '#5c5f63',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const toggleOn: CSSProperties = {
  background: 'white',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  fontWeight: 900,
  color: '#2c5545',
};
const combineBtn: CSSProperties = {
  height: 52,
  border: 'none',
  borderRadius: 16,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  fontFamily: 'inherit',
  ...COMMIT,
};
const lifted: CSSProperties = {
  position: 'fixed',
  height: 40,
  padding: '0 16px',
  borderRadius: 999,
  background: 'oklch(94% 0.045 74)',
  color: 'oklch(36% 0.08 62)',
  fontSize: 14,
  fontWeight: 900,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 0 0 2px oklch(79% 0.16 70), 0 14px 28px -10px rgba(44,40,32,0.45)',
  transform: 'rotate(-3deg)',
  pointerEvents: 'none',
  zIndex: 80,
};
