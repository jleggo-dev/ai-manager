/** Each row of the trim is a button, so the taps get their table: what a tap changes, in the
 *  minutes, in her line and in what Start hands over. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WalkthroughStep } from '@cadence/shared';
import { StartTrim } from './StartTrim.tsx';
import { proposeTrim } from './trim.ts';

vi.mock('../../../components/CoachFace.tsx', () => ({ CoachFace: () => null }));

const step = (title: string, minutes: number, core: boolean, skippable: boolean): WalkthroughStep => ({
  id: title,
  title,
  minutes,
  tool: { kind: 'checkoff', label: 'Done' },
  core,
  skippable,
});

// In the session's order, with her first cut (Warm up) ahead of what she keeps.
const steps = [step('Warm up', 5, false, true), step('Run', 35, true, false), step('Cool down', 10, false, false)];

function mount(level = 0) {
  const onConfirm = vi.fn();
  const onTrimMore = vi.fn();
  const proposal = proposeTrim({ total_min: 50, steps }, level)!;
  render(
    <StartTrim steps={steps} proposal={proposal} onConfirm={onConfirm} onTrimMore={onTrimMore} onBack={() => {}} />,
  );
  return { onConfirm, onTrimMore };
}

const row = (title: string) => screen.getByRole('button', { name: new RegExp(title) });
const start = () => screen.getByRole('button', { name: /^Start/ }) as HTMLButtonElement;

afterEach(cleanup);

describe('StartTrim — the person chooses what stays', () => {
  it('opens on her proposal, every step a row in the session order', () => {
    mount();
    expect(row('Warm up').getAttribute('aria-pressed')).toBe('false');
    expect(row('Run').getAttribute('aria-pressed')).toBe('true');
    expect(row('Cool down').getAttribute('aria-pressed')).toBe('true');
    expect(start().textContent).toBe('Start · 45 min');
    expect(screen.getByText(/Here's what I'd drop/)).toBeTruthy();
  });

  it.each([
    { name: 'a cut step put back', taps: ['Warm up'], kept: ['Warm up', 'Run', 'Cool down'], label: 'Start · 50 min' },
    { name: 'a kept step dropped', taps: ['Cool down'], kept: ['Run'], label: 'Start · 35 min' },
    { name: 'the core dropped', taps: ['Run'], kept: ['Cool down'], label: 'Start · 10 min' },
    { name: 'one of each', taps: ['Warm up', 'Cool down'], kept: ['Warm up', 'Run'], label: 'Start · 40 min' },
    { name: 'a tap taken back', taps: ['Run', 'Run'], kept: ['Run', 'Cool down'], label: 'Start · 45 min' },
  ])('$name reaches Start', ({ taps, kept, label }) => {
    const { onConfirm } = mount();
    for (const t of taps) fireEvent.click(row(t));
    expect(start().textContent).toBe(label);
    fireEvent.click(start());
    expect(onConfirm.mock.calls[0]![0].kept.map((s: WalkthroughStep) => s.title)).toEqual(kept);
  });

  it('a row stays where it is when tapped', () => {
    mount();
    const order = () => [...document.querySelectorAll('.strim-t')].map((t) => t.textContent);
    expect(order()).toEqual(['Warm up', 'Run', 'Cool down']);
    fireEvent.click(row('Warm up'));
    fireEvent.click(row('Run'));
    expect(order()).toEqual(['Warm up', 'Run', 'Cool down']);
  });

  it('with everything dropped there is nothing to start, and she says why', () => {
    const { onConfirm } = mount();
    fireEvent.click(row('Run'));
    fireEvent.click(row('Cool down'));
    expect(start().disabled).toBe(true);
    expect(screen.getByText(/keep at least one step/)).toBeTruthy();
    fireEvent.click(start());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"trim more" is offered on her proposal, gone once the person changes it, back if they undo that', () => {
    const { onTrimMore } = mount();
    const more = () => screen.queryByRole('button', { name: /trim more/ });
    expect(more()).toBeTruthy();
    fireEvent.click(row('Warm up'));
    expect(more()).toBeNull();
    fireEvent.click(row('Warm up'));
    fireEvent.click(more()!);
    expect(onTrimMore).toHaveBeenCalledTimes(1);
  });
});
