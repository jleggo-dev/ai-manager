import { render, screen, fireEvent } from '@testing-library/react';
import type { ProgressCard } from '@cadence/shared';
import { ProgressCardView } from './ProgressCards.tsx';
import type { GoalEventAddState } from '../features/today/useGoalEventAdd.ts';

const idleAdd: GoalEventAddState = {
  addFor: null,
  addLabel: '',
  busy: false,
  setAddFor: vi.fn(),
  setAddLabel: vi.fn(),
  submitAdd: vi.fn(),
};

describe('ProgressCardView — locks pre-WEB-04 surface drift', () => {
  it('count card is identical on both variants (shared add-one control)', () => {
    const card: ProgressCard = {
      kind: 'count',
      area: 'mind',
      title: 'Books',
      goal_id: 'g1',
      current: 3,
      target: 12,
      unit: 'books',
    };
    const { rerender } = render(<ProgressCardView card={card} variant="dashboard" add={idleAdd} />);
    expect(screen.getByText('Books')).toBeInTheDocument();
    expect(screen.getByText('/12 books')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ add one' })).toBeInTheDocument();

    rerender(<ProgressCardView card={card} variant="progress" add={idleAdd} />);
    expect(screen.getByText('Books')).toBeInTheDocument();
    expect(screen.getByText('/12 books')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ add one' })).toBeInTheDocument();
  });

  it('dashboard consistency: hides nourishment, rings movement, dots practice', () => {
    const nourishment: ProgressCard = {
      kind: 'consistency',
      area: 'nourishment',
      title: 'Meals',
      kept: 2,
      window: 7,
    };
    const { container, rerender } = render(<ProgressCardView card={nourishment} variant="dashboard" add={idleAdd} />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ProgressCardView
        card={{ kind: 'consistency', area: 'movement', title: 'Movement', kept: 3, window: 7 }}
        variant="dashboard"
        add={idleAdd}
      />,
    );
    expect(screen.getByText('showed up 3 of 7 days')).toBeInTheDocument();
    expect(document.querySelector('.dash-ringcard')).toBeTruthy();

    rerender(
      <ProgressCardView
        card={{ kind: 'consistency', area: 'practice', title: 'Prayer', kept: 0, window: 7 }}
        variant="dashboard"
        add={idleAdd}
      />,
    );
    expect(screen.getByText(/a fresh week — a missed day is information/)).toBeInTheDocument();
  });

  it('progress consistency keeps the lean "of N days" copy', () => {
    render(
      <ProgressCardView
        card={{ kind: 'consistency', area: 'movement', title: 'Movement', kept: 4, window: 7 }}
        variant="progress"
        add={idleAdd}
      />,
    );
    expect(screen.getByText('of 7 days')).toBeInTheDocument();
    expect(screen.getByText(/this week — a missed day is information/)).toBeInTheDocument();
    expect(document.querySelector('.dash-ringcard')).toBeNull();
  });

  it('latest_vs_target preserves start-copy drift between surfaces', () => {
    const card: ProgressCard = {
      kind: 'latest_vs_target',
      area: 'movement',
      title: 'Weight',
      unit: 'kg',
      latest: 80,
      start: null,
      target: 75,
      series: [],
    };
    const { rerender } = render(<ProgressCardView card={card} variant="dashboard" add={idleAdd} />);
    expect(screen.getByText(/no start yet/)).toBeInTheDocument();

    rerender(<ProgressCardView card={card} variant="progress" add={idleAdd} />);
    expect(screen.getByText(/no starting point yet/)).toBeInTheDocument();
  });

  it('countdown: dashboard shows CountBar when milestones exist; progress keeps inline copy', () => {
    const card: ProgressCard = {
      kind: 'countdown',
      area: 'mind',
      title: 'Race day',
      end: '2026-09-01',
      days_left: 40,
      milestones_done: 1,
      milestones_total: 3,
    };
    const { container, rerender } = render(<ProgressCardView card={card} variant="dashboard" add={idleAdd} />);
    expect(screen.getByText(/stepping-stones 1\/3/)).toBeInTheDocument();
    expect(container.querySelector('.countbar')).toBeTruthy();

    rerender(<ProgressCardView card={card} variant="progress" add={idleAdd} />);
    expect(screen.getByText(/stepping-stones 1\/3 ·/)).toBeInTheDocument();
  });

  it('opens the add input when + add one is clicked', () => {
    const setAddFor = vi.fn();
    const setAddLabel = vi.fn();
    const add: GoalEventAddState = { ...idleAdd, setAddFor, setAddLabel };
    render(
      <ProgressCardView
        card={{
          kind: 'count',
          area: 'mind',
          title: 'Books',
          goal_id: 'g1',
          current: 1,
          target: 5,
          unit: 'books',
        }}
        variant="progress"
        add={add}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ add one' }));
    expect(setAddFor).toHaveBeenCalledWith('g1');
    expect(setAddLabel).toHaveBeenCalledWith('');
  });
});
