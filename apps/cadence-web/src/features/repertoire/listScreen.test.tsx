/**
 * "What I'm learning" (P6 "the room") — every button and every router on the list screen: the
 * four groups render in order with the right headers; Keeping up reads longest-rest-first and Up
 * next reads rank order; a collision card appears only for a real collision, and its verb opens
 * the right item; the ＋ door's four rows go where they say; the empty state shows only when the
 * payload is empty; a ⋯ move posts the right status; a ⋯ reorder posts ranks.
 *
 * P2's `ItemScreen` and P4's `SeedReview` are mocked to thin stand-ins that expose their props —
 * this pins THIS screen's routing into them (right item, right collision, right collection name),
 * never their own internal behaviour (each has its own test file already). Every other component
 * rendered here (`RepertoireGroup`, `RepertoireRow`, `CollisionCard`, `AddDoor`, `HandAddSheet`,
 * `EmptyState`) is this parcel's own and is exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RepertoireItem } from '@cadence/shared';
import { COMPOSER_KEY, PRACTICE_NOTE_KEY, RANK_KEY } from '@cadence/shared';
import { COLLECTIONS_TITLE } from './collectionsCopy.ts';

const getRepertoireListItems = vi.hoisted(() => vi.fn());
const useProgressRepertoire = vi.hoisted(() => vi.fn());
const patchRepertoireItem = vi.hoisted(() => vi.fn());
const confirmSeed = vi.hoisted(() => vi.fn());
const getReview = vi.hoisted(() => vi.fn());
const getCollections = vi.hoisted(() => vi.fn());
const renameCollection = vi.hoisted(() => vi.fn());
const removeCollection = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api/repertoire-list.ts', () => ({
  getRepertoireListItems: (...a: unknown[]) => getRepertoireListItems(...a),
}));
vi.mock('../../lib/query/index.ts', () => ({
  useProgressRepertoire: (...a: unknown[]) => useProgressRepertoire(...a),
}));
vi.mock('../../lib/api/repertoire-item.ts', () => ({
  patchRepertoireItem: (...a: unknown[]) => patchRepertoireItem(...a),
}));
vi.mock('../../lib/api/repertoire-seed.ts', () => ({
  confirmSeed: (...a: unknown[]) => confirmSeed(...a),
}));
vi.mock('../../lib/api/review.ts', () => ({
  getReview: (...a: unknown[]) => getReview(...a),
}));
// The collections screen (P11) is NOT mocked — the ＋ door's fourth row has to open the real one,
// which is the routing this file exists to pin. Its client is.
vi.mock('../../lib/api/repertoire-collections.ts', () => ({
  getCollections: (...a: unknown[]) => getCollections(...a),
  renameCollection: (...a: unknown[]) => renameCollection(...a),
  removeCollection: (...a: unknown[]) => removeCollection(...a),
}));
vi.mock('./ItemScreen.tsx', () => ({
  ItemScreen: ({
    item,
    collidesWithLabel,
    onBack,
    onDeleted,
  }: {
    item: RepertoireItem;
    collidesWithLabel?: string | null;
    onBack: () => void;
    onDeleted: (id: string) => void;
  }) => (
    <div data-testid="item-screen">
      <span data-testid="item-screen-label">{item.label}</span>
      <span data-testid="item-screen-collides">{collidesWithLabel ?? ''}</span>
      <button onClick={onBack}>item-screen-back</button>
      <button onClick={() => onDeleted(item.item_id)}>item-screen-deleted</button>
    </div>
  ),
}));
vi.mock('./SeedReview.tsx', () => ({
  SeedReview: ({ collection, onDone }: { collection: string; onDone: (n: number) => void }) => (
    <div data-testid="seed-review">
      <span data-testid="seed-review-collection">{collection}</span>
      <button onClick={() => onDone(3)}>seed-review-done</button>
    </div>
  ),
}));

const { ListScreen } = await import('./ListScreen.tsx');

const CARD = { learned_in_year: 6, noun: 'pieces' };

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-x',
    user_id: 'u1',
    goal_id: 'g-piano',
    label: 'Untitled',
    status: 'known',
    kind: 'piece',
    meta: null,
    collection_id: null,
    collection_name: null,
    started_at: '2026-01-01T00:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const BASE_ITEMS: RepertoireItem[] = [
  item({ item_id: 'melody', label: 'Melody', status: 'working' }),
  item({ item_id: 'prelude', label: 'Prelude', status: 'queued', meta: { [RANK_KEY]: 1 } }),
  item({ item_id: 'frankie', label: 'Frankie and Johnnie', status: 'queued', meta: { [RANK_KEY]: 2 } }),
  item({ item_id: 'ecossaise', label: 'Écossaise', status: 'known', last_practiced_at: daysAgo(19) }),
  item({ item_id: 'minuetA', label: 'Minuet in A', status: 'known', last_practiced_at: daysAgo(1) }),
  item({ item_id: 'cradle', label: 'Cradle Song', status: 'retired', learned_at: daysAgo(200) }),
];

function mount(
  over: {
    items?: RepertoireItem[];
    collisions?: unknown[];
    collections?: unknown[];
    goalId?: string | null;
  } = {},
) {
  getRepertoireListItems.mockResolvedValue({
    ok: true,
    items: over.items ?? BASE_ITEMS,
    collisions: over.collisions ?? [],
    collections: over.collections ?? [],
  });
  useProgressRepertoire.mockReturnValue({ data: CARD });
  getReview.mockResolvedValue({ goals: [] });
  // 'goalId' in over, not `over.goalId ?? default`: a test that passes goalId: null means it, and
  // `??` would otherwise silently replace that null with the default too.
  const goalId = 'goalId' in over ? (over.goalId ?? null) : 'g-piano';
  return render(<ListScreen goalId={goalId} goalName="Piano" onBack={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCollections.mockResolvedValue({ ok: true, collections: [] });
});

/** The group header's own name word (`.rl-group-name-word`) — scoped so it is never confused with
 *  a ROW's standing label, which reads the same word (e.g. a Learning row also says "Learning"). */
