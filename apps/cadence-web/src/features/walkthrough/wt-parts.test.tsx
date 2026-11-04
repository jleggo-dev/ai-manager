/**
 * The step header after the 2026-11-03 design ruling: the target is plain text with the video link
 * beside it, and there is no TARGET label or box. `targetText` is the one source of that text (the
 * header and the all-steps list both read it), so its grammar is pinned per tool kind.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { StepHeader } from './wt-parts.tsx';
import { rowReceipt, targetText } from './wt-styles.ts';

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
    // Sets of a timed effort read like the reps line, in seconds (walkthrough v3 design B).
    ['timer in sets with a load', { kind: 'timer', seconds: 45, sets: 4, load: '40 lb' }, '45 s × 40 lb · 4 sets'],
    ['timer in sets, no load', { kind: 'timer', seconds: 30, sets: 3 }, '30 s · 3 sets'],
    ['timer in sets of whole minutes', { kind: 'timer', seconds: 120, sets: 2 }, '2 min · 2 sets'],
    ['timer in sets, odd seconds', { kind: 'timer', seconds: 90, sets: 3 }, '1:30 · 3 sets'],
    ['a single hold with a load', { kind: 'timer', seconds: 60, load: '10 kg' }, '1 min × 10 kg'],
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

describe('StepHeader — Change this move (walkthrough v3 Phase 5)', () => {
  it('draws the Change button beside the target, before the Form link, only when asked to', () => {
    const onChange = vi.fn();
    render(
      <StepHeader
        step={step({ kind: 'reps', reps: 12, load: 'bodyweight', sets: 2 }, { video_query: 'goblet squat form' })}
        onChange={onChange}
      />,
    );
    const target = screen.getByText('12 × bodyweight · 2 sets');
    const change = screen.getByRole('button', { name: 'Change' });
    const form = screen.getByRole('link', { name: 'Form' });
    expect(change.parentElement).toBe(target.parentElement);
    expect([...target.parentElement!.children].indexOf(change)).toBeLessThan(
      [...target.parentElement!.children].indexOf(form),
    );
    fireEvent.click(change);
    expect(onChange).toHaveBeenCalled();
    cleanup();
    render(<StepHeader step={step({ kind: 'reps', reps: 12, sets: 2 })} />);
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it("the weight the person added shows in the target in place of the plan's", () => {
    render(<StepHeader step={step({ kind: 'reps', reps: 12, load: 'bodyweight', sets: 2 })} workingLoad="15 lb" />);
    expect(screen.getByText('12 × 15 lb · 2 sets')).toBeInTheDocument();
    expect(screen.queryByText(/bodyweight/)).toBeNull();
  });

  it('a swapped step carries "Swapped from … · Undo" above its title; Undo calls back', () => {
    const onUndoSwap = vi.fn();
    render(
      <StepHeader
        step={{
          ...step({ kind: 'reps', reps: 12, load: '40 lb', sets: 2 }),
          title: 'Kettlebell hip thrust',
          swapped_from: 'Glute bridge',
        }}
        onUndoSwap={onUndoSwap}
      />,
    );
    expect(screen.getByText('Swapped from Glute bridge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndoSwap).toHaveBeenCalled();
  });
});

describe('rowReceipt — a swapped step never reads as a skip', () => {
  const thrust = {
    ...step({ kind: 'reps', reps: 12, load: '40 lb', sets: 2 }),
    title: 'Kettlebell hip thrust',
    swapped_from: 'Glute bridge',
  };
  it.each<[string, Parameters<typeof rowReceipt>, string]>([
    [
      'logged',
      [thrust, { kind: 'reps', sets: [12, 12], load: '40 lb' }, false, 'logged'],
      '2×12 @ 40 lb · swapped from Glute bridge',
    ],
    ['here now', [thrust, undefined, true, 'current'], 'Swapped from Glute bridge · Here now'],
    [
      'passed over',
      [thrust, undefined, false, 'skipped'],
      'Swapped from Glute bridge · Passed over · you can still do it',
    ],
    ['not reached', [thrust, undefined, false, 'untouched'], 'Swapped from Glute bridge · 2 × 12'],
    [
      'an unswapped step is unchanged',
      [step({ kind: 'reps', reps: 12, sets: 2 }), undefined, false, 'skipped'],
      'Passed over · you can still do it',
    ],
  ])('%s', (_name, args, expected) => {
    expect(rowReceipt(...args)).toBe(expected);
  });
});
