import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaceSlider } from './PaceSlider.tsx';

/**
 * The control has no words, so its meaning is entirely which animal sits at which end. Swap them
 * and nothing throws: the slider just works backwards, and the rabbit makes you breathe slower.
 */
afterEach(cleanup);

function slider(value = 1, onChange = vi.fn()) {
  render(<PaceSlider min={0.75} max={2} value={value} onChange={onChange} />);
  return screen.getByRole('slider', { name: 'Pace' }) as HTMLInputElement;
}

describe('PaceSlider', () => {
  it('reads quick to slow left to right: rabbit, track, turtle', () => {
    const input = slider();
    const row = [...(input.parentElement?.children ?? [])];
    expect(row).toEqual([screen.getByTestId('pace-quick'), input, screen.getByTestId('pace-slow')]);
    // The value is seconds per count, so it must rise toward the turtle.
    expect(Number(input.min)).toBeLessThan(Number(input.max));
  });

  it('names itself to a screen reader, and hides the animals from it', () => {
    slider();
    expect(screen.getByTestId('pace-quick').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('pace-slow').getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    [0.75, 0.75],
    [1, 1],
    [1.37, 1.37], // between any stops a chunky slider would have
    [2, 2],
  ])('moving to %f hands back %f, as a number', (moved, handed) => {
    const onChange = vi.fn();
    const input = slider(1.5, onChange);
    fireEvent.change(input, { target: { value: String(moved) } });
    expect(onChange).toHaveBeenCalledWith(handed);
  });

  it('stays smooth: at most a hundredth of a second between positions', () => {
    expect(Number(slider().step)).toBeLessThanOrEqual(0.01);
  });

  it('honours a narrower range, so Wind-down cannot reach past its cap', () => {
    render(<PaceSlider min={0.75} max={1.43} value={1.43} onChange={vi.fn()} />);
    expect(Number((screen.getByRole('slider', { name: 'Pace' }) as HTMLInputElement).max)).toBe(1.43);
  });
});