function groupSection(container: HTMLElement, name: string): HTMLElement {
  const word = [...container.querySelectorAll('.rl-group-name-word')].find((el) => el.textContent === name);
  if (!word) throw new Error(`no group header named "${name}"`);
  return word.closest('section') as HTMLElement;
}

describe('groups — order, header, and count', () => {
  it('renders the four groups in order: Learning, Up next, Keeping up, Learned', async () => {
    const { container } = mount();
    await screen.findByText('Melody');
    const names = [...container.querySelectorAll('.rl-group-name-word')].map((n) => n.textContent);
    expect(names).toEqual(['Learning', 'Up next', 'Keeping up', 'Learned']);
  });

  it("quotes the four GROUP_LINES verbatim — the coach's own words, not @cadence/shared's prompt text", async () => {
    const { container } = mount();
    await screen.findByText('Melody');

    // The count is read off its own element, never by text: a ranked group renders rank numbers on
    // its rows too (a ladder is any ordered collection now), and "2" would match either.
    const countOf = (section: HTMLElement) => section.querySelector('.rl-group-count')?.textContent;

    const learning = groupSection(container, 'Learning');
    expect(countOf(learning)).toBe('1');
    expect(within(learning).getByText("what we're working on now")).toBeInTheDocument();

    const upNext = groupSection(container, 'Up next');
    expect(countOf(upNext)).toBe('2');
    expect(within(upNext).getByText('not started yet, in your order')).toBeInTheDocument();

    const keepingUp = groupSection(container, 'Keeping up');
    expect(countOf(keepingUp)).toBe('2');
    expect(within(keepingUp).getByText('learned and still played')).toBeInTheDocument();

    const learned = groupSection(container, 'Learned');
    expect(countOf(learned)).toBe('1');
    expect(within(learned).getByText('finished')).toBeInTheDocument();
  });

  it('renders the header count line from the payload, never recomputed', async () => {
    mount();
    expect(await screen.findByText('6 PIECES · 6 LEARNED THIS YEAR')).toBeInTheDocument();
  });

  it('an unranked Keeping up group reads least-recently-practised first', async () => {
    const { container } = mount();
    await screen.findByText('Melody');
    const section = groupSection(container, 'Keeping up');
    const titles = within(section)
      .getAllByText(/^(Écossaise|Minuet in A)$/)
      .map((n) => n.textContent);
    expect(titles).toEqual(['Écossaise', 'Minuet in A']);
  });

  it('Up next reads rank order, ascending', async () => {
    const { container } = mount();
    await screen.findByText('Melody');
    const section = groupSection(container, 'Up next');
    const titles = within(section)
      .getAllByText(/^(Prelude|Frankie and Johnnie)$/)
      .map((n) => n.textContent);
    expect(titles).toEqual(['Prelude', 'Frankie and Johnnie']);
  });
});

