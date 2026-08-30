/**
 * LayoutProposalCard follows ChangeCard/WeekReviewCard's contract: it asks the SERVER what is
 * pending and draws nothing when the answer is nothing, so mounting it unconditionally beside
 * every finished turn is safe. `compose_progress_view` writes a draft, never a tag — these pin
 * that the card is the draft's, not the turn's prose, plus the one thing this sibling adds:
 * confirming commits AND invalidates the committed-layout cache so the Progress tab repaints.
 */
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import type { ProgressLayout } from '@cadence/shared';
import { queryKeys } from '../../lib/query/index.ts';

const api = vi.hoisted(() => ({
  getProgressLayoutDraft: vi.fn(),
  commitProgressLayoutDraft: vi.fn(async () => true),
  dismissProgressLayoutDraft: vi.fn(async () => true),
}));
vi.mock('../../lib/api.ts', () => api);

const { LayoutProposalCard } = await import('./LayoutProposalCard.tsx');

const LAYOUT: ProgressLayout = {
  version: 1,
  status: 'draft',
  sections: [
    { id: 'w-rhythm', kind: 'rhythm', title: 'Your week' },
    { id: 'w-weight', kind: 'trend_vs_target' }, // no title — falls back to the plain kind name
    { id: 'w-runs', kind: 'dated_sessions', title: 'Your runs' },
  ],
};
const DRAFT = { draft_id: 'draft-1', layout: LAYOUT };

function renderWithQuery(
  ui: ReactElement,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LayoutProposalCard', () => {
  it('renders nothing while nothing is pending', async () => {
    api.getProgressLayoutDraft.mockResolvedValueOnce(null);
    const { container } = renderWithQuery(<LayoutProposalCard />);

    await waitFor(() => expect(api.getProgressLayoutDraft).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });

  it('lists the proposed sections in order, warm titles falling back to a plain kind name', async () => {
    api.getProgressLayoutDraft.mockResolvedValueOnce(DRAFT);
    renderWithQuery(<LayoutProposalCard />);

    expect(await screen.findByText('Your Progress page, rearranged')).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Your week', 'Trend', 'Your runs']);
  });

  it('confirming commits the draft, invalidates the layout cache, and speaks the receipt back', async () => {
    api.getProgressLayoutDraft.mockResolvedValueOnce(DRAFT);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.progressLayout.all, { version: 1, status: 'committed', sections: [] });
    const onConfirmed = vi.fn();
    renderWithQuery(<LayoutProposalCard onConfirmed={onConfirmed} />, client);

    (await screen.findByRole('button', { name: 'Set my page this way' })).click();

    await waitFor(() => expect(api.commitProgressLayoutDraft).toHaveBeenCalledWith('draft-1'));
    await waitFor(() => expect(client.getQueryState(queryKeys.progressLayout.all)?.isInvalidated).toBe(true));
    expect(screen.queryByText('Your Progress page, rearranged')).not.toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith('Progress page set — 3 sections: Your week, Trend, Your runs');
  });

  it('"Not now" dismisses the draft and leaves quietly — no commit, no receipt', async () => {
    api.getProgressLayoutDraft.mockResolvedValueOnce(DRAFT);
    const onConfirmed = vi.fn();
    renderWithQuery(<LayoutProposalCard onConfirmed={onConfirmed} />);

    (await screen.findByRole('button', { name: 'Not now' })).click();

    await waitFor(() => expect(api.dismissProgressLayoutDraft).toHaveBeenCalledWith('draft-1'));
    expect(screen.queryByText('Your Progress page, rearranged')).not.toBeInTheDocument();
    expect(api.commitProgressLayoutDraft).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('stays quiet when the read fails — a missing card is not a broken turn', async () => {
    api.getProgressLayoutDraft.mockRejectedValueOnce(new Error('500'));
    const { container } = renderWithQuery(<LayoutProposalCard />);

    await waitFor(() => expect(api.getProgressLayoutDraft).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });
});
