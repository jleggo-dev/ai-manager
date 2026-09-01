import { act, renderHook, waitFor } from '@testing-library/react';
import { useProposalAccept } from './useProposalAccept.ts';

const acceptProposal = vi.fn();
const dismissProposal = vi.fn();
const getPendingReplan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  acceptProposal: (...a: unknown[]) => acceptProposal(...a),
  dismissProposal: (...a: unknown[]) => dismissProposal(...a),
  getPendingReplan: (...a: unknown[]) => getPendingReplan(...a),
}));

const PROPOSAL = { activities: [{ title: 'Dead hangs' }], note: 'Loosened the elbow guard.' };

function deps() {
  return {
    refetch: vi.fn().mockResolvedValue(undefined),
    bump: vi.fn(),
    clearProposal: vi.fn(),
    onRecoveredProposal: vi.fn(),
    recoveryPaused: false,
    pollEveryMs: 5,
  };
}

/** Let the mount recovery check finish so it can't interleave with the scenario under test. */
async function mounted(d: ReturnType<typeof deps>) {
  const view = renderHook((props) => useProposalAccept(props), { initialProps: d });
  await waitFor(() => expect(getPendingReplan).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPendingReplan.mockResolvedValue({ ok: true, proposal: null });
  acceptProposal.mockResolvedValue({ status: 'committed', note: 'Tuned it.' });
  dismissProposal.mockResolvedValue(undefined);
});

/**
 * The failure these cover (PLAN-CHANGES.md, 2026-08-31): Accept held one request open across a
 * multi-minute synthesize+commit behind a disabled button label, and a >300s run was
 * undeliverable even when it succeeded — no push, no recovery, the banner just froze. The server
 * now answers 202 and runs in the background; this hook is the client's half of that contract.
 */
describe('useProposalAccept — the 202 background run', () => {
  it('a 202 swaps to the working state, then lands the committed week when the run is gone', async () => {
    const d = deps();
    const { result } = await mounted(d);

    acceptProposal.mockResolvedValue({ running: true });
    getPendingReplan
      .mockResolvedValueOnce({ ok: true, proposal: null, running: { stage: 'drafting' } })
      .mockResolvedValue({ ok: true, proposal: null }); // run gone: finished and committed

    await act(() => result.current.acceptProp());
    expect(result.current.working).toBe(true);
    expect(d.clearProposal).not.toHaveBeenCalled(); // banner stays while the run is live

    await waitFor(() => expect(result.current.working).toBe(false));
    expect(d.clearProposal).toHaveBeenCalledTimes(1);
    expect(d.refetch).toHaveBeenCalled();
    expect(result.current.note).toMatch(/Updated your plan/);
  });

  it('a failed run hands the buttons back and says why', async () => {
    const d = deps();
    const { result } = await mounted(d);

    acceptProposal.mockResolvedValue({ running: true });
    getPendingReplan.mockResolvedValue({ ok: true, proposal: null, failed: { message: 'The week would not vet.' } });

    await act(() => result.current.acceptProp());
    await waitFor(() => expect(result.current.working).toBe(false));
    expect(result.current.note).toBe('The week would not vet.');
    // The proposal was never cleared, so the banner's buttons are simply back.
    expect(d.clearProposal).not.toHaveBeenCalled();
    expect(d.refetch).not.toHaveBeenCalled();
  });

  it('a read that fails mid-watch is UNKNOWN, not an answer — the watch keeps going', async () => {
    const d = deps();
    const { result } = await mounted(d);

    acceptProposal.mockResolvedValue({ running: true });
    getPendingReplan
      .mockResolvedValueOnce({ ok: false, proposal: null }) // auth blip — not "it finished"
      .mockResolvedValueOnce({ ok: true, proposal: null, running: { stage: 'checking' } })
      .mockResolvedValue({ ok: true, proposal: null });

    await act(() => result.current.acceptProp());
    await waitFor(() => expect(result.current.working).toBe(false));
    expect(result.current.note).toMatch(/Updated your plan/);
  });

  it('gives up watching only at the ceiling, with the hiccup line and the buttons back', async () => {
    const d = { ...deps(), pollCeilingMs: 20 };
    const { result } = await mounted(d);

    acceptProposal.mockResolvedValue({ running: true });
    getPendingReplan.mockResolvedValue({ ok: true, proposal: null, running: { stage: 'drafting' } });

    await act(() => result.current.acceptProp());
    await waitFor(() => expect(result.current.working).toBe(false));
    expect(result.current.note).toMatch(/hiccuped/);
    expect(d.clearProposal).not.toHaveBeenCalled();
  });

  it('the sync branches behave exactly as before the 202 existed', async () => {
    const d = deps();
    const { result } = await mounted(d);

    await act(() => result.current.acceptProp());
    expect(result.current.working).toBe(false);
    expect(result.current.note).toBe('Tuned it.');
    expect(d.clearProposal).toHaveBeenCalledTimes(1);
    expect(d.refetch).toHaveBeenCalledTimes(1);

    acceptProposal.mockResolvedValue({ status: 'entered_disrupted' });
    await act(() => result.current.acceptProp());
    expect(result.current.note).toBe(''); // the detour banner is the feedback, not a note
    expect(d.refetch).toHaveBeenCalledTimes(2);
  });
});

describe('useProposalAccept — pending recovery, mount and resume', () => {
  it('a proposal waiting server-side opens the review on mount', async () => {
    const d = deps();
    getPendingReplan.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    await mounted(d);
    await waitFor(() => expect(d.onRecoveredProposal).toHaveBeenCalledTimes(1));
  });

  it('a live background run found on mount is rejoined, not offered buttons that would re-fire it', async () => {
    const d = deps();
    getPendingReplan.mockResolvedValue({ ok: true, proposal: null, running: { stage: 'drafting' } });
    const { result } = await mounted(d);
    await waitFor(() => expect(result.current.working).toBe(true));

    getPendingReplan.mockResolvedValue({ ok: true, proposal: null });
    await waitFor(() => expect(result.current.working).toBe(false));
    expect(result.current.note).toMatch(/Updated your plan/);
  });

  it('coming back to the foreground re-checks once and surfaces a landed proposal', async () => {
    const d = deps();
    const { result } = await mounted(d);
    const callsAfterMount = getPendingReplan.mock.calls.length;

    getPendingReplan.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(d.onRecoveredProposal).toHaveBeenCalledTimes(1));
    expect(getPendingReplan.mock.calls.length).toBe(callsAfterMount + 1); // one fetch, no interval
    expect(result.current.working).toBe(false);
  });

  it('a resume never pops the review over a sheet the user already has open', async () => {
    const d = { ...deps(), recoveryPaused: true };
    await mounted(d);

    getPendingReplan.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));

    expect(d.onRecoveredProposal).not.toHaveBeenCalled();
  });
});
