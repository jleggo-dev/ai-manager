/** Press-every-button coverage for the trimmed save moment (design E): Run it now, and Done. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SavedMoment } from './SavedMoment.tsx';

afterEach(() => cleanup());

describe('SavedMoment', () => {
  it('shows the name in the headline and the library/sheet line', () => {
    render(<SavedMoment name="Piano practice" onRunNow={() => {}} onDone={() => {}} />);
    expect(screen.getByText('Piano practice — saved')).toBeTruthy();
    expect(screen.getByText('It’s in Your activities and on the ＋ sheet.')).toBeTruthy();
  });

  it('Run it now calls onRunNow', () => {
    const onRunNow = vi.fn();
    render(<SavedMoment name="Piano practice" onRunNow={onRunNow} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Run it now'));
    expect(onRunNow).toHaveBeenCalledTimes(1);
  });

  it('Done calls onDone', () => {
    const onDone = vi.fn();
    render(<SavedMoment name="Piano practice" onRunNow={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