describe('collisions', () => {
  const colliding: RepertoireItem[] = [
    item({ item_id: 'm1', label: 'Minuet in G Major, BWV 822', status: 'known' }),
    item({ item_id: 'm2', label: 'Minuet in G Major (Anna Magdalena)', status: 'known' }),
    item({ item_id: 'clear', label: 'Clair de lune', status: 'known' }),
  ];
  const collisions = [
    { shared: 'minuet in g major', labels: ['Minuet in G Major, BWV 822', 'Minuet in G Major (Anna Magdalena)'] },
  ];

  it('renders one collision card under EACH of the two colliding rows, and only those two', async () => {
    mount({ items: colliding, collisions });
    const cards = await screen.findAllByText("When you tell me you practised it, I can't tell which.");
    expect(cards).toHaveLength(2);
  });

  it('a row with no collision never gets a card', async () => {
    mount({ items: colliding, collisions });
    await screen.findByText('Clair de lune');
    // Every rendered card is scoped to the two Minuet rows; "Clair de lune" never appears inside one.
    const consequence = screen.getAllByText("When you tell me you practised it, I can't tell which.");
    for (const c of consequence) expect(c.closest('.rl-collision')?.textContent).not.toContain('Clair de lune');
  });

  it('"Name them apart ›" opens the item screen for the row the card sits under', async () => {
    const user = userEvent.setup();
    mount({ items: colliding, collisions });
    await screen.findByText('Clair de lune');
    // Found by content, not DOM position — orderGroupItems is free to sort the two colliding rows
    // either way, and this must still open the RIGHT one regardless of which renders first. The
    // card's OWN row is always its first bold name (the second is the OTHER piece it matches), so
    // matching on the full card's text (both names appear in each card) would find either one.
    const allCards = document.querySelectorAll('.rl-collision');
    const bwvCard = [...allCards].find((c) => c.querySelector('b')?.textContent?.includes('BWV 822')) as HTMLElement;
    await user.click(within(bwvCard).getByText('Name them apart ›'));
    expect(await screen.findByTestId('item-screen-label')).toHaveTextContent('Minuet in G Major, BWV 822');
    expect(screen.getByTestId('item-screen-collides')).toHaveTextContent('Minuet in G Major (Anna Magdalena)');
  });
});

describe('tapping a row', () => {
  it('opens the item screen for that row, with no collision label when there is none', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('Melody'));
    expect(await screen.findByTestId('item-screen-label')).toHaveTextContent('Melody');
    expect(screen.getByTestId('item-screen-collides')).toHaveTextContent('');
  });

  it('going back from the item screen returns to the list and refreshes it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('Melody'));
    getRepertoireListItems.mockClear();
    await user.click(screen.getByText('item-screen-back'));
    expect(await screen.findByText('Melody')).toBeInTheDocument();
    expect(getRepertoireListItems).toHaveBeenCalledTimes(1);
  });
});

