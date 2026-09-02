/**
 * What these pin (canvas A3): every gesture's boring twin is here, worded exactly as drawn; the
 * cookbook row appears only for a part that is actually in the cookbook; and each row is a pure
 * callback — the menu decides nothing itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PartMenu, type PartMenuProps } from './PartMenu.tsx';

const noop = () => {};

function menuProps(overrides: Partial<PartMenuProps> = {}): PartMenuProps {
  return {
    label: 'Chia bowl',
    memberCount: 4,
    kcal: 348,
    onRename: noop,
    onAddTo: noop,
    onTakeOut: noop,
    onUngroup: noop,
    onYield: noop,
    onClose: noop,
    ...overrides,
  };
}

afterEach(cleanup);

describe('PartMenu', () => {
  it('carries the canvas copy verbatim, subtitles included', () => {
    render(<PartMenu {...menuProps()} />);
    expect(screen.getByText('Rename it')).toBeInTheDocument();
    expect(screen.getByText('Add something to this')).toBeInTheDocument();
    expect(screen.getByText('search, say it, or scan')).toBeInTheDocument();
    expect(screen.getByText('Take something out')).toBeInTheDocument();
    expect(screen.getByText('tick what should leave the bowl')).toBeInTheDocument();
    expect(screen.getByText('Ungroup it')).toBeInTheDocument();
    expect(screen.getByText('four loose things again, same numbers')).toBeInTheDocument();
    expect(screen.getByText('It makes several portions')).toBeInTheDocument();
    expect(screen.getByText('give it a yield')).toBeInTheDocument();
  });

  it('fires the right callback for each row', () => {
    const spies = {
      onRename: vi.fn(),
      onAddTo: vi.fn(),
      onTakeOut: vi.fn(),
      onUngroup: vi.fn(),
      onYield: vi.fn(),
    };
    render(<PartMenu {...menuProps(spies)} />);
    fireEvent.click(screen.getByText('Rename it'));
    fireEvent.click(screen.getByText('Add something to this'));
    fireEvent.click(screen.getByText('Take something out'));
    fireEvent.click(screen.getByText('Ungroup it'));
    fireEvent.click(screen.getByText('It makes several portions'));
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the cookbook row exists only for a part that is in the cookbook', () => {
    const onRemoveFromCookbook = vi.fn();
    const { rerender } = render(<PartMenu {...menuProps({ onRemoveFromCookbook })} />);
    expect(screen.queryByText('Remove it from my cookbook')).toBeNull();
    rerender(<PartMenu {...menuProps({ inCookbook: true, onRemoveFromCookbook })} />);
    expect(screen.getByText(/4 things · 348 kcal · in your cookbook/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove it from my cookbook'));
    expect(onRemoveFromCookbook).toHaveBeenCalledTimes(1);
  });

  it('the ungroup note counts this meal honestly', () => {
    render(<PartMenu {...menuProps({ mealKcal: 840, readsNow: 3 })} />);
    // 3 rows now; ungrouping a 4-member bracket reads as 3 − 1 + 4 = six things.
    expect(
      screen.getByText(/Ungrouping never removes food from your day\. It's the same 840 kcal, read as six things instead of three\./),
    ).toBeInTheDocument();
  });

  it('tapping the backdrop closes; tapping the sheet does not', () => {
    const onClose = vi.fn();
    const { container } = render(<PartMenu {...menuProps({ onClose })} />);
    fireEvent.click(screen.getByRole('dialog', { name: 'Chia bowl' }));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = container.querySelector('.mb-sheet-backdrop');
    expect(backdrop).not.toBeNull();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
