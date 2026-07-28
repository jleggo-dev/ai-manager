import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Deterministically shrink text to fit `maxLines` lines. After layout it steps the font-size down
 * from `max` to `min` until the element stops overflowing its N-line box — a hard floor UNDER the
 * day-recap's char-limit prompt: if the LLM ever returns a line that's still too long, it shrinks to
 * fit instead of spilling onto a third line. Re-runs whenever `dep` (the text) changes, and on
 * resize. The element must be block-level (a flex item is fine) with `line-height: 1.4` so the
 * scrollHeight check matches; returns a ref for it plus the resolved px size.
 */
export function useFitText(dep: unknown, max = 13, min = 10.5, maxLines = 2) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let s = max;
      el.style.fontSize = `${s}px`;
      // line-height is 1.4 on this element; +1px slack absorbs sub-pixel rounding.
      while (s > min && el.scrollHeight > s * 1.4 * maxLines + 1) {
        s -= 0.5;
        el.style.fontSize = `${s}px`;
      }
      setSize(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [dep, max, min, maxLines]);

  return { ref, size };
}