describe('the ⋯ menu — standing changes and Up next reorder', () => {
  it('moving a row to a different standing posts exactly that status', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue({});
    mount();
    await user.click(await screen.findByRole('button', { name: 'Move Melody' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to Keeping up' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('melody', { status: 'known' });
  });

  it('a Learning/Keeping up/Learned row has no Move up/down items — reorder is Up next only', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Move Melody' }));
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).not.toBeInTheDocument();
  });

  it('Move up on the second Up next row swaps rank with the row above it — one PATCH per moved row', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue({});
    mount();
    await user.click(await screen.findByRole('button', { name: 'Move Frankie and Johnnie' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    expect(patchRepertoireItem).toHaveBeenCalledTimes(2);
    expect(patchRepertoireItem).toHaveBeenCalledWith('frankie', { rank: 1 });
    expect(patchRepertoireItem).toHaveBeenCalledWith('prelude', { rank: 2 });
  });

  it('Move up is disabled on the first Up next row — no out-of-range write', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Move Prelude' }));
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  });
});

describe('the ＋ door', () => {
  it('"Start from a collection" asks a name, then opens the seed review with it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText('Start from a collection'));
    await user.type(screen.getByPlaceholderText(/look up what's in it/), 'Suzuki Piano Book 2');
    await user.click(screen.getByText('Look it up'));
    expect(await screen.findByTestId('seed-review-collection')).toHaveTextContent('Suzuki Piano Book 2');
  });

  it('finishing the seed review returns to the list and refreshes it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText('Start from a collection'));
    await user.type(screen.getByPlaceholderText(/look up what's in it/), 'A Book');
    await user.click(screen.getByText('Look it up'));
    getRepertoireListItems.mockClear();
    await user.click(await screen.findByText('seed-review-done'));
    expect(await screen.findByText('Melody')).toBeInTheDocument();
    expect(getRepertoireListItems).toHaveBeenCalledTimes(1);
  });

  it('"Add one by hand" opens the hand-add sheet, and Save posts a one-row seed confirm', async () => {
    const user = userEvent.setup();
    confirmSeed.mockResolvedValue({ ok: true, written: 1, labels: ['A New Piece'], refused: [] });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText('Add one by hand'));
    await user.type(await screen.findByLabelText('Name'), 'A New Piece');
    getRepertoireListItems.mockClear();
    await user.click(screen.getByText('Save'));
    // rank: null, never a fabricated 1 — this piece has no real order (it wasn't placed against a
    // book), and a fake rank would sort it first the moment it ever moved into Up next.
    expect(confirmSeed).toHaveBeenCalledWith(
      [{ label: 'A New Piece', composer: null, collection: null, rank: null, status: 'working' }],
      'g-piano',
    );
    expect(await screen.findByText('Melody')).toBeInTheDocument(); // sheet closed, list refreshed
    expect(getRepertoireListItems).toHaveBeenCalledTimes(1);
  });

  it('"Just tell me in chat" hands the coach a note and closes the door', async () => {
    const user = userEvent.setup();
    const onOpenChat = vi.fn();
    getRepertoireListItems.mockResolvedValue({ ok: true, items: BASE_ITEMS, collisions: [] });
    useProgressRepertoire.mockReturnValue({ data: CARD });
    render(<ListScreen goalId="g-piano" goalName="Piano" onBack={() => {}} onOpenChat={onOpenChat} />);
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText('Just tell me in chat'));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onOpenChat.mock.calls[0]?.[0]).toMatch(/what they play or are working on/);
    expect(screen.queryByText('Add something')).not.toBeInTheDocument();
  });

  /**
   * The fourth row (P11) — the only one that adds nothing to the list; it opens the one place a
   * collection can be renamed or removed. It is last for that reason, and the order is asserted
   * because a row that moves is a row someone taps by accident.
   */
  it('offers four rows, "Your collections" last', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const rows = [...document.querySelectorAll('.ld-row .ld-row-t b')].map((b) => b.textContent);
    expect(rows).toEqual(['Start from a collection', 'Add one by hand', 'Just tell me in chat', COLLECTIONS_TITLE]);
  });

  it('"Your collections" closes the door and opens the collections screen', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [] });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText(COLLECTIONS_TITLE));
    expect(screen.queryByText('Add something')).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: COLLECTIONS_TITLE })).toBeInTheDocument();
  });

  it('back from the collections screen returns to the list and refreshes it', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [] });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(await screen.findByText(COLLECTIONS_TITLE));
    await screen.findByRole('dialog', { name: COLLECTIONS_TITLE });
    getRepertoireListItems.mockClear();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Melody')).toBeInTheDocument();
    expect(getRepertoireListItems).toHaveBeenCalledTimes(1);
  });
});

