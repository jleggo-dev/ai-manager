import { render, screen, fireEvent } from '@testing-library/react';
import type { PlanOccurrence } from '../lib/api.ts';
import { OccurrenceRow } from './OccurrenceRow.tsx';

const base: PlanOccurrence = {
  occurrence_id: 'occ-1',
  activity_id: 'act-1',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  time_of_day: 'morning',
};

describe('OccurrenceRow', () => {
  it('dashboard variant shows module glyph and Open title', () => {
    const onCheck = vi.fn();
    const onOpen = vi.fn();
    render(<OccurrenceRow o={base} variant="dashboard" onCheck={onCheck} onOpen={onOpen} />);

    expect(screen.getByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('morning')).toBeInTheDocument();
    expect(document.querySelector('.occ-mod')).toBeTruthy();
    expect(screen.getByTitle('Open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'skip' })).toBeInTheDocument();
  });

  it('week variant omits module glyph and uses See the session title', () => {
    render(<OccurrenceRow o={base} variant="week" onCheck={vi.fn()} onOpen={vi.fn()} />);
    expect(document.querySelector('.occ-mod')).toBeNull();
    expect(screen.getByTitle('See the session')).toBeInTheDocument();
  });

  it('toggles done via check and skip via skip button', () => {
    const onCheck = vi.fn();
    render(<OccurrenceRow o={base} variant="week" onCheck={onCheck} onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onCheck).toHaveBeenCalledWith(base, 'done');

    fireEvent.click(screen.getByRole('button', { name: 'skip' }));
    expect(onCheck).toHaveBeenCalledWith(base, 'skipped');
  });

  it('system non-food/weigh rows are not openable', () => {
    const o: PlanOccurrence = {
      ...base,
      kind: 'system',
      title: 'Rest reminder',
    };
    render(<OccurrenceRow o={o} variant="week" onCheck={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByTitle('See the session')).not.toBeInTheDocument();
    expect(screen.getByText('Rest reminder')).toBeInTheDocument();
  });
});
