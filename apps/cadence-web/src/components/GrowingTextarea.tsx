import { useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';

/**
 * A composer that grows with what you write.
 *
 * Every food input in the app was a single line: the photo caption an `<input>` that could never
 * grow at all, the others `rows={1}` textareas that grew only by scrolling. Owner, 2026-08-22,
 * after dictating four sentences into one of them and logging a meal he could not re-read:
 *
 *   "This is a tiny little line and it doesn't get bigger as I type, making reviewing what I wrote
 *    very challenging. It should probably mirror the way chat works in the coach view."
 *
 * Voice is the point here. Speaking a meal produces sentences, not phrases, and a box that shows
 * one line of them is a box you cannot check your own words in — which is how "dill pickle
 * seasoned peanuts" got logged as two foods nobody could catch.
 *
 * Grows to `maxRows` and then scrolls, so a long caption can never push the button it sits above
 * off the screen.
 */
export function GrowingTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
  maxRows = 8,
  onSubmit,
  className = 'mc-cap-in',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Lines before it stops growing and starts scrolling. */
  maxRows?: number;
  /** Enter submits when given; Shift+Enter always makes a newline. */
  onSubmit?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Layout effect, not effect: resize before paint so a pasted or dictated block never flashes at
  // one line and then jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) * 2;
    const max = line * maxRows + pad;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, maxRows]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (onSubmit && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}
