import { useEffect, useLayoutEffect, useRef } from 'react';
import { MicButton } from '../../components/MicButton.tsx';

/**
 * The "tell me what to change" box — a textarea that grows with what you type.
 *
 * It was `rows={2}` and fixed. Type past two lines and your own sentence scrolled up out of
 * sight, with no scrollbar and nothing to grab (owner, 2026-08-15: *"as I type in it, my words
 * flow to the 2nd, 3rd+ lines, but that chat window doesn't scroll with the chat"*). You cannot
 * check what you asked for before asking for it, which is exactly the moment this app promises
 * ("here's what I heard — did I get it right?").
 *
 * Grows to MAX_ROWS, then scrolls itself to the caret rather than silently swallowing the text.
 * Measured off scrollHeight, so it works for wrapped lines and pasted text, not just newlines.
 */
const MAX_ROWS = 9;
const MIN_ROWS = 3;

export function SteerBox({
  value,
  onChange,
  disabled,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // A prefilled box opens with the caret at position 0, which puts the person typing IN FRONT of
  // the prompt Cadence wrote ("About today's hill intervals: "). Send them to the end — they are
  // continuing that sentence, not editing it.
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Mount only: re-running on every keystroke would fight the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect, not effect: resize before paint so the box never flashes at the wrong height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Line height comes from the computed style rather than a constant, so this stays right if
    // the type scale changes — a hard-coded 19px would silently mis-measure after a restyle.
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 19;
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
    const max = line * MAX_ROWS + chrome;
    el.style.height = 'auto'; // release, so scrollHeight reports the CONTENT height, not the box's
    const wanted = el.scrollHeight;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
    // At the cap the caret is what must stay visible; anywhere else this is a no-op.
    if (wanted > max) el.scrollTop = el.scrollHeight;
  }, [value]);

  return (
    <div className="steer-row">
      <textarea
        ref={ref}
        className="steer-in"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={MIN_ROWS}
        disabled={disabled}
      />
      <MicButton value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
