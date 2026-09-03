/**
 * The seed review screen — every button on it.
 *
 * The five that carry the feature: the tap that says where you are (it decides sixty standings at
 * once), a tick (it must move exactly one row), the confirm button's count (it is a promise about
 * what is about to be written), what confirm actually posts (three standings, never the other
 * two), and a fault (which must never render as "0 pieces found" — that is a sentence about the
 * person's book, said out loud, when what happened was a crash on our side).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SeedReview } from './SeedReview.tsx';
import type { SeedCandidate } from '../../lib/api/repertoire-seed.ts';

const expandCollection = vi.fn();
const confirmSeed = vi.fn();
const getReview = vi.fn();

vi.mock('../../lib/api/repertoire-seed.ts', () => ({
  expandCollection: (...a: unknown[]) => expandCollection(...a),
  confirmSeed: (...a: unknown[]) => confirmSeed(...a),
}));
vi.mock('../../lib/api/review.ts', () => ({ getReview: (...a: unknown[]) => getReview(...a) }));

/** Suzuki Piano Book 2 — twelve rows, and the minuets in G that share a title but not a label. */
const LABELS = [
  'Écossaise',
  'Long, Long Ago',
  'Little Playmates',
  'The Happy Farmer',
  'Minuet in G Major, BWV Anh. 114',
  'Minuet in G Minor, BWV Anh. 115',
  'Minuet in G Major, BWV Anh. 116',
  'Minuet in G Major, BWV 822',
  'Cradle Song',
  'Minuet in G Major, WoO 10 No. 2',
  'Musette in D Major, BWV Anh. 126',
  'Chanson',
];

function candidates(over: Partial<SeedCandidate>[] = []): SeedCandidate[] {
  return LABELS.map((label, i) => ({
    label,
    composer: null,
    collection: 'Suzuki Piano Book 2',
    catalogue: null,
    rank: i + 1,
    ambiguous: false,
    ...(over[i] ?? {}),
  }));
}

const standings = (c: HTMLElement): (string | null)[] =>
  [...c.querySelectorAll('.pw-rep-standing')].map((e) => e.textContent);

const saveButton = () => screen.getByRole('button', { name: /^Save \d+ piece/ });

function open(onDone = vi.fn()) {
  const view = render(<SeedReview collection="Suzuki Piano Book 2" onDone={onDone} />);
  return { ...view, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  expandCollection.mockResolvedValue({ ok: true, collection: 'Suzuki Piano Book 2', candidates: candidates() });
  confirmSeed.mockResolvedValue({ ok: true, written: 3, labels: ['a'] });
  getReview.mockResolvedValue({
    goals: [
      { goal_id: 'g-piano', title: 'Practice piano' },
      { goal_id: 'g-run', title: 'Run a half marathon' },
    ],
  });
});

describe('the header', () => {
  it('names the collection, counts what was found, and says nothing is saved', async () => {
    open();
    expect(await screen.findByText('Suzuki Piano Book 2')).toBeInTheDocument();
    expect(screen.getByText('12 PIECES FOUND · NOTHING SAVED YET')).toBeInTheDocument();
    expect(
      screen.getByText(/Tap the piece you.re on now and I.ll mark everything before it as Keeping up/),
    ).toBeInTheDocument();
  });

  it('lists the book in rank order, three minuets in G as three rows', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    const titles = [...container.querySelectorAll('.pw-rep-label')].map((e) => e.textContent);
    expect(titles).toEqual(LABELS);
  });

  it('starts with nothing chosen: every row shows no standing and the button is at zero', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    expect(standings(container)).toEqual(Array(12).fill('—'));
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent('Save 0 pieces');
  });
});

describe('the tap that says where you are', () => {
  it('marks everything before it Keeping up, that one Learning, and the rest nothing', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'The Happy Farmer' }));

    expect(standings(container)).toEqual(['Keeping up', 'Keeping up', 'Keeping up', 'Learning', ...Array(8).fill('—')]);
    expect(saveButton()).toHaveTextContent('Save 4 pieces');
  });

  it('on the first piece, only that one is Learning and nothing is Keeping up', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    expect(standings(container)).toEqual(['Learning', ...Array(11).fill('—')]);
    expect(saveButton()).toHaveTextContent('Save 1 piece');
  });

  it('re-tapping earlier in the book redraws the whole split', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Cradle Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'Little Playmates' }));
    expect(standings(container)).toEqual(['Keeping up', 'Keeping up', 'Learning', ...Array(9).fill('—')]);
  });
});

describe('a tick', () => {
  it('flips exactly one row and leaves the others where they were', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'The Happy Farmer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include Long, Long Ago' }));

    expect(standings(container)).toEqual(['Keeping up', '—', 'Keeping up', 'Learning', ...Array(8).fill('—')]);
    expect(saveButton()).toHaveTextContent('Save 3 pieces');
  });

  it('ticks a piece after the split back on, as Up next', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include Chanson' }));

    expect(standings(container)[11]).toBe('Up next');
    expect(saveButton()).toHaveTextContent('Save 2 pieces');
  });
});

