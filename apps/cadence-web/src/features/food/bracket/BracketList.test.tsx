/**
 * What these pin (canvas A1/A4): a part draws as pill + indented members; collapsed is ONE row —
 * name, "N things", total kcal, ⌄; a loose row has no bracket; yield rides the same mark (butter,
 * "1 of N servings", no new row type); and with no wiring the list is inert — the diary's use.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { MealItem, MealPart } from '@cadence/shared';
import { BracketList } from './BracketList.tsx';

const items: MealItem[] = [
  { name: 'Greek yogurt, plain 2%', est: { kcal: 146 }, part: 'p1' },
  { name: 'Chia seeds', est: { kcal: 58 }, part: 'p1' },
  { name: 'Whey protein, vanilla', est: { kcal: 120 }, part: 'p1' },
  { name: 'Strawberries, raw', est: { kcal: 24 }, part: 'p1' },
  { name: 'Chocolate chip muffin', est: { kcal: 430 } },
];
const parts: MealPart[] = [{ key: 'p1', name: 'Chia bowl' }];

const renderRow = (item: MealItem) => <span>{item.name}</span>;

afterEach(cleanup);

describe('BracketList', () => {
  it('draws an open part as pill + indented members, and the muffin loose', () => {
    const { container } = render(<BracketList items={items} parts={parts} renderRow={renderRow} />);
    expect(screen.getByText('Chia bowl')).toBeInTheDocument();
    expect(screen.getByText('348 kcal')).toBeInTheDocument();
    // All four members render through the caller's renderRow, inside the bracket's card.
    expect(container.querySelectorAll('.mb-member')).toHaveLength(4);
    expect(screen.getByText('Greek yogurt, plain 2%')).toBeInTheDocument();
    // The muffin sits outside: no indent, a dormant notch in its gutter.
    expect(container.querySelectorAll('.mb-loose')).toHaveLength(1);
    expect(screen.getByText('Chocolate chip muffin')).toBeInTheDocument();
  });

  it('is inert without wiring: no notch handle, no ⌃, no ⋯', () => {
    const { container } = render(<BracketList items={items} parts={parts} renderRow={renderRow} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('collapsed = one row: name, "4 things", total kcal, expandable', () => {
    const onToggleCollapse = vi.fn();
    const { container } = render(
      <BracketList
        items={items}
        parts={parts}
        renderRow={renderRow}
        collapsed={{ p1: true }}
        onToggleCollapse={onToggleCollapse}
      />,
    );
    expect(screen.getByText('4 things')).toBeInTheDocument();
    expect(screen.getByText('348')).toBeInTheDocument();
    expect(container.querySelectorAll('.mb-member')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Chia bowl' }));
    expect(onToggleCollapse).toHaveBeenCalledWith('p1');
  });

  it('open part offers ⌃ to collapse and ⋯ for the menu when wired', () => {
    const onToggleCollapse = vi.fn();
    const onOpenMenu = vi.fn();
    render(
      <BracketList items={items} parts={parts} renderRow={renderRow} onToggleCollapse={onToggleCollapse} onOpenMenu={onOpenMenu} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chia bowl' }));
    expect(onToggleCollapse).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'More for Chia bowl' }));
    expect(onOpenMenu).toHaveBeenCalledWith('p1');
  });

  it('yield rides the same mark: butter bracket, "1 of 4 servings", no new row type', () => {
    const stew: MealItem[] = [
      { name: 'Chickpeas', est: { kcal: 80 }, part: 'p1' },
      { name: 'Spinach', est: { kcal: 45 }, part: 'p1' },
    ];
    const stewPart: MealPart[] = [
      { key: 'p1', name: 'Chickpea & spinach stew', yield_servings: 4, servings_logged: 1 },
    ];
    const { container } = render(
      <BracketList items={stew} parts={stewPart} renderRow={renderRow} collapsed={{ p1: true }} />,
    );
    expect(screen.getByText('1 of 4 servings')).toBeInTheDocument();
    expect(container.querySelector('.mb-part--yield')).not.toBeNull();
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('an unnamed part reads as its count and still collapses', () => {
    const unnamed: MealPart[] = [{ key: 'p1', name: null }];
    render(<BracketList items={items} parts={unnamed} renderRow={renderRow} collapsed={{ p1: true }} />);
    // The label and the sub both say "4 things": the pill line and the count line.
    expect(screen.getAllByText('4 things').length).toBeGreaterThanOrEqual(1);
  });
});
