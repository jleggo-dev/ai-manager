/**
 * A session behaves like a running app (owner, 2026-11-01): the app coming back puts you back in
 * it. Reported from the piano — timer running, phone locked on the music stand, "I looked up and I
 * was back on the plan screen". The walkthrough lived only in React state, so a reclaimed webview
 * took the whole practice with it while the lock screen kept counting for a session that no longer
 * existed. These pin the shell's half: it remembers as it goes, forgets on close and Finish, and a
 * remembered session reopens on its step with a running timer caught up.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';

vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/api.ts', () => ({ keepJournalEntry: vi.fn(), settleTempo: vi.fn(async () => undefined) }));

const { Walkthrough } = await import('./Walkthrough.tsx');
const { readSessionInProgress, writeSessionInProgress } = await import('./sessionInProgress.ts');

const wt: WalkthroughData = {
  total_min: 25,
  steps: [
    { id: 's1', title: 'Scales', minutes: 5, tool: { kind: 'checkoff' }, skippable: true },
    { id: 's2', title: 'Écossaise', minutes: 20, tool: { kind: 'timer', seconds: 1200 }, skippable: false },
  ],
};

const mount = (props: Partial<Parameters<typeof Walkthrough>[0]> = {}) =>
  render(
    <Walkthrough
      walkthrough={wt}
      title="Piano practice"
      occurrenceId="o1"
      area="practice"
      onClose={() => {}}
      onComplete={() => {}}
      {...props}
    />,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Walkthrough remembers the session in progress', () => {
  it('writes as it goes — moving a step is remembered', () => {
    mount();
    expect(readSessionInProgress()?.idx).toBe(0);
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(readSessionInProgress()).toMatchObject({ occurrenceId: 'o1', idx: 1, title: 'Piano practice' });
  });

  it('forgets it on close', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(readSessionInProgress()).toBeNull();
  });

  it('forgets it on Finish', () => {
    mount();
    fireEvent.click(screen.getByText('Log this done'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step')); // → recap
    fireEvent.click(screen.getByText(/^Finish/));
    fireEvent.click(screen.getByText('Done'));
    expect(readSessionInProgress()).toBeNull();
  });

  it('remembers nothing for a run with no plan task behind it', () => {
    mount({ occurrenceId: undefined });
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(readSessionInProgress()).toBeNull();
  });

  it('a remembered RUNNING timer reopens running, caught up by the wall clock', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-01T12:10:00Z'));
    // Started 7 minutes ago into a 20-minute piece, then the app was reclaimed.
    const startedAt = Date.now() - 7 * 60 * 1000;
    writeSessionInProgress({
      occurrenceId: 'o1',
      title: 'Piano practice',
      area: 'practice',
      walkthrough: wt,
      idx: 1,
      visited: [0, 1],
      logs: {},
      tempos: {},
      phase: 'step',
      clock: { stepId: 's2', startedAt, base: 0 },
    });
    const resume = readSessionInProgress();
    mount({ resume });
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('13:00')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('12:00')).toBeInTheDocument();
  });

  it('leaving a running timer step forgets the clock — stepping away stops a timer, as it always has', () => {
    mount({
      resume: {
        occurrenceId: 'o1',
        title: 'Piano practice',
        walkthrough: wt,
        idx: 1,
        visited: [0, 1],
        logs: {},
        tempos: {},
        phase: 'step',
        clock: { stepId: 's2', startedAt: Date.now(), base: 0 },
      },
    });
    fireEvent.click(screen.getByLabelText('Previous step'));
    expect(readSessionInProgress()).toMatchObject({ idx: 0, clock: null });
  });
});
