/**
 * What these pin (canvas turn-2 B1 + A3's tick-list): select mode emits ITEM INDEXES and nothing
 * else; the running bar counts what is ticked; grouping needs two (a recipe of one isn't a
 * recipe); and the same component serves both directions with only the words changing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { MealItem } from '@cadence/shared';
import { SelectMode } from './SelectMode.tsx';

const items: MealItem[] = [
  { name: 'Greek yogurt, plain 2%', qty: 1, unit: 'cup', est: { kcal: 146 } },
  { name: 'Chia seeds', qty: 1, unit: 'tbsp', est: { kcal: 58 } },
  { name: 'Chocolate chip muffin', qty: 1, unit: 'muffin', est: { kcal: 430 } },
  { name: 'Whey protein, vanilla', qty: 1, unit: 'scoop', est: { kcal: 120 } },
  { name: 'Strawberries, raw', qty: 0.5, unit: 'cup', est: { kcal: 24 } },
];

afterEach(cleanup);

describe('group mode', () => {
  it('ticks build the bar and confirm emits exactly those indexes', () => {
    const onConfirm = vi.fn();
    render(
      <SelectMode
        mode="group"
        items={items}
        eligible={[0, 1, 2, 3, 4]}
        mealName="breakfast"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Group things')).toBeInTheDocument();
    expect(
      screen.getByText('Tap what belongs together. They stay in the same breakfast either way.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Greek yogurt, plain 2%'));
    fireEvent.click(screen.getByText('Chia seeds'));
    fireEvent.click(screen.getByText('Whey protein, vanilla'));
    fireEvent.click(screen.getByText('Strawberries, raw'));
    expect(screen.getByText('4 selected · 348 kcal')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Group these four' });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith([0, 1, 3, 4]);
  });

  it('unticking removes; below two the button holds', () => {
    render(<SelectMode mode="group" items={items} eligible={[0, 1, 2]} onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Greek yogurt, plain 2%'));
    fireEvent.click(screen.getByText('Chia seeds'));
    fireEvent.click(screen.getByText('Chia seeds'));
    expect(screen.getByText('1 selected · 146 kcal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group these one' })).toBeDisabled();
  });

  it('All ticks every eligible row — and only the eligible ones', () => {
    const onConfirm = vi.fn();
    render(<SelectMode mode="group" items={items} eligible={[0, 2, 4]} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('All'));
    expect(screen.getByText('3 selected · 600 kcal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group these three' }));
    expect(onConfirm).toHaveBeenCalledWith([0, 2, 4]);
  });

  it('Cancel walks away', () => {
    const onCancel = vi.fn();
    render(<SelectMode mode="group" items={items} eligible={[0, 1]} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('takeOut mode', () => {
  it('the same list, ticking what should leave — one is enough', () => {
    const onConfirm = vi.fn();
    render(
      <SelectMode mode="takeOut" items={items} eligible={[0, 1, 2, 3]} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    expect(screen.getByText('Take something out')).toBeInTheDocument();
    expect(screen.getByText('Tick what should leave.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chocolate chip muffin'));
    const one = screen.getByRole('button', { name: 'Take it out' });
    expect(one).toBeEnabled();
    fireEvent.click(screen.getByText('Chia seeds'));
    fireEvent.click(screen.getByRole('button', { name: 'Take these two out' }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });
});
