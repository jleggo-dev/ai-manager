/**
 * The start sheet's half of "the app coming back puts you back in the session" (owner,
 * 2026-11-01): a remembered session opens straight into the walkthrough without waiting on the
 * detail, is used once, and is dropped when the task it belongs to has moved on.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../test/withQuery.tsx';
import type { SessionSnapshot } from '../walkthrough/sessionInProgress.ts';

const getOccurrenceDetail = vi.fn();
const setOccurrence = vi.fn(async () => undefined);
const logOccurrence = vi.fn(async () => undefined);
vi.mock('../../lib/api.ts', () => ({
  getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a),
  getSessionInsight: vi.fn(async () => null),
  setOccurrence: (...a: unknown[]) => setOccurrence(...(a as [])),
  logOccurrence: (...a: unknown[]) => logOccurrence(...(a as [])),
  keepJournalEntry: vi.fn(),
  settleTempo: vi.fn(async () => undefined),
  getUnits: vi.fn(async () => null),
}));
vi.mock('./occurrence/WatchHandoffRow.tsx', () => ({ WatchHandoffRow: () => null }));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));

const { StartSheet } = await import('./StartSheet.tsx');
const { readSessionInProgress, writeSessionInProgress } = await import('../walkthrough/sessionInProgress.ts');

const resume: SessionSnapshot = {
  occurrenceId: 'o1',
  title: 'Piano practice',
  area: 'practice',
  walkthrough: {
    total_min: 10,
    steps: [
      { id: 's1', title: 'Scales', minutes: 5, tool: { kind: 'checkoff' }, skippable: true },
      { id: 's2', title: 'Écossaise', minutes: 5, tool: { kind: 'checkoff' }, skippable: true },
    ],
  },
  idx: 1,
  visited: [0, 1],
  logs: {},
  tempos: {},
  phase: 'step',
  clock: null,
};

const detail = (status: 'pending' | 'done' = 'pending') => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  date: '2026-11-01',
  status,
  title: 'Piano practice',
  kind: 'user' as const,
  session: {
    version: 1,
    generated_at: '2026-11-01T00:00:00.000Z',
    note: 'ok',
    blocks: [{ label: 'Main', items: [{ name: 'Scales', tool: 'reps', sets: 1, reps: 1 }] }],
  },
});

const mount = (onClose = () => {}) =>
  renderWithQuery(<StartSheet occurrenceId="o1" title="Piano practice" resume={resume} onClose={onClose} />);

beforeEach(() => {
  localStorage.clear();
  writeSessionInProgress(resume);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StartSheet — resuming a remembered session', () => {
  it('opens straight into the walkthrough on the remembered step, before the detail lands', () => {
    getOccurrenceDetail.mockReturnValue(new Promise(() => {})); // never lands
    mount();
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Écossaise')).toBeInTheDocument();
  });

  it('can finish before the detail lands — the write goes to the task it belongs to', async () => {
    getOccurrenceDetail.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.click(screen.getByText('Log this done'));
    fireEvent.click(screen.getByLabelText('Next step')); // → recap
    fireEvent.click(screen.getByText(/^Finish/));
    fireEvent.click(screen.getByText('Done'));
    // A logged step writes a summary (logOccurrence); either way it lands on o1.
    expect([...logOccurrence.mock.calls, ...setOccurrence.mock.calls].map((c) => (c as unknown[])[0])).toEqual(['o1']);
    expect(onClose).toHaveBeenCalled();
    expect(readSessionInProgress()).toBeNull();
  });

  const finish = () => {
    fireEvent.click(screen.getByText('Log this done'));
    fireEvent.click(screen.getByLabelText('Next step')); // → recap
    fireEvent.click(screen.getByText(/^Finish/));
    fireEvent.click(screen.getByText('Done'));
  };

  /** 2026-11-01: the write's failure was swallowed — the sheet had closed, and nothing said it. */
  it('a Done the server refuses is reported once the sheet has closed, and the plan still refreshes', async () => {
    getOccurrenceDetail.mockReturnValue(new Promise(() => {}));
    // Whichever write Done makes (a summary or a plain check-off), the server refuses it.
    const refused = () => Promise.reject(Object.assign(new Error('500'), { status: 500 }));
    setOccurrence.mockImplementationOnce(refused);
    logOccurrence.mockImplementationOnce(refused);
    const onClose = vi.fn();
    const onLogged = vi.fn();
    const onSaveFailed = vi.fn();
    renderWithQuery(
      <StartSheet
        occurrenceId="o1"
        title="Piano practice"
        resume={resume}
        onClose={onClose}
        onLogged={onLogged}
        onSaveFailed={onSaveFailed}
      />,
    );
    finish();
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledTimes(1));
    expect(onLogged).toHaveBeenCalled();
  });

  it('a Done that lands reports no failure', async () => {
    getOccurrenceDetail.mockReturnValue(new Promise(() => {}));
    const onLogged = vi.fn();
    const onSaveFailed = vi.fn();
    renderWithQuery(
      <StartSheet
        occurrenceId="o1"
        title="Piano practice"
        resume={resume}
        onClose={() => {}}
        onLogged={onLogged}
        onSaveFailed={onSaveFailed}
      />,
    );
    finish();
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('is used once: closing it and starting again is a fresh run from step 1', async () => {
    getOccurrenceDetail.mockResolvedValue(detail());
    mount();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(readSessionInProgress()).toBeNull();
    fireEvent.click(await screen.findByText(/I've got time/));
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument();
  });

  it('is dropped when the task was already logged somewhere else', async () => {
    getOccurrenceDetail.mockResolvedValue(detail('done'));
    mount();
    await waitFor(() => expect(screen.queryByText('Step 2 of 2')).toBeNull());
    expect(readSessionInProgress()).toBeNull();
    expect(screen.getByText(/already done/)).toBeInTheDocument();
  });

  it('is dropped when a replan took the task away', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    mount();
    await waitFor(() => expect(screen.queryByText('Step 2 of 2')).toBeNull());
    expect(readSessionInProgress()).toBeNull();
  });
});
