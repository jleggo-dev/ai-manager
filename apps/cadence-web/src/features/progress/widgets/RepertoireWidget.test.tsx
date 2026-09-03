import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { RepertoirePayload } from '@cadence/shared';
import { RepertoireWidget } from './RepertoireWidget.tsx';

/**
 * "Progress counts what was learned this year" (design frame 2c, owner 2026-09-02): pins the
 * by-year section of the repertoire card — the by-month list stays in the order the resolver
 * already sorted it, a week count never reads 0, a bar never collapses to nothing even when a
 * year has zero, and the noun in the footer comes from the payload, never a word hard-coded here.
 * The resolver's own rulings (retired counts, backfill never counted into a year) are pinned in
 * progress-nontemporal-repertoire.test.ts — this file only pins what the WIDGET does with the
 * numbers it is handed.
 */
function payload(over: Partial<RepertoirePayload> = {}): RepertoirePayload {
  return {
    items: [],
    learned: 0,
    in_progress: 0,
    noun: 'pieces',
    learned_in_year: 0,
    learned_by_month: [],
    years: [
      { year: 2024, count: 0 },
      { year: 2025, count: 0 },
      { year: 2026, count: 0 },
    ],
    learning: 0,
    keeping_up: 0,
    ...over,
  };
}

describe('RepertoireWidget — the by-year section', () => {
  it('lists this year’s learned pieces in the order the resolver already sorted them, one row per piece', () => {
    const data = payload({
      learned_in_year: 3,
      learned_by_month: [
        { month: '2026-02', label: 'Nocturne in E-flat', weeks: 8 },
        { month: '2026-05', label: 'Écossaise', weeks: 5 },
        { month: '2026-05', label: 'Fast study', weeks: 1 },
      ],
    });
    const { container } = render(<RepertoireWidget data={data} />);
    const rows = Array.from(container.querySelectorAll('.pw-rep-year-row')).map((r) => r.textContent);
    // Never re-sorted by the widget, and a rounded-up week count of 1 never prints as 0.
    expect(rows).toEqual(['Nocturne in E-flat · 8 wks', 'Écossaise · 5 wks', 'Fast study · 1 wks']);
  });

  it('renders no by-year section at all when nothing was learned this year — never an empty list', () => {
    const { container } = render(<RepertoireWidget data={payload()} />);
    expect(container.querySelector('.pw-rep-year')).toBeNull();
  });

  it('draws one bar per trailing year — a year with zero still gets a visible bar, never a collapsed one', () => {
    const data = payload({
      years: [
        { year: 2024, count: 0 },
        { year: 2025, count: 1 },
        { year: 2026, count: 6 },
      ],
    });
    const { container } = render(<RepertoireWidget data={data} />);
    const bars = Array.from(container.querySelectorAll<HTMLElement>('.pw-rep-bar-fill'));
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(parseInt(bar.style.height, 10)).toBeGreaterThan(0);
    }
    const labels = Array.from(container.querySelectorAll('.pw-rep-bar-col')).map((b) => b.textContent);
    expect(labels).toEqual(['0’24', '1’25', '6’26']);
  });

  it('the footer names the noun from the payload, never a hard-coded word — "learned", not "pieces", is the fixed part', () => {
    const { getByText } = render(<RepertoireWidget data={payload({ noun: 'verses' })} />);
    expect(getByText('Measured in verses learned, not minutes practiced.', { exact: false })).toBeTruthy();
  });
});
