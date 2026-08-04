import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { JournalWrite } from './JournalWrite.tsx';

/**
 * The bell is the one part of the timed free-write a screenshot can't reach: it fires minutes in,
 * and the dev preview reloads whenever a file changes. Fake timers make it deterministic — and
 * assert the behaviour that actually matters, which is everything the bell must NOT do.
 */
vi.mock('../walkthrough/tools/chime.ts', () => ({ playChime: vi.fn() }));
vi.mock('../../lib/api.ts', () => ({ keepJournalEntry: vi.fn(async () => ({ entry_id: 'x' })) }));

const open = () =>
  render(
    <JournalWrite
      openWith={{ bank: null, prompt: null, minutes: 3 }}
      onClose={() => undefined}
      onKept={() => undefined}
    />,
  );

/** Choose the pure free-write row — the press that starts the clock. */
async function startPureRow() {
  const row = screen.getByText('PURE FREE-WRITE').closest('button');
  await act(async () => {
    row?.click();
  });
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('the timed free-write, start to bell', () => {
  it('opens on the start sheet when the coach issued a duration', () => {
    open();
    expect(screen.getByText('Three minutes — pick a place to start')).toBeTruthy();
    expect(screen.getByText('Choosing starts the timer.')).toBeTruthy();
  });

  it('starts the clock on the press, not on arrival', async () => {
    open();
    expect(document.querySelector('.fw-rail')).toBeNull();
    await startPureRow();
    expect(document.querySelector('.fw-rail')).toBeTruthy();
  });

  it('drops the dock mid-session — a running clock already answered both its questions', async () => {
    open();
    await startPureRow();
    expect(screen.queryByText('Start from a question')).toBeNull();
    expect(screen.queryByText(/I wrote on paper today/)).toBeNull();
  });

  it('rings once at the end, and says so without deciding anything', async () => {
    open();
    await startPureRow();
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 2000);
    });
    expect(screen.getByText("Three minutes. Save whenever you're ready.")).toBeTruthy();
  });

  it('does NOT save at the bell — Save stays the reader’s to press', async () => {
    const { keepJournalEntry } = await import('../../lib/api.ts');
    open();
    await startPureRow();
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 2000);
    });
    // The whole reason the duplicate-entry bug is gone: one entry, one save, always.
    expect(keepJournalEntry).not.toHaveBeenCalled();
  });

  it('does NOT take the screen at the bell — the writing is still there', async () => {
    open();
    await startPureRow();
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 2000);
    });
    expect(document.querySelector('textarea')).toBeTruthy();
    expect(screen.queryByText('Keep writing')).toBeNull();
  });

  it('stops nudging once the bell has rung — "keep going" would argue with the clock', async () => {
    open();
    await startPureRow();
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 20_000);
    });
    expect(screen.queryByText('keep going — anything counts')).toBeNull();
  });
});