describe('empty state', () => {
  it('shows only when there is nothing on file — never once there is', async () => {
    mount({ items: [] });
    expect(await screen.findByText("Tell me what you already know, and I'll stop asking.")).toBeInTheDocument();
    expect(screen.queryByText('Learning')).not.toBeInTheDocument();

    cleanup();
    mount();
    await screen.findByText('Melody');
    expect(screen.queryByText("Tell me what you already know, and I'll stop asking.")).not.toBeInTheDocument();
  });

  it("the empty state's three doors are the three the ＋ menu offers for ADDING material", async () => {
    mount({ items: [] });
    await screen.findByText("Tell me what you already know, and I'll stop asking.");
    expect(screen.getByLabelText('Name a collection')).toBeInTheDocument();
    expect(screen.getByText('Add one by hand')).toBeInTheDocument();
    expect(screen.getByText('Just tell me in chat')).toBeInTheDocument();
  });
});

describe('unattached material', () => {
  it('gets its own "NOT TIED TO A GOAL" hairline inside the group it belongs to', async () => {
    const items = [
      item({ item_id: 'linked', label: 'Linked Piece', status: 'known', goal_id: 'g-piano' }),
      item({ item_id: 'free', label: 'Free Piece', status: 'known', goal_id: null }),
    ];
    mount({ items, goalId: null });
    await screen.findByText('Linked Piece');
    expect(screen.getByText('NOT TIED TO A GOAL')).toBeInTheDocument();
    expect(screen.getByText('Free Piece')).toBeInTheDocument();
  });

  it('an all-linked group shows no hairline at all', async () => {
    mount();
    await screen.findByText('Melody');
    expect(screen.queryByText('NOT TIED TO A GOAL')).not.toBeInTheDocument();
  });
});

describe('a fault reading the shelf', () => {
  it('shows the fault and retries on request, never an empty list read as "nothing on file"', async () => {
    const user = userEvent.setup();
    getRepertoireListItems.mockResolvedValueOnce({ ok: false, fault: 'a fault on our side' });
    useProgressRepertoire.mockReturnValue({ data: CARD });
    render(<ListScreen goalId="g-piano" goalName="Piano" onBack={() => {}} />);
    expect(await screen.findByText('a fault on our side')).toBeInTheDocument();
    expect(screen.queryByText("Tell me what you already know, and I'll stop asking.")).not.toBeInTheDocument();

    getRepertoireListItems.mockResolvedValueOnce({ ok: true, items: BASE_ITEMS, collisions: [] });
    await user.click(screen.getByText('Try again'));
    expect(await screen.findByText('Melody')).toBeInTheDocument();
  });
});

