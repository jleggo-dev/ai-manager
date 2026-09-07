/**
 * The metronome slot — where a step's dock renders, and where a practice step can ask for one.
 *
 * A table, because this is a router: the wrong branch renders a dock on a plank (the thing the
 * metronome was designed never to do) or hides the one control the owner sat down without
 * (2026-09-06, scales with no click and no way to get one). Positives AND near-misses, per the
 * every-button rule: a movement step with a timer looks exactly like a practice step with a timer
 * and must get nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WalkthroughStep } from '@cadence/shared';
import { MetronomeSlot, type StepArea } from './MetronomeSlot.tsx';

const step = (extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({
  id: 's1',
  title: 'Scales, hands together',
  minutes: 10,
  tool: { kind: 'timer', seconds: 600, chime: true, open_ended: true },
  skippable: true,
  ...extra,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const offer = () => screen.queryByRole('button', { name: 'Add a metronome to this step' });
const dock = () => screen.queryByRole('button', { name: /^Metronome, \d+ beats per minute/ });

describe('MetronomeSlot — who gets a dock, who gets an offer, who gets nothing', () => {
  const ROWS: Array<[string, StepArea | undefined, Partial<WalkthroughStep>, 'dock' | 'offer' | 'nothing']> = [
    ['a practice timer step the coach left plain', 'practice', {}, 'offer'],
    ['a practice read step (scales with no duration)', 'practice', { tool: { kind: 'read' } }, 'offer'],
    [
      'a practice journal step — a practice log can have a beat',
      'practice',
      { tool: { kind: 'journal', prompt: 'How did it go?', mode: 'either' } },
      'offer',
    ],
    ['a practice step the coach DID give a tempo', 'practice', { metronome: { bpm: 72, meter: 4 } }, 'dock'],
    ['a movement timer step — same tool, no offer (a plank is not played to a beat)', 'movement', {}, 'nothing'],
    [
      'a movement step the coach gave a tempo (a row cadence) — hers still renders',
      'movement',
      { metronome: { bpm: 60, meter: 1 } },
      'dock',
    ],
    ['a mind step', 'mind', {}, 'nothing'],
    ['a step with no area at all (an ad-hoc routine)', undefined, {}, 'nothing'],
  ];

  it.each(ROWS)('%s → %s', (_what, area, extra, expected) => {
    render(<MetronomeSlot step={step(extra)} area={area} onSettle={() => {}} />);
    expect(!!dock(), 'dock').toBe(expected === 'dock');
    expect(!!offer(), 'offer').toBe(expected === 'offer');
  });

  it('tapping the offer opens the dock, already expanded, at the shared default tempo', () => {
    render(<MetronomeSlot step={step()} area="practice" onSettle={() => {}} />);
    fireEvent.click(offer()!);
    expect(offer()).toBeNull();
    expect(dock()).toBeInTheDocument();
    // Expanded on arrival: the tempo readout is on screen without a second tap.
    expect(screen.getByText('♩ = 90')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '▶ Start' })).toBeInTheDocument();
  });

  it('a tempo settled on an asked-for dock reaches onSettle like a prescribed one', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    render(<MetronomeSlot step={step()} area="practice" onSettle={onSettle} />);
    fireEvent.click(offer()!);
    fireEvent.click(screen.getByRole('button', { name: 'One beat faster' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(onSettle).toHaveBeenCalledWith({ bpm: 91, meter: 4 });
    vi.useRealTimers();
  });
});
