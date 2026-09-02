/**
 * What these pin (canvas A2-mid-drag, C3, B3): the card asks "What do you call this?" and never
 * says "group" or "recipe" outside the canvas's own save subtitles; the chips are the caller's
 * words; naming is skippable; the portions question defaults to "Just this one"; and the B3 offer
 * is a preview of the mark with a free decline.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NamePartCard, type NamePartCardProps } from './NamePartCard.tsx';

function cardProps(overrides: Partial<NamePartCardProps> = {}): NamePartCardProps {
  return {
    count: 4,
    est: { kcal: 348, protein_g: 47, carbs_g: 22, fat_g: 9 },
    chips: ['Chia bowl', 'My usual'],
    onName: vi.fn(),
    onYield: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('the name variant', () => {
  it('asks with the ruled words and sums the bracket', () => {
    render(<NamePartCard {...cardProps()} />);
    expect(screen.getByText('Four things together')).toBeInTheDocument();
    expect(screen.getByText('348 kcal · 47P 22C 9F')).toBeInTheDocument();
    expect(screen.getByLabelText('What do you call this?')).toBeInTheDocument();
    expect(screen.getByText("Skip the name if you'd rather.")).toBeInTheDocument();
  });

  it('a chip is the fastest name; typing and clearing reports null', () => {
    const onName = vi.fn();
    render(<NamePartCard {...cardProps({ onName })} />);
    fireEvent.click(screen.getByText('Chia bowl'));
    expect(onName).toHaveBeenLastCalledWith('Chia bowl');
    const input = screen.getByLabelText('What do you call this?');
    fireEvent.change(input, { target: { value: 'Yogurt bowl' } });
    expect(onName).toHaveBeenLastCalledWith('Yogurt bowl');
    fireEvent.change(input, { target: { value: '  ' } });
    expect(onName).toHaveBeenLastCalledWith(null);
  });

  it('the portions question: "Just this one" is the default, several brings the stepper', () => {
    const onYield = vi.fn();
    render(<NamePartCard {...cardProps({ onYield })} />);
    expect(screen.getByText('HOW MANY PORTIONS DID IT MAKE?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Just this one/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /It made several/ }));
    expect(onYield).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: 'More portions' }));
    expect(onYield).toHaveBeenLastCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: 'Fewer portions' }));
    expect(onYield).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: /Just this one/ }));
    expect(onYield).toHaveBeenLastCalledWith(1);
  });

  it('Save it and No thanks are the only doors', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<NamePartCard {...cardProps({ onSave, onCancel })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save it' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the offer variant (B3)', () => {
  it('previews the mark with the canvas words, and declining is free', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <NamePartCard
        {...cardProps({ onSave, onCancel })}
        variant="offer"
        previewNames={['yogurt', 'chia', 'whey', 'strawberries']}
      />,
    );
    expect(screen.getByText('Four things, one after another. Do they go together?')).toBeInTheDocument();
    expect(screen.getByText('These four, as one thing')).toBeInTheDocument();
    expect(screen.getByText(/yogurt · chia · whey · strawberries/)).toBeInTheDocument();
    expect(screen.getByText(/348 kcal · 47P 22C 9F/)).toBeInTheDocument();
    expect(
      screen.getByText("Leave them and nothing is lost — I'll ask again on Sunday if it keeps happening."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, together' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // The offer never asks the portions question — that comes later, of the bracket itself.
    expect(screen.queryByText('HOW MANY PORTIONS DID IT MAKE?')).toBeNull();
  });
});
