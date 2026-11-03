/**
 * The step header after the 2026-11-03 design ruling: the target is plain text with the video link
 * beside it, and there is no TARGET label or box. `targetText` is the one source of that text (the
 * header and the all-steps list both read it), so its grammar is pinned per tool kind.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { StepHeader } from './wt-parts.tsx';
import { targetText } from './wt-styles.ts';

const step = (tool: WalkthroughStep['tool'], extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({
  id: 's1',
  title: 'Goblet squat',
  minutes: 4,
  skippable: true,
  tool,
  ...extra,
});

describe("targetText — the prescription in the log line's grammar", () => {
  it.each<[string, WalkthroughStep['tool'], string]>([
    ['reps with load and sets', { kind: 'reps', reps: 12, load: 'bodyweight', sets: 2 }, '12 × bodyweight · 2 sets'],
    ['reps, no load', { kind: 'reps', reps: 10, sets: 3 }, '10 · 3 sets'],
    ['sets only', { kind: 'reps', sets: 3 }, '3 sets'],
    ['timer', { kind: 'timer', seconds: 300 }, '5 min'],
    ['timer under a minute rounds up to 1', { kind: 'timer', seconds: 20 }, '1 min'],
    ['checkoff with a label', { kind: 'checkoff', label: 'Done' }, 'Done'],
    ['checkoff without a label', { kind: 'checkoff' }, ''],
    ['measure is its unit', { kind: 'measure', metric: 'Weight', unit: 'kg' }, 'kg'],
    ['read has no target', { kind: 'read' }, ''],
  ])('%s', (_name, tool, expected) => {
    expect(targetText(step(tool))).toBe(expected);
  });
});

describe('StepHeader — plain target, Form beside it, no TARGET box', () => {
  it('draws the target as text on one row with the Form link', () => {
    render(
      <StepHeader
        step={step({ kind: 'reps', reps: 12, load: 'bodyweight', sets: 2 }, { video_query: 'goblet squat form' })}
      />,
    );
    const target = screen.getByText('12 × bodyweight · 2 sets');
    const form = screen.getByRole('link', { name: 'Form' });
    expect(target.parentElement).toBe(form.parentElement);
    expect(target.parentElement!.style.display).toBe('flex');
    expect(screen.queryByText(/^target$/i)).toBeNull();
    expect(target.style.border).toBe('');
  });

  it('a step with no target and no video draws only the title and cue', () => {
    render(<StepHeader step={step({ kind: 'read' }, { body: 'Walk it off.' })} />);
    expect(screen.getByText('Goblet squat')).toBeInTheDocument();
    expect(screen.getByText('Walk it off.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/target/i)).toBeNull();
  });

  it('a long cue folds with "more"', () => {
    render(<StepHeader step={step({ kind: 'read' }, { body: 'Brace, sit back, stand tall. '.repeat(8) })} />);
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
  });
});
