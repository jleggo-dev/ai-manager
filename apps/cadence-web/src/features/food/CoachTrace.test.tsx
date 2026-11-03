/**
 * The trace line is built from what ran, so its wording is a router over the lines: a remembered
 * part counts as "picked before", not as a lookup; nothing at all draws nothing; what was not
 * read stays in the open outside the disclosure.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CoachTrace } from './CoachTrace.tsx';
import { traceSummary } from './traceSummary.ts';

afterEach(cleanup);

describe('traceSummary', () => {
  it.each([
    [['banana: your foods: 1 rows'], 1, '1 part looked up · 1 call'],
    [['banana: your foods: 1 rows', 'milk: USDA: 2 imported'], 2, '2 parts looked up · 2 calls'],
    [
      ['latte: picked before, no lookup needed', 'banana: your foods: 1 rows'],
      1,
      '1 part looked up · 1 picked before · 1 call',
    ],
    [['latte: picked before, no lookup needed'], 0, '1 part picked before'],
    [['a: picked before, no lookup needed', 'b: picked before, no lookup needed'], undefined, '2 parts picked before'],
  ])('%j, %s calls → %j', (lines, calls, summary) => {
    expect(traceSummary(lines, calls)).toBe(summary);
  });
});

describe('CoachTrace', () => {
  it('draws the summary with the lines behind it, and what was not read in the open', () => {
    render(
      <CoachTrace
        coach={{
          reached: true,
          calls: 1,
          checked: ['banana: your foods: 1 rows'],
          not_read: ['"a thing" not read — x'],
        }}
      />,
    );
    expect(screen.getByText('1 part looked up · 1 call')).toBeInTheDocument();
    expect(screen.getByText('banana: your foods: 1 rows')).toBeInTheDocument();
    expect(screen.getByText('Not read: "a thing" not read — x.')).toBeInTheDocument();
  });

  it('draws nothing when nothing ran and nothing was left out', () => {
    const { container } = render(<CoachTrace coach={{ reached: true, calls: 1, checked: [] }} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const none = render(<CoachTrace coach={undefined} />);
    expect(none.container).toBeEmptyDOMElement();
  });
});
