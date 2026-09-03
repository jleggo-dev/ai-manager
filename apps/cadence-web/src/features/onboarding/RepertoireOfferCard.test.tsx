/**
 * The coach's door, from the chat side (design frame 1e, P7).
 *
 * Same contract as WeekReviewCard next door: `offer_repertoire_review` writes a POINTER, never a
 * tag, so this asks the SERVER what is offered and draws nothing when the answer is nothing —
 * which is what makes it safe to mount beside every finished turn.
 *
 * The two that carry the feature are the two the design is about: "Lay them out" opens the SAME
 * review the person's own ＋ door opens, prefilled with what she heard; and the confirm comes back
 * as a receipt row, not another card to edit. The rest are the ways it must not go wrong — an
 * offer declined must not reappear, and nothing may be claimed as saved before the review says so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getRepertoireOffer: vi.fn(),
  clearRepertoireOffer: vi.fn(async () => true),
}));
vi.mock('../../lib/api/repertoire-offer.ts', () => api);

/** The review is P4's screen and is tested as itself; here it stands in, reporting what it was
 *  handed and offering the one button that finishes it. */
const seedProps = vi.fn();
vi.mock('../repertoire/SeedReview.tsx', () => ({
  SeedReview: (props: { collection: string; whereYouAre?: string; onDone: (n: number) => void }) => {
    seedProps(props);
    return (
      <div>
        <span>REVIEW:{props.collection}</span>
        <span>WHERE:{props.whereYouAre ?? ''}</span>
        <button type="button" onClick={() => props.onDone(9)}>
          finish
        </button>
      </div>
    );
  },
}));

const { RepertoireOfferCard } = await import('./RepertoireOfferCard.tsx');

const OFFER = {
  collection: 'Suzuki Piano Book 2',
  where_you_are: 'Hungarian Folk Song',
  goal_id: 'g-piano',
  offered_at: '2026-09-02T18:00:00.000Z',
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.getRepertoireOffer.mockResolvedValue(OFFER);
  api.clearRepertoireOffer.mockResolvedValue(true);
});

describe('nothing offered', () => {
  it('draws nothing at all, so mounting it on every finished turn is safe', async () => {
    api.getRepertoireOffer.mockResolvedValueOnce(null);
    const { container } = render(<RepertoireOfferCard />);
    await waitFor(() => expect(api.getRepertoireOffer).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });

  it('stays quiet when the read fails — a missing card is not a broken conversation', async () => {
    api.getRepertoireOffer.mockRejectedValueOnce(new Error('500'));
    const { container } = render(<RepertoireOfferCard />);
    await waitFor(() => expect(api.getRepertoireOffer).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });
});

describe('the offer', () => {
  it('names the collection she heard, and claims nothing about their list', async () => {
    render(<RepertoireOfferCard />);
    expect(await screen.findByText('Suzuki Piano Book 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lay them out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing goes on your list until you say so/)).toBeInTheDocument();
  });

  it('"Not now" clears the offer and opens nothing', async () => {
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(api.clearRepertoireOffer).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Suzuki Piano Book 2')).not.toBeInTheDocument();
    expect(seedProps).not.toHaveBeenCalled();
  });
});

describe('"Lay them out"', () => {
  it('opens the same review the ＋ door opens, prefilled with what she heard', async () => {
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));

    expect(await screen.findByText('REVIEW:Suzuki Piano Book 2')).toBeInTheDocument();
    expect(screen.getByText('WHERE:Hungarian Folk Song')).toBeInTheDocument();
    expect(seedProps).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'Suzuki Piano Book 2', whereYouAre: 'Hungarian Folk Song' }),
    );
  });

  it('passes no prefill when she heard no piece', async () => {
    api.getRepertoireOffer.mockResolvedValueOnce({ ...OFFER, where_you_are: null });
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));

    await screen.findByText('REVIEW:Suzuki Piano Book 2');
    expect(seedProps).toHaveBeenCalledWith(expect.objectContaining({ whereYouAre: undefined }));
  });

  it('does not clear the offer just for opening it — only an answer clears it', async () => {
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));
    await screen.findByText('REVIEW:Suzuki Piano Book 2');
    expect(api.clearRepertoireOffer).not.toHaveBeenCalled();
  });

  it('backs out to the offer without saving anything', async () => {
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));
    await screen.findByText('REVIEW:Suzuki Piano Book 2');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('button', { name: 'Lay them out' })).toBeInTheDocument();
    expect(api.clearRepertoireOffer).not.toHaveBeenCalled();
  });
});

describe('the receipt', () => {
  async function seed(props: Record<string, unknown> = {}) {
    render(<RepertoireOfferCard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));
    fireEvent.click(await screen.findByRole('button', { name: 'finish' }));
  }

  it('is a row saying what landed, not another card to edit', async () => {
    await seed({ onOpenList: vi.fn() });
    expect(await screen.findByText("9 pieces added to What I'm learning")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open ›' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lay them out' })).not.toBeInTheDocument();
  });

  it('offers no way in when the host has nowhere to take them — onboarding has no Progress tab', async () => {
    await seed();
    expect(await screen.findByText("9 pieces added to What I'm learning")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open ›' })).not.toBeInTheDocument();
  });

  it('counts one piece as one piece', async () => {
    render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));
    seedProps.mock.calls[0]![0].onDone(1);
    expect(await screen.findByText("1 piece added to What I'm learning")).toBeInTheDocument();
  });

  it('clears the offer, so the same book is never offered twice', async () => {
    await seed();
    await waitFor(() => expect(api.clearRepertoireOffer).toHaveBeenCalledTimes(1));
  });

  it('tells the coach the list is real now, without putting words in the user’s mouth', async () => {
    const onSeeded = vi.fn();
    await seed({ onSeeded });
    await waitFor(() => expect(onSeeded).toHaveBeenCalledTimes(1));
    const note = onSeeded.mock.calls[0]![0] as string;
    expect(note).toContain('Suzuki Piano Book 2');
    expect(note).toContain('9');
    // She has to know she can now READ it — that is the whole point of the seed landing.
    expect(note).toMatch(/get_repertoire/);
  });

  it('"Open ›" hands the list to the host rather than opening a second one here', async () => {
    const onOpenList = vi.fn();
    await seed({ onOpenList });
    fireEvent.click(await screen.findByRole('button', { name: 'Open ›' }));
    expect(onOpenList).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^REVIEW:/)).not.toBeInTheDocument();
  });

  it('says nothing at all when the review wrote nothing', async () => {
    const { container } = render(<RepertoireOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay them out' }));
    seedProps.mock.calls[0]![0].onDone(0);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
