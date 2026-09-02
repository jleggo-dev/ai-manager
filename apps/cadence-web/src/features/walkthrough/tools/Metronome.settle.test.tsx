/**
 * The engagement gate on the settled tempo.
 *
 * A tempo is only worth remembering — and only worth telling the coach about — once the person
 * actually did something with it. Without this gate, merely OPENING a step would report the
 * coach's own guess straight back as "the tempo they practise at", and she would then read her own
 * number in {{repertoire}} next week as if it were evidence. That is a feedback loop that looks
 * exactly like memory and contains none, and nothing about it would throw.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Metronome } from './Metronome.tsx';

const SPEC = { bpm: 72, meter: 4 };

// The dock debounces its write by 300ms so a slider drag doesn't hammer storage.
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
};

const open = () => fireEvent.click(screen.getByRole('button', { name: /Metronome/i }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('Metronome onSettle', () => {
  it('reports nothing when the dock is merely opened and looked at', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    render(<Metronome spec={SPEC} title="Écossaise (Hummel)" onSettle={onSettle} />);
    open();
    await settle();
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('reports the tempo once they change it', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    render(<Metronome spec={SPEC} title="Écossaise (Hummel)" onSettle={onSettle} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /One beat slower/i }));
    await settle();
    expect(onSettle).toHaveBeenCalledWith({ bpm: 71, meter: 4 });
  });

  it('reports the tempo when they play to it untouched — that is settling on it too', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    render(<Metronome spec={SPEC} title="Écossaise (Hummel)" onSettle={onSettle} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    await settle();
    expect(onSettle).toHaveBeenCalledWith({ bpm: 72, meter: 4 });
  });

  it('reports a meter change', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    render(<Metronome spec={SPEC} title="Waltz" onSettle={onSettle} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /3 beats to the bar/i }));
    await settle();
    expect(onSettle).toHaveBeenCalledWith({ bpm: 72, meter: 3 });
  });

  it('still works with no handler at all — the dock is not coupled to the sync', async () => {
    vi.useFakeTimers();
    render(<Metronome spec={SPEC} title="Solo" />);
    open();
    expect(() => fireEvent.click(screen.getByRole('button', { name: /One beat faster/i }))).not.toThrow();
    await settle();
    expect(screen.getByText(/= 73/)).toBeTruthy();
  });
});
