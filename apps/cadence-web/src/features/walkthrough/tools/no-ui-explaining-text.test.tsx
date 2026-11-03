/**
 * No text that explains the UI (owner ruling, 2026-11-03), across every tool — not only the ones
 * Phase 1 of walkthrough v3 touched. A button says what a tap does, the clock says where you are,
 * a chip says its state; nothing on the card tells you how to work the card.
 *
 * One row per sentence that used to do that. The timer's and the interval ring's rows live in
 * StepTimer.effort.test.tsx and StepInterval.presses.test.tsx (#477, #482); these are the rest.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StepMeditate } from './StepMeditate.tsx';
import { HandsFree } from './HandsFree.tsx';
import { Metronome } from './Metronome.tsx';

vi.mock('./chime.ts', () => ({ playChime: vi.fn(), playTones: vi.fn(), unlockAudio: vi.fn() }));

const ROWS: { tool: string; mount: () => void; gone: RegExp[]; kept?: RegExp }[] = [
  {
    tool: 'meditate, settling in before the sit',
    mount: () => {
      render(<StepMeditate seconds={600} bells="start_end" intervalMin={0} onLog={vi.fn()} onDone={vi.fn()} />);
      fireEvent.click(screen.getByText('Begin · 10 min'));
    },
    gone: [/tap anywhere/i, /a bell to start and end/, /Stopping early keeps/],
    // The coaching half of the old line stays: it is the practice, not the UI.
    kept: /Noticing you.ve drifted is the practice/,
  },
  {
    tool: 'meditate, after a sit ended',
    mount: () => {
      render(<StepMeditate seconds={600} bells="interval" intervalMin={5} onLog={vi.fn()} onDone={vi.fn()} />);
      fireEvent.click(screen.getByText('Begin · 10 min'));
      fireEvent.click(screen.getByText('Skip the count · start now'));
      fireEvent.click(screen.getByText('End here'));
    },
    gone: [/a bell every/, /Stopping early keeps/, /no bells/],
  },
  {
    tool: 'hands-free chip, off',
    mount: () =>
      render(<HandsFree state={{ status: 'off', heard: null, accepted: ['next'] }} on={false} onToggle={vi.fn()} />),
    gone: [/tap to control/],
    kept: /^Off$/,
  },
  {
    tool: 'metronome dock, open',
    mount: () => {
      render(<Metronome spec={{ bpm: 72, meter: 4 }} title="Waltz" />);
      fireEvent.click(screen.getByRole('button', { name: /Metronome/i }));
    },
    gone: [/Tap four beats/, /by ear/],
    kept: /Tap tempo/,
  },
];

describe('no text that explains the UI, in the tools Phase 1 did not touch', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it.each(ROWS)('$tool', ({ mount, gone, kept }) => {
    mount();
    for (const re of gone) expect(screen.queryByText(re)).toBeNull();
    if (kept) expect(screen.getByText(kept)).toBeInTheDocument();
  });
});
