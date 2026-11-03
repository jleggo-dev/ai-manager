/**
 * The cue under a step title folds at three lines (owner, gym session 2026-11-02: a long cue pushed
 * the tool below the fold). jsdom lays nothing out, so the length fallback decides here — the
 * table pins both sides of it, the fold, the control, and that an empty cue draws nothing.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Cue, LONG_CUE_CHARS } from './wt-cue.tsx';

const SHORT = 'Keep your hips level and breathe out on the way up.';
const LONG =
  'Set your feet shoulder-width apart with your toes turned out a little. Brace before you bend. ' +
  'Sit back and down until your thighs are level, keep your heels on the floor and your chest up, ' +
  'then drive through the whole foot to stand. Breathe out on the way up.';

type Row = [name: string, text: string | undefined | null, expect: 'nothing' | 'plain' | 'folded'];
const ROWS: Row[] = [
  ['no cue', undefined, 'nothing'],
  ['null cue', null, 'nothing'],
  ['blank cue', '   ', 'nothing'],
  ['one sentence', SHORT, 'plain'],
  ['exactly at the limit', 'x'.repeat(LONG_CUE_CHARS), 'plain'],
  ['one over the limit', 'x'.repeat(LONG_CUE_CHARS + 1), 'folded'],
  ['four sentences', LONG, 'folded'],
];

describe('Cue — three lines, then "more"', () => {
  it.each(ROWS)('%s', (_name, text, expected) => {
    const { container } = render(<Cue text={text} />);
    const more = screen.queryByRole('button', { name: 'more' });
    if (expected === 'nothing') {
      expect(container).toBeEmptyDOMElement();
      return;
    }
    expect(screen.getByText(text!.trim())).toBeInTheDocument();
    const box = screen.getByText(text!.trim());
    if (expected === 'plain') {
      expect(more).toBeNull();
      // Short or not, the box is clamped — a cue that fits in three lines is unaffected by it.
      expect(box.style.webkitLineClamp).toBe('3');
      return;
    }
    expect(more).not.toBeNull();
    expect(box.style.webkitLineClamp).toBe('3');
    expect(box.style.overflow).toBe('hidden');
  });

  it('"more" opens the whole cue in place; "less" folds it again', () => {
    render(<Cue text={LONG} />);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    const box = screen.getByText(LONG);
    expect(box.style.webkitLineClamp).toBe('');
    expect(box.style.overflow).toBe('');
    const less = screen.getByRole('button', { name: 'less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(screen.getByText(LONG).style.webkitLineClamp).toBe('3');
    expect(screen.getByRole('button', { name: 'more' })).toHaveAttribute('aria-expanded', 'false');
  });

  it("the next step's cue starts folded even if this one was opened", () => {
    const { rerender } = render(<Cue text={LONG} />);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    rerender(<Cue text={`${LONG} And again.`} />);
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
    expect(screen.getByText(`${LONG} And again.`).style.webkitLineClamp).toBe('3');
  });
});
