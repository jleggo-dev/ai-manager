/**
 * The composer's auto-grow, and the measurement it must refuse.
 *
 * The bug (owner, on device 2026-08-16): *"it's when I go to the coach the first time when I open
 * the application — after the first message the issue no longer persists."* The caret came up tiny,
 * in the bottom-left of a box far taller than its content. The app lands on Plan, and the coach tab
 * is kept mounted behind `display: none` so an in-flight reply survives a tab switch — so the very
 * first measurement happens with no layout box, `scrollHeight` reads 0, and `height: 0px` is
 * stamped on the field. Nothing re-measured it, because the height only tracked the text and the
 * text had not changed; sending the first message was what finally moved it.
 *
 * jsdom reports `scrollHeight` as 0 for everything, which is exactly the hidden-subtree condition —
 * so the regression reproduces here for free, and a real height has to be stubbed to test the rest.
 */
import { render } from '@testing-library/react';
import { useAutoGrow } from './useAutoGrow.ts';

/** jsdom has no layout; this is the only way to say "the element does have a box, this big". */
function reportScrollHeight(px: number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => px });
}
afterEach(() => {
  delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
});

function Field({ maxHeight, value = '' }: { maxHeight?: string; value?: string }) {
  const ref = useAutoGrow();
  return <textarea ref={ref} readOnly rows={1} value={value} style={maxHeight ? { maxHeight } : undefined} />;
}
const field = (c: HTMLElement) => c.querySelector('textarea')!;

describe('useAutoGrow', () => {
  it('refuses to write a height measured with no layout box', () => {
    reportScrollHeight(0);
    const { container } = render(<Field />);
    // `height: 0px` here is the whole bug: with box-sizing: border-box it collapses the field to
    // its padding, and the caret lands clipped in the corner of the flex row.
    expect(field(container).style.height).toBe('');
  });

  it('fits itself as soon as a render finds it with a box — no keystroke required', () => {
    reportScrollHeight(0);
    const { container, rerender } = render(<Field />);
    expect(field(container).style.height).toBe('');

    // The user taps the Coach tab: MainTabs re-renders, and now the field is laid out.
    reportScrollHeight(41);
    rerender(<Field />);
    expect(field(container).style.height).toBe('41px');
  });

  it('leaves a height it had already measured alone rather than clearing it', () => {
    // Hiding the tab again must not undo a good measurement — the composer would jump on return.
    reportScrollHeight(41);
    const { container, rerender } = render(<Field />);
    expect(field(container).style.height).toBe('41px');

    reportScrollHeight(0);
    rerender(<Field value="still here" />);
    expect(field(container).style.height).toBe('41px');
  });

  it('grows with the content', () => {
    reportScrollHeight(41);
    const { container, rerender } = render(<Field />);
    reportScrollHeight(88);
    rerender(<Field value={'a\nb\nc'} />);
    expect(field(container).style.height).toBe('88px');
  });

  it('caps at the CSS max-height and hands over to scrolling', () => {
    reportScrollHeight(300);
    const { container } = render(<Field maxHeight="132px" />);
    expect(field(container).style.height).toBe('132px');
    expect(field(container).style.overflowY).toBe('auto');
  });

  it('goes back to growing once it fits again', () => {
    reportScrollHeight(300);
    const { container, rerender } = render(<Field maxHeight="132px" value="long" />);
    expect(field(container).style.overflowY).toBe('auto');

    reportScrollHeight(41);
    rerender(<Field maxHeight="132px" value="" />);
    expect(field(container).style.height).toBe('41px');
    expect(field(container).style.overflowY).toBe('hidden');
  });
});