describe('scoping', () => {
  it('requests items for the goal it was opened with', async () => {
    mount({ goalId: 'g-kata' });
    await screen.findByText('Melody');
    expect(getRepertoireListItems).toHaveBeenCalledWith('g-kata');
  });

  it('a null goalId requests everything they keep', async () => {
    mount({ goalId: null });
    await screen.findByText('Melody');
    expect(getRepertoireListItems).toHaveBeenCalledWith(null);
  });

  it("composer and collection, when on file, show on the row's second line", async () => {
    mount({
      items: [
        item({
          item_id: 'debussy1',
          label: 'Clair de lune',
          status: 'known',
          meta: { [COMPOSER_KEY]: 'Debussy' },
          collection_name: 'Suite bergamasque',
        }),
      ],
    });
    await screen.findByText('Clair de lune');
    expect(screen.getByText('Debussy · Suite bergamasque')).toBeInTheDocument();
  });
});

/**
 * A ladder is any ordered collection (owner ruling 2026-09-03): a group where every item carries a
 * rank reads in rank order instead of the standing's own rule, end to end through the real DOM.
 * The rule itself — including the row that flipped, a ranked group of ordinary pieces — is
 * table-tested at the unit level in repertoireListCopy.test.ts; this pins the WIRING, plus the rank
 * number each ladder row shows.
 */
describe('a kata ladder (P8)', () => {
  const belt = (rank: number, label: string, note?: string) =>
    item({
      item_id: `belt-${rank}`,
      label,
      status: 'known',
      kind: 'kata',
      // Rest order alone would read Orange (20d), Brown (10d), Yellow (1d) — the opposite of rank
      // order — so a pass here proves rank actually overrode rest, not a coincidence of the data.
      last_practiced_at: daysAgo(rank === 1 ? 1 : rank === 2 ? 20 : 10),
      meta: note ? { [RANK_KEY]: rank, [PRACTICE_NOTE_KEY]: note } : { [RANK_KEY]: rank },
    });

  it('a fully-ranked shelf renders Keeping up in rank order, not rest order', async () => {
    const { container } = mount({
      items: [belt(3, 'Brown belt'), belt(1, 'Yellow belt'), belt(2, 'Orange belt')],
      collisions: [],
    });
    await screen.findByText('Yellow belt');
    const section = groupSection(container, 'Keeping up');
    const titles = within(section)
      .getAllByText(/^(Yellow belt|Orange belt|Brown belt)$/)
      .map((n) => n.textContent);
    expect(titles).toEqual(['Yellow belt', 'Orange belt', 'Brown belt']);
  });

  it('the grading note is the whole second line when there is nothing else on file yet', async () => {
    mount({
      items: [
        item({
          item_id: 'belt-1',
          label: 'Yellow belt',
          status: 'queued',
          kind: 'kata',
          meta: { [RANK_KEY]: 1, [PRACTICE_NOTE_KEY]: 'for 5th kyu' },
        }),
      ],
      collisions: [],
    });
    await screen.findByText('Yellow belt');
    expect(screen.getByText('for 5th kyu')).toBeInTheDocument();
  });

  it('one ungraded belt and the shelf falls back to the standing rule (rest order), no ranks shown', async () => {
    const { container } = mount({
      items: [
        belt(1, 'Yellow belt'),
        item({
          item_id: 'ungraded',
          label: 'Ungraded belt',
          status: 'known',
          kind: 'kata',
          last_practiced_at: daysAgo(30),
        }),
      ],
      collisions: [],
    });
    await screen.findByText('Yellow belt');
    const section = groupSection(container, 'Keeping up');
    // Falls back to byRest (longest-resting first): the ungraded belt rested 30 days, Yellow 1 —
    // rank order would have put Yellow first, so this proves the fallback actually fired.
    const titles = within(section)
      .getAllByText(/^(Yellow belt|Ungraded belt)$/)
      .map((n) => n.textContent);
    expect(titles).toEqual(['Ungraded belt', 'Yellow belt']);
    // Not a ladder any more (one item lacks a rank) — neither row shows a rank number.
    expect(section.querySelector('.rl-row-rank')).toBeNull();
  });

  it('shows the rank 1, 2, 3 in order on a fully-ranked kata ladder, left of each title', async () => {
    mount({
      items: [belt(3, 'Brown belt'), belt(1, 'Yellow belt'), belt(2, 'Orange belt')],
      collisions: [],
    });
    await screen.findByText('Yellow belt');
    const ranks = [...document.querySelectorAll('.rl-row-rank')].map((el) => el.textContent);
    expect(ranks).toEqual(['1', '2', '3']);
  });

  /**
   * THE FLIP (owner ruling 2026-09-03): a ranked group of ordinary pieces now DOES read as a
   * ladder and shows its numbers. It did not until today, because the coach read row position as a
   * rotation and the screen could not be allowed to contradict her; she reads no position now.
   */
  it('a ranked group of ordinary pieces reads as a ladder and shows its numbers', async () => {
    mount({
      items: [
        item({ item_id: 'p2', label: 'Sarabande', status: 'known', kind: 'piece', meta: { [RANK_KEY]: 2 } }),
        item({ item_id: 'p1', label: 'Prelude', status: 'known', kind: 'piece', meta: { [RANK_KEY]: 1 } }),
      ],
      collisions: [],
    });
    await screen.findByText('Prelude');
    expect([...document.querySelectorAll('.rl-row-rank')].map((e) => e.textContent)).toEqual(['1', '2']);
  });

  it('a group where one row has no rank shows no numbers at all — a part-ladder is not one', async () => {
    mount({
      items: [
        item({ item_id: 'p1', label: 'Prelude', status: 'known', kind: 'piece', meta: { [RANK_KEY]: 1 } }),
        item({ item_id: 'p2', label: 'Sarabande', status: 'known', kind: 'piece', meta: null }),
      ],
      collisions: [],
    });
    await screen.findByText('Prelude');
    expect(document.querySelector('.rl-row-rank')).toBeNull();
  });
});

