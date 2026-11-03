import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * The cue under a step's title — the coach's words about how to do the move. A cue can run to
 * three or four sentences, and on a phone that pushed the tool below the fold (owner, gym session
 * 2026-11-02). So it shows at most three lines, then a one-word "more" that opens the rest in
 * place; a cue that fits shows no control at all. Interim look — design round D may restyle it.
 *
 * Whether a cue is long is MEASURED (the clamped box scrolls) wherever the browser lays text out;
 * where it can't (jsdom), the length of the text stands in. Built for reuse: the circuit card
 * draws no cue yet and gets this one next.
 */
export const CUE_LINES = 3;
/** Roughly three lines of 12.5px text across a phone-width card. Only used when the browser
 *  cannot measure the box. */
export const LONG_CUE_CHARS = 150;

export function Cue({ text, style }: { text?: string | null; style?: CSSProperties }) {
  const cue = text?.trim() ?? '';
  // The cue that was opened, so a new cue (the next step) starts folded without an effect.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === cue;
  const [overflows, setOverflows] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open) return; // unclamped — nothing to measure; keep what the clamped box told us
    const el = box.current;
    if (!el || el.clientHeight === 0) {
      setOverflows(null);
      return;
    }
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [cue, open]);

  if (!cue) return null;
  const long = overflows ?? cue.length > LONG_CUE_CHARS;

  return (
    <div style={{ marginTop: 8, ...style }}>
      <div ref={box} style={{ ...cueText, ...(open ? {} : clamp) }}>
        {cue}
      </div>
      {long && (
        <button
          type="button"
          style={moreBtn}
          aria-expanded={open}
          onClick={() => setOpenFor(open ? null : cue)}
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

const cueText: CSSProperties = { fontSize: 12.5, lineHeight: 1.45, color: 'oklch(45% 0.02 150)' };
const clamp: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: CUE_LINES,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
const moreBtn: CSSProperties = {
  marginTop: 2,
  padding: '4px 8px',
  border: 'none',
  background: 'none',
  fontSize: 12,
  fontWeight: 900,
  color: 'oklch(38% 0.02 150)',
  cursor: 'pointer',
};