describe('confirm', () => {
  it('posts the ticked rows with their standings, and only known/working/queued', async () => {
    const { onDone } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Little Playmates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include Chanson' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(confirmSeed).toHaveBeenCalledTimes(1));
    const [rows, goalId] = confirmSeed.mock.calls[0] as [Array<{ label: string; status: string }>, string | null];
    expect(rows.map((r) => [r.label, r.status])).toEqual([
      ['Écossaise', 'known'],
      ['Long, Long Ago', 'known'],
      ['Little Playmates', 'working'],
      ['Chanson', 'queued'],
    ]);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['known', 'working', 'queued']));
    expect(goalId).toBeNull();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(3));
  });

  it('carries the qualifiers through untouched — the split is the whole point of the seed', async () => {
    expandCollection.mockResolvedValue({
      ok: true,
      collection: 'Suzuki Piano Book 2',
      candidates: candidates([{ composer: 'J.N. Hummel', catalogue: 'S. 52' }]),
    });
    open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(confirmSeed).toHaveBeenCalled());
    const [rows] = confirmSeed.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows[0]).toEqual({
      label: 'Écossaise',
      composer: 'J.N. Hummel',
      collection: 'Suzuki Piano Book 2',
      catalogue: 'S. 52',
      rank: 1,
      status: 'working',
    });
  });

  it('writes nothing until it is pressed', async () => {
    open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Cradle Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include Chanson' }));
    expect(confirmSeed).not.toHaveBeenCalled();
  });

  it('sends the goal they chose', async () => {
    open();
    await screen.findByText('Écossaise');
    fireEvent.click(await screen.findByRole('button', { name: 'Practice piano' }));
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(confirmSeed).toHaveBeenCalled());
    expect(confirmSeed.mock.calls[0]![1]).toBe('g-piano');
  });

  it('"no goal" is a real choice, not the absence of one', async () => {
    open();
    await screen.findByText('Écossaise');
    fireEvent.click(await screen.findByRole('button', { name: 'Practice piano' }));
    fireEvent.click(screen.getByRole('button', { name: /No goal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(confirmSeed).toHaveBeenCalled());
    expect(confirmSeed.mock.calls[0]![1]).toBeNull();
  });

  it('a failed save says so and never reports a write', async () => {
    confirmSeed.mockResolvedValue({ ok: false, fault: 'I could not save those just now — a fault on our side.' });
    const { onDone } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(saveButton());

    expect(await screen.findByText(/a fault on our side/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('add a piece by hand', () => {
  it('appends an editable row, ticked, after the last one', async () => {
    const { container } = open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Chanson' }));
    fireEvent.click(screen.getByRole('button', { name: /Add a piece by hand/ }));

    const input = screen.getByPlaceholderText('Name the piece');
    fireEvent.change(input, { target: { value: 'Minuet in G Major, BWV 114a' } });
    expect(container.querySelectorAll('.pw-rep-row')).toHaveLength(13);
    expect(saveButton()).toHaveTextContent('Save 13 pieces');
  });

  it('an empty hand-added row is never written', async () => {
    open();
    await screen.findByText('Écossaise');
    fireEvent.click(screen.getByRole('button', { name: 'Écossaise' }));
    fireEvent.click(screen.getByRole('button', { name: /Add a piece by hand/ }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(confirmSeed).toHaveBeenCalled());
    const [rows] = confirmSeed.mock.calls[0] as [Array<{ label: string }>];
    expect(rows.map((r) => r.label)).toEqual(['Écossaise']);
  });
});

describe('what the screen says when it has no list', () => {
  it('a fault reads as a fault — never as a count, never as an empty book', async () => {
    expandCollection.mockResolvedValue({
      ok: false,
      fault: 'I could not look that up just now — a fault on our side, not an empty book.',
    });
    const { container } = open();

    expect(await screen.findByText(/a fault on our side, not an empty book/)).toBeInTheDocument();
    expect(screen.queryByText(/0 PIECES FOUND/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PIECES FOUND/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.pw-rep-row')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
  });

  it('offers a retry that asks again', async () => {
    expandCollection.mockResolvedValue({ ok: false, fault: 'a fault on our side' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(expandCollection).toHaveBeenCalledTimes(2));
  });

  it('a collection it does not know says so, and does not show an empty table as an answer', async () => {
    expandCollection.mockResolvedValue({ ok: true, collection: 'Grade 47 flugelhorn', candidates: [] });
    const { container } = open();

    expect(await screen.findByText(/I don.t know that one/)).toBeInTheDocument();
    expect(container.querySelectorAll('.pw-rep-row')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Add a piece by hand/ })).toBeInTheDocument();
  });
});

describe('a title that names more than one piece', () => {
  it('says so on the row rather than letting it land as an unfindable record', async () => {
    expandCollection.mockResolvedValue({
      ok: true,
      collection: 'Suzuki Piano Book 2',
      candidates: candidates([{ ambiguous: true }]),
    });
    const { container } = open();
    await screen.findByText('Écossaise');
    expect(screen.getByText(/names more than one piece/)).toBeInTheDocument();
    expect(container.querySelectorAll('.pw-rep-note')).toHaveLength(1);
  });
});
