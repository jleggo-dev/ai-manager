import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitButton } from './CommitButton.tsx';
import { commitButtonClass } from './commitButtonClass.ts';

describe('commitButtonClass — which look a button gets', () => {
  it.each([
    ['full', false, undefined, 'commit-btn'],
    ['compact', false, undefined, 'commit-btn commit-btn--compact'],
    ['compact', true, undefined, 'commit-btn commit-btn--compact commit-btn--inline'],
    ['full', true, undefined, 'commit-btn commit-btn--inline'],
    ['full', false, 'ms-ds-go', 'commit-btn ms-ds-go'],
    ['compact', false, 'fa-log', 'commit-btn commit-btn--compact fa-log'],
    // Near-misses: an empty layout class adds nothing, and full never gains the compact class.
    ['full', false, '', 'commit-btn'],
  ] as const)('%s inline=%s extra=%s → %s', (size, inline, extra, want) => {
    expect(commitButtonClass(size, inline, extra)).toBe(want);
  });
});

describe('CommitButton', () => {
  it('is a plain button by default, so it never submits a form', () => {
    render(<CommitButton>Log</CommitButton>);
    expect(screen.getByRole('button', { name: 'Log' })).toHaveAttribute('type', 'button');
  });

  it('passes clicks through, and none while disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<CommitButton onClick={onClick}>Save</CommitButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <CommitButton onClick={onClick} disabled>
        Save
      </CommitButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a screen class for layout alongside its own', () => {
    render(
      <CommitButton size="compact" className="cfm-build">
        Build it
      </CommitButton>,
    );
    expect(screen.getByRole('button').className).toBe('commit-btn commit-btn--compact cfm-build');
  });
});
