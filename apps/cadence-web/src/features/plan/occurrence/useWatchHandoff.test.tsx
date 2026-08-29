import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { OccurrenceSession } from '@cadence/shared';
import { useWatchHandoff } from './useWatchHandoff.ts';

const isAvailable = vi.fn<() => boolean>();
const isSupported = vi.fn();
const requestAuthorization = vi.fn();
const schedule = vi.fn();
const listScheduled = vi.fn();
const remove = vi.fn();

vi.mock('../../../lib/capability/index.ts', () => ({
  capabilities: {
    workoutPlan: {
      isAvailable: () => isAvailable(),
      isSupported: () => isSupported(),
      requestAuthorization: () => requestAuthorization(),
      schedule: (items: unknown) => schedule(items),
      listScheduled: () => listScheduled(),
      remove: (id: string) => remove(id),
    },
  },
}));

const OCC = '11111111-2222-3333-4444-555555555555';

function runSession(): OccurrenceSession {
  return {
    blocks: [{ label: 'Main', items: [{ name: 'Easy run', distance_km: 5 }] }],
    note: '',
    generated_at: '2026-08-29T00:00:00.000Z',
    version: 1,
  };
}

function mount(over: Partial<Parameters<typeof useWatchHandoff>[0]> = {}) {
  // Built ONCE, outside the render callback — the sheet passes a stable `detail.session`, and a
  // fresh object per render would re-key the hook's compose memo and restart its effect forever.
  const props: Parameters<typeof useWatchHandoff>[0] = {
    occurrenceId: OCC,
    title: 'Thursday run',
    dateISO: '2026-09-03',
    session: runSession(),
    pending: true,
    ...over,
  };
  return renderHook(() => useWatchHandoff(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  isAvailable.mockReturnValue(true);
  isSupported.mockResolvedValue({ supported: true, state: 'notDetermined' });
  listScheduled.mockResolvedValue([]);
  requestAuthorization.mockResolvedValue('authorized');
  schedule.mockResolvedValue([{ id: OCC, scheduled: true }]);
  remove.mockResolvedValue(1);
});

describe('useWatchHandoff — when the row may exist at all', () => {
  it('shows when the whole chain says yes', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.phase).toBe('idle');
  });

  it('never shows on a platform without the capability', async () => {
    isAvailable.mockReturnValue(false);
    const { result } = mount();
    await Promise.resolve();
    expect(result.current.visible).toBe(false);
    expect(isSupported).not.toHaveBeenCalled();
  });

  it('never shows without a paired watch', async () => {
    isSupported.mockResolvedValue({ supported: false, state: 'unavailable' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.visible).toBe(false);
  });

  it('never shows once the user has said no in Settings — re-offering would be nagging', async () => {
    isSupported.mockResolvedValue({ supported: true, state: 'denied' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.visible).toBe(false);
  });

  it('never shows for a session that composes to nothing (a sit is not exercise)', async () => {
    const sit: OccurrenceSession = {
      blocks: [{ label: 'Practice', items: [{ name: 'Morning sit', tool: 'meditate', duration_min: 20 }] }],
      note: '',
      generated_at: '2026-08-29T00:00:00.000Z',
      version: 1,
    };
    const { result } = mount({ session: sit });
    await act(async () => {});
    expect(result.current.visible).toBe(false);
    expect(isSupported).not.toHaveBeenCalled();
  });

  it('never shows for a session already behind you', async () => {
    const { result } = mount({ pending: false });
    await act(async () => {});
    expect(result.current.visible).toBe(false);
  });

  it('opens already-sent when the watch is holding this occurrence', async () => {
    listScheduled.mockResolvedValue([{ id: OCC, complete: false }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.phase).toBe('sent');
  });

  it('a completed entry on the watch does not read as still scheduled', async () => {
    listScheduled.mockResolvedValue([{ id: OCC, complete: true }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.phase).toBe('idle');
  });
});

describe('useWatchHandoff — sending', () => {
  it('asks for authorization, schedules, and lands on sent', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(() => result.current.send());
    expect(result.current.phase).toBe('sent');
    expect(schedule).toHaveBeenCalledWith([
      expect.objectContaining({ dateISO: '2026-09-03', spec: expect.objectContaining({ id: OCC }) }),
    ]);
  });

  it('a refusal at the authorization sheet removes the row — an answer, not an error', async () => {
    requestAuthorization.mockResolvedValue('denied');
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(() => result.current.send());
    expect(result.current.visible).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a scheduling refusal reads as failed, in plain words, not as sent', async () => {
    schedule.mockResolvedValue([{ id: OCC, scheduled: false, reason: 'watch not paired' }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(() => result.current.send());
    expect(result.current.phase).toBe('failed');
  });

  it('remove takes it off the watch and returns the row to idle', async () => {
    listScheduled.mockResolvedValue([{ id: OCC, complete: false }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.phase).toBe('sent'));
    await act(() => result.current.remove());
    expect(result.current.phase).toBe('idle');
    expect(remove).toHaveBeenCalledWith(OCC);
  });
});