/**
 * Books, 200 long (P8 "books — a record"): an all-book Learned group collapses into year buckets
 * behind a find field once it passes 30 items. Table: the collapse itself, opening a bucket,
 * returning to the buckets, the find field bypassing them, and the Learned→Finished word swap —
 * end to end, on top of the same helpers repertoireListCopy.test.ts already table-tests.
 */
describe('a books shelf, 200 long (P8)', () => {
  function bookShelf(): RepertoireItem[] {
    const books: RepertoireItem[] = [];
    for (let i = 0; i < 25; i++) {
      books.push(
        item({
          item_id: `b25-${i}`,
          label: `2025 Book ${i}`,
          status: 'retired',
          kind: 'book',
          learned_at: '2025-06-01T00:00:00Z',
        }),
      );
    }
    for (let i = 0; i < 10; i++) {
      books.push(
        item({
          item_id: `b24-${i}`,
          label: `2024 Book ${i}`,
          status: 'retired',
          kind: 'book',
          learned_at: '2024-06-01T00:00:00Z',
        }),
      );
    }
    return books; // 35 total — over the 30-item threshold.
  }

  it('collapses into year buckets with a find field, hiding the individual rows', async () => {
    mount({ items: bookShelf(), collisions: [] });
    await screen.findByLabelText('Find a title');
    expect(screen.getByText('2025 · 25 finished ›')).toBeInTheDocument();
    expect(screen.getByText('2024 · 10 finished ›')).toBeInTheDocument();
    expect(screen.queryByText('2025 Book 0')).not.toBeInTheDocument();
  });

  it('opening a year bucket shows that year alone, and "All years" returns to the buckets', async () => {
    const user = userEvent.setup();
    mount({ items: bookShelf(), collisions: [] });
    await user.click(await screen.findByText('2024 · 10 finished ›'));
    expect(await screen.findByText('2024 Book 0')).toBeInTheDocument();
    expect(screen.queryByText('2025 Book 0')).not.toBeInTheDocument();

    await user.click(screen.getByText('‹ All years'));
    expect(await screen.findByText('2025 · 25 finished ›')).toBeInTheDocument();
    expect(screen.queryByText('2024 Book 0')).not.toBeInTheDocument();
  });

  it('the find field filters across every year, bypassing the buckets entirely', async () => {
    const user = userEvent.setup();
    mount({ items: bookShelf(), collisions: [] });
    await screen.findByLabelText('Find a title');
    await user.type(screen.getByLabelText('Find a title'), '2024 Book 3');
    expect(await screen.findByText('2024 Book 3')).toBeInTheDocument();
    expect(screen.queryByText('2025 Book 0')).not.toBeInTheDocument();
    expect(screen.queryByText('2025 · 25 finished ›')).not.toBeInTheDocument();
  });

  it('a shelf at the threshold (30) does not collapse — rows and no find field', async () => {
    mount({ items: bookShelf().slice(0, 30), collisions: [] });
    await screen.findByText('2025 Book 0');
    expect(screen.queryByLabelText('Find a title')).not.toBeInTheDocument();
  });

  it('the group header and each row read "Finished", never "Learned", for an all-books shelf', async () => {
    const user = userEvent.setup();
    const { container } = mount({ items: bookShelf(), collisions: [] });
    await screen.findByLabelText('Find a title');
    expect(groupSection(container, 'Finished')).toBeTruthy();

    await user.click(screen.getByText('2024 · 10 finished ›'));
    const title = await screen.findByText('2024 Book 0');
    const row = title.closest('.rl-row') as HTMLElement;
    expect(within(row).getByText('Finished')).toBeInTheDocument();
  });
});

