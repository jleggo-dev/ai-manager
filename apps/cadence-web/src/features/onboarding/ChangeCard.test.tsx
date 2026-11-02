/**
 * ChangeCard branches on whether the pending change carries any per-item field (a `change_reason`,
 * or an item the coach marked optional) — the signature of a check-in offer versus an ordinary
 * requested tweak. The plain branch's own contract (reads the server, applies inline, "Not now"
 * drops it) predates this file; these tests hold BOTH branches to account, including that the
 * plain one is genuinely UNCHANGED.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getPendingChange: vi.fn(),
  getPendingChangeDetail: vi.fn(),
  dismissPendingChange: vi.fn(async () => true),
  applyPendingChange: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string | null }> => ({ ok: true })),
}));
vi.mock('../../lib/api.ts', () => api);

const { ChangeCard } = await import('./ChangeCard.tsx');

const CHANGE = { changes: ['Move Easy run: Thu → Fri'], activities: 1, created_at: '2026-08-26T09:00:00.000Z' };
const PLAIN_DETAIL = {
  plan_version: 4,
  items: [{ index: 0, title: 'Easy run', enabled: true, now: 'Thu · 6:30 pm', next: 'Fri · 6:30 pm' }],
};
const OFFER_DETAIL = {
  plan_version: 4,
  items: [
    {
      index: 0,
      title: 'Easy run',
      change_reason: "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.",
      enabled: true,
      now: 'Thu · 6:30 pm',
      next: 'Fri · 6:15 am',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WEEK_DETAIL = {
  ...PLAIN_DETAIL,
  removed: [],
  week: [
    { date: '2026-11-05', entries: [{ title: 'Easy run', time: '6:30 pm', kind: 'was', index: 0 }] },
    { date: '2026-11-06', entries: [{ title: 'Easy run', time: '6:30 pm', kind: 'new', index: 0 }] },
  ],
};

describe('ChangeCard — the week, one tap away (owner, 2026-11-01)', () => {
  it('shows the quiet week strip under the change, and opens the sheet straight at the week', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(WEEK_DETAIL);
    const onShowChanges = vi.fn();
    render(<ChangeCard onShowChanges={onShowChanges} />);

    (await screen.findByRole('button', { name: 'Week view' })).click();
    expect(onShowChanges).toHaveBeenCalledWith('full', expect.any(Function));
    expect(api.applyPendingChange).not.toHaveBeenCalled();
  });

  it('when the sheet applies, the card shows it done instead of offering Apply again', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(WEEK_DETAIL);
    const onApplied = vi.fn();
    let whenApplied: (() => void) | undefined;
    render(
      <ChangeCard
        onApplied={onApplied}
        onShowChanges={(_view, cb) => {
          whenApplied = cb;
        }}
      />,
    );
    (await screen.findByRole('button', { name: 'Week view' })).click();
    act(() => whenApplied!());

    expect(await screen.findByText("Done — that's your plan now")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply this' })).not.toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('draws no strip without a host to open the sheet', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(WEEK_DETAIL);
    render(<ChangeCard />);
    await screen.findByText("Here's what I'd change");
    expect(screen.queryByRole('button', { name: 'Week view' })).not.toBeInTheDocument();
  });
});

describe('ChangeCard — no per-item fields (an ordinary requested tweak)', () => {
  it('renders nothing while nothing is pending', async () => {
    api.getPendingChange.mockResolvedValueOnce(null);
    api.getPendingChangeDetail.mockResolvedValueOnce({ plan_version: null, items: [] });
    const { container } = render(<ChangeCard />);
    await waitFor(() => expect(api.getPendingChange).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });

  it('keeps the inline Apply exactly: shows the lines and an Apply button, no Show me', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(PLAIN_DETAIL);
    render(<ChangeCard />);

    expect(await screen.findByText("Here's what I'd change")).toBeInTheDocument();
    expect(screen.getByText('Move Easy run: Thu → Fri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply this' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument();
  });

  it('applying commits the stored change and shows the done state', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(PLAIN_DETAIL);
    const onApplied = vi.fn();
    render(<ChangeCard onApplied={onApplied} />);

    (await screen.findByRole('button', { name: 'Apply this' })).click();

    expect(await screen.findByText("Done — that's your plan now")).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(api.applyPendingChange).toHaveBeenCalledTimes(1);
  });

  it("a refused apply keeps the card up with the server's own words", async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(PLAIN_DETAIL);
    api.applyPendingChange.mockResolvedValueOnce({
      ok: false,
      message: 'That change card expired — ask me again and I will put it back up.',
    });
    const onApplied = vi.fn();
    render(<ChangeCard onApplied={onApplied} />);

    (await screen.findByRole('button', { name: 'Apply this' })).click();

    expect(await screen.findByText(/change card expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply this' })).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('"Not now" dismisses and disappears', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(PLAIN_DETAIL);
    render(<ChangeCard />);

    (await screen.findByRole('button', { name: 'Not now' })).click();
    await waitFor(() => expect(api.dismissPendingChange).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Here's what I'd change")).not.toBeInTheDocument();
  });

  it('stays quiet when the detail read fails outright — same as getPendingChange failing today', async () => {
    // Promise.all fails the pair together on purpose: a partial read (lines with no branch
    // decision, or a branch decision with no lines to show) is worse than the existing "a missing
    // card is not a broken turn" fallback this file has always used for a getPendingChange failure.
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockRejectedValueOnce(new Error('500'));
    const { container } = render(<ChangeCard onShowChanges={vi.fn()} />);

    await waitFor(() => expect(api.getPendingChange).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });
});

describe('ChangeCard — per-item fields present (a check-in offer)', () => {
  it('renders "Show me" instead of an inline Apply, and never applies on its own', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(OFFER_DETAIL);
    render(<ChangeCard onShowChanges={vi.fn()} />);

    expect(await screen.findByText('Your coach has some ideas for next week')).toBeInTheDocument();
    expect(screen.getByText('Move Easy run: Thu → Fri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply this' })).not.toBeInTheDocument();
    expect(api.applyPendingChange).not.toHaveBeenCalled();
  });

  it('tapping "Show me" calls onShowChanges and does not apply anything itself', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(OFFER_DETAIL);
    const onShowChanges = vi.fn();
    render(<ChangeCard onShowChanges={onShowChanges} />);

    (await screen.findByRole('button', { name: 'Show me' })).click();
    expect(onShowChanges).toHaveBeenCalledTimes(1);
    expect(api.applyPendingChange).not.toHaveBeenCalled();
  });

  it('"Not now" still dismisses the offer branch', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(OFFER_DETAIL);
    render(<ChangeCard onShowChanges={vi.fn()} />);

    (await screen.findByRole('button', { name: 'Not now' })).click();
    await waitFor(() => expect(api.dismissPendingChange).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Your coach has some ideas for next week')).not.toBeInTheDocument();
  });

  it('falls back to the plain inline Apply when no onShowChanges host is wired up', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce(OFFER_DETAIL);
    render(<ChangeCard />);

    expect(await screen.findByText("Here's what I'd change")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply this' })).toBeInTheDocument();
  });

  it('an item marked optional (enabled: false), with no reason at all, still routes to Show me', async () => {
    api.getPendingChange.mockResolvedValueOnce(CHANGE);
    api.getPendingChangeDetail.mockResolvedValueOnce({
      plan_version: 4,
      items: [{ index: 0, title: 'Second strength day', enabled: false, now: null, next: 'Sat · 9 am' }],
    });
    render(<ChangeCard onShowChanges={vi.fn()} />);

    expect(await screen.findByText('Your coach has some ideas for next week')).toBeInTheDocument();
  });
});
