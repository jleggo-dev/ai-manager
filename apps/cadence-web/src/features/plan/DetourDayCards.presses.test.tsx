/**
 * DetourDayCards, pressed at the wire (owner bar, 2026-09-01). The load-bearing case is the
 * rebase reconciliation itself: this component's first draft carried its OWN copy of the gear
 * handlers, written before the plan-change suite's Phase 0 fix — a failed rework showed nothing
 * and read exactly like a landed one. The rework made it consume `useDetourGear` instead, and
 * the failed-confirm test here is what keeps that from ever silently un-happening.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const sendDetourEquipment = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; revised?: boolean }> => ({
  ok: true,
  revised: true,
}));
const postponeDetour = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('../../lib/api.ts', () => ({
  sendDetourEquipment: (...a: unknown[]) => sendDetourEquipment(...a),
  postponeDetour: (...a: unknown[]) => postponeDetour(...a),
  sendGymPhotos: vi.fn(async () => ({ ok: false })),
}));

const { DetourDayCards } = await import('./DetourDayCards.tsx');

/** Started yesterday, so today is always a detour day whatever the local clock says. */
function startedYesterday(): string {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mount(over: Partial<{ gearKnown: boolean; paused: boolean }> = {}, props: Record<string, unknown> = {}) {
  return render(
    <DetourDayCards
      episode={{ type: 'travel', start: startedYesterday(), gearKnown: false, ...over }}
      onCheckIn={() => {}}
      onEnd={() => {}}
      onChanged={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DetourDayCards — pressed at the wire', () => {
  it('"No gym here" sends the explicit empty list and reports the rework', async () => {
    const onChanged = vi.fn();
    mount({}, { onChanged });
    fireEvent.click(screen.getByText('No gym here'));
    await waitFor(() => expect(sendDetourEquipment).toHaveBeenCalledWith([]));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText(/Equipment-free it is/)).toBeTruthy();
  });

  it('a picked chip rides the confirm exactly as named', async () => {
    mount();
    fireEvent.click(screen.getByText('Dumbbells'));
    fireEvent.click(screen.getByText("That's what I've got"));
    await waitFor(() => expect(sendDetourEquipment).toHaveBeenCalledWith([{ name: 'Dumbbells' }]));
  });

  it('a FAILED confirm says so — the Phase 0 fix this component once shipped without', async () => {
    sendDetourEquipment.mockResolvedValueOnce({ ok: false });
    const onChanged = vi.fn();
    mount({}, { onChanged });
    fireEvent.click(screen.getByText('No gym here'));
    expect(await screen.findByText(/Couldn't rework the week around that just now/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('"Not yet" postpones and revalidates', async () => {
    const onChanged = vi.fn();
    mount({}, { onChanged });
    fireEvent.click(screen.getByText('Not yet'));
    await waitFor(() => expect(postponeDetour).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('"I\'m back" hands to the caller, goes inert while ending, and shows the resume failure', () => {
    const onEnd = vi.fn();
    mount({ gearKnown: true }, { onEnd });
    fireEvent.click(screen.getByText("I'm back"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ gearKnown: true }, { onEnd, endBusy: true, endError: null });
    expect(screen.getByText('One moment…')).toBeTruthy();
    cleanup();
    mount({ gearKnown: true }, { onEnd, endError: "That didn't take — try again in a moment." });
    expect(screen.getByText(/That didn't take/)).toBeTruthy();
  });

  /**
   * A pause (pause_week) is an episode with nothing overlaid. Both detour cards would put back
   * exactly what the person asked to clear — one asks what gear they have, the other offers to
   * reshape the days around it — so the paused stretch gets its own, quieter card.
   */
  describe('a paused stretch', () => {
    it('says it is paused and nothing was deleted, with no gear question', () => {
      mount({ paused: true });
      expect(screen.getByText('Paused')).toBeTruthy();
      expect(screen.getByText(/Nothing was deleted/)).toBeTruthy();
      expect(screen.queryByText('No gym here')).toBeNull();
      expect(screen.queryByText('Dumbbells')).toBeNull();
      expect(screen.queryByText(/Snap the gym/)).toBeNull();
      expect(screen.queryByText('Check in')).toBeNull();
    });

    it('offers only the way back, and it hands to the caller', () => {
      const onEnd = vi.fn();
      mount({ paused: true }, { onEnd });
      fireEvent.click(screen.getByText('Start again now'));
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('goes inert while ending and says a resume that did not land', () => {
      mount({ paused: true }, { endBusy: true });
      expect(screen.getByText('One moment…')).toBeTruthy();
      cleanup();
      mount({ paused: true }, { endError: "That didn't take — try again in a moment." });
      expect(screen.getByText(/That didn't take/)).toBeTruthy();
    });

    it('still renders the detour cards when the flag is absent', () => {
      mount({ gearKnown: true });
      expect(screen.getByText(/On a detour/)).toBeTruthy();
      expect(screen.queryByText('Paused')).toBeNull();
    });
  });

  it('renders nothing before the detour has started', () => {
    const d = new Date(Date.now() + 86_400_000);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { container } = render(
      <DetourDayCards
        episode={{ type: 'travel', start: tomorrow, gearKnown: false }}
        onCheckIn={() => {}}
        onEnd={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