/**
 * Verses, by heart (P8 "verses — by heart"): "first stanza" is a plain fact on the line, an item
 * with no author simply omits it, and Progress's own noun for this shelf ("verses", read as "by
 * heart" by cardHeader.ts and by this screen's own headerCountLine) passes through unchanged —
 * never the books "Finished" swap, which is books-only.
 */
describe('verses, by heart (P8)', () => {
  it('an item with no author on file renders the note alone, never a shortfall', async () => {
    mount({
      items: [
        item({
          item_id: 'v1',
          label: 'The Road Not Taken',
          status: 'working',
          kind: 'verse',
          meta: { [PRACTICE_NOTE_KEY]: 'first stanza' },
        }),
      ],
      collisions: [],
    });
    await screen.findByText('The Road Not Taken');
    expect(screen.getByText('first stanza')).toBeInTheDocument();
    expect(screen.queryByText(/only|just|still|behind/i)).not.toBeInTheDocument();
  });

  it('an author on file comes first, the note right after — reusing the same composer qualifier', async () => {
    mount({
      items: [
        item({
          item_id: 'v2',
          label: 'Sonnet 18',
          status: 'working',
          kind: 'verse',
          meta: { [COMPOSER_KEY]: 'Shakespeare', [PRACTICE_NOTE_KEY]: 'first stanza' },
        }),
      ],
      collisions: [],
    });
    await screen.findByText('Sonnet 18');
    expect(screen.getByText('Shakespeare · first stanza')).toBeInTheDocument();
  });

  it("the header count line reads BY HEART for verses — the same word P5's progress card uses", async () => {
    getRepertoireListItems.mockResolvedValue({
      ok: true,
      items: [item({ item_id: 'v1', label: 'The Road Not Taken', status: 'working', kind: 'verse' })],
      collisions: [],
    });
    useProgressRepertoire.mockReturnValue({ data: { learned_in_year: 2, noun: 'verses' } });
    getReview.mockResolvedValue({ goals: [] });
    render(<ListScreen goalId="g-piano" goalName="Verses" onBack={() => {}} />);
    expect(await screen.findByText('1 VERSES · 2 BY HEART THIS YEAR')).toBeInTheDocument();
  });
});
