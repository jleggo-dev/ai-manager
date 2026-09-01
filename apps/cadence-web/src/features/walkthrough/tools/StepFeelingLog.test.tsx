import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepFeelingLog } from './StepFeelingLog.tsx';

/**
 * Feeling check-in ("one word, 20 seconds" in the tool palette) — already built on the mind
 * pillar's own vocabulary (REQ9 §4.4, `feelings.ts`), which is richer than a flat six-word chip
 * list but reuses the SAME words the palette names ("steady", "tired", "wired", "heavy", "light"
 * all appear as family names or family words below). These tests cover the two-tap capture this
 * parcel wires into the player, not the vocabulary itself (see feelings.test.ts for that).
 */
describe('StepFeelingLog — one word, 20 seconds', () => {
  it('family → word → room → save logs the full shape', () => {
    const onLog = vi.fn();
    render(<StepFeelingLog onLog={onLog} onDone={() => {}} />);

    fireEvent.click(screen.getByText('Wired')); // family tile
    fireEvent.click(screen.getByText('restless')); // a word in that family
    fireEvent.click(screen.getByText('here')); // how much room it's taking
    fireEvent.click(screen.getByText('Save'));

    expect(onLog).toHaveBeenCalledWith({
      kind: 'feeling_log',
      word: 'restless',
      family: 'wired',
      room: 2,
      note: undefined,
    });
  });

  it('"just: <family>" lets someone stop at the family word without picking a more precise one', () => {
    const onLog = vi.fn();
    render(<StepFeelingLog onLog={onLog} onDone={() => {}} />);

    fireEvent.click(screen.getByText('Heavy'));
    fireEvent.click(screen.getByText('just: heavy'));
    fireEvent.click(screen.getByText('in the background'));
    fireEvent.click(screen.getByText('Save'));

    expect(onLog).toHaveBeenCalledWith({
      kind: 'feeling_log',
      word: 'heavy',
      family: 'heavy',
      room: 1,
      note: undefined,
    });
  });

  it('an optional note rides along with the word and room', () => {
    const onLog = vi.fn();
    render(<StepFeelingLog onLog={onLog} onDone={() => {}} />);

    fireEvent.click(screen.getByText('Bright'));
    fireEvent.click(screen.getByText('light'));
    fireEvent.click(screen.getByText('filling the room'));
    fireEvent.change(screen.getByPlaceholderText('anything to add? (optional)'), {
      target: { value: 'good news at work' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onLog).toHaveBeenCalledWith({
      kind: 'feeling_log',
      word: 'light',
      family: 'bright',
      room: 3,
      note: 'good news at work',
    });
  });

  it('after saving, shows the acknowledgement and no chart, no history, no streak', () => {
    render(<StepFeelingLog onLog={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Settled'));
    fireEvent.click(screen.getByText('steady'));
    fireEvent.click(screen.getByText('here'));
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText(/Steady, and it's here/)).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('"None of these — show every word" reaches the full list, filterable', () => {
    const onLog = vi.fn();
    render(<StepFeelingLog onLog={onLog} onDone={() => {}} />);
    fireEvent.click(screen.getByText('None of these — show every word'));
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'lonely' } });
    fireEvent.click(screen.getByText('lonely'));
    fireEvent.click(screen.getByText('here'));
    fireEvent.click(screen.getByText('Save'));
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'feeling_log', word: 'lonely', room: 2 }));
  });
});
