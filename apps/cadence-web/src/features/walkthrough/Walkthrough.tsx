import { useMemo, useState, type CSSProperties } from 'react';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { ToolView } from './tools/registry.tsx';
import { ytSearch } from '../plan/occurrence/format.ts';

/**
 * The task walkthrough (REQ8) — a full-screen, one-step-at-a-time player over a client-derived
 * `Walkthrough` (see @cadence/shared deriveWalkthrough). Each step draws its tool via the registry;
 * a `timer` auto-advances, everything else advances on Next. Finishing shows a celebration whose
 * Continue reports a completion summary (any journal notes, joined) up to the caller, which marks
 * the occurrence done. The signature sky/disc visual system lands with the broader redesign — this
 * is the functional shell the tools live in.
 */
export function Walkthrough({
  walkthrough,
  title,
  onClose,
  onComplete,
}: {
  walkthrough: WalkthroughData;
  title: string;
  onClose: () => void;
  onComplete: (summary: string) => void;
}) {
  const steps = walkthrough.steps;
  const [idx, setIdx] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const step = steps[idx];

  const summary = useMemo(
    () =>
      Object.values(notes)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' · '),
    [notes],
  );

  function advance() {
    if (idx + 1 < steps.length) setIdx(idx + 1);
    else setCelebrating(true);
  }

  if (steps.length === 0 || !step) return null;

  return (
    <div className="wt-overlay" style={overlay} role="dialog" aria-label="Task walkthrough">
      {celebrating ? (
        <div style={center}>
          <div style={{ fontSize: 64 }} aria-hidden>
            🎉
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Nice work!</div>
          <div className="prog-sub">{title} complete</div>
          <button style={cta} onClick={() => onComplete(summary)}>
            Continue
          </button>
        </div>
      ) : (
        <>
          <div style={controlRow}>
            <button aria-label="Close" style={closeBtn} onClick={onClose}>
              ✕
            </button>
            <div style={track}>
              <div style={{ ...fill, width: `${Math.round((idx / steps.length) * 100)}%` }} />
            </div>
          </div>

          <div style={center}>
            <div style={eyebrow}>
              STEP {idx + 1} OF {steps.length}
              {step.group ? ` · ${step.group}` : ''}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, textAlign: 'center' }}>{step.title}</div>
            {step.body && (
              <div className="prog-sub" style={{ textAlign: 'center', maxWidth: 320 }}>
                {step.body}
              </div>
            )}
            <ToolView
              tool={step.tool}
              onAutoAdvance={advance}
              note={notes[step.id] ?? ''}
              setNote={(s) => setNotes((n) => ({ ...n, [step.id]: s }))}
            />
            {step.video_query && (
              <a href={ytSearch(step.video_query)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                ▶ how-to: {step.video_query}
              </a>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={cta} onClick={advance}>
              {idx + 1 < steps.length ? 'Next' : 'Finish'}
            </button>
            {step.skippable && idx + 1 < steps.length && (
              <button style={skip} onClick={advance}>
                Skip
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 60,
  background: 'var(--app-cream, #f6f3ee)',
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 20px 28px',
  gap: 16,
};
const controlRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const closeBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: 'none',
  background: 'rgba(0,0,0,0.06)',
  fontSize: 15,
  cursor: 'pointer',
  flex: '0 0 auto',
};
const track: CSSProperties = {
  flex: 1,
  height: 6,
  borderRadius: 3,
  background: 'rgba(0,0,0,0.08)',
  overflow: 'hidden',
};
const fill: CSSProperties = { height: '100%', background: 'var(--forest, #3f7a52)', transition: 'width 0.3s' };
const center: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
};
const eyebrow: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.06em',
  color: 'var(--forest, #3f7a52)',
};
const cta: CSSProperties = {
  padding: 15,
  borderRadius: 14,
  border: 'none',
  fontWeight: 800,
  fontSize: 15,
  color: '#fff',
  background: 'var(--forest, #3f7a52)',
  cursor: 'pointer',
};
const skip: CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: 'none',
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--forest, #3f7a52)',
  background: 'transparent',
  cursor: 'pointer',
};
