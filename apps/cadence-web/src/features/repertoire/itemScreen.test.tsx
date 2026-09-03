/**
 * The item, opened (P2) — every button on the screen, positive and near-miss: rename saves and
 * preserves the id; a blank name cannot be saved; the standing control posts the exact schema
 * word for each of the four taps; tempo has no input anywhere on the screen; Remove asks before
 * it deletes, and backs off on Cancel; the collision card appears only when the caller says one
 * exists. `lib/api/repertoire-item.ts` is mocked — this pins the SCREEN's behaviour, not the
 * network (that is progress-extras-repertoire.test.ts's job, on the API side).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RepertoireCollection, RepertoireItem } from '@cadence/shared';
import { ItemScreen, COLLISION_NOTICE } from './ItemScreen.tsx';
import { REMOVE_CONSEQUENCE } from './ItemRemove.tsx';
import { FIELD_HINTS } from './itemFieldCopy.ts';
import { COLLECTION_NAME_HINT, MANAGE_COLLECTIONS } from './collectionsCopy.ts';

const patchRepertoireItem = vi.hoisted(() => vi.fn());
const deleteRepertoireItem = vi.hoisted(() => vi.fn());
const addCollection = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/repertoire-item.ts', () => ({
  patchRepertoireItem: (...a: unknown[]) => patchRepertoireItem(...a),
  deleteRepertoireItem: (...a: unknown[]) => deleteRepertoireItem(...a),
}));
vi.mock('../../lib/api/repertoire-collections.ts', () => ({
  addCollection: (...a: unknown[]) => addCollection(...a),
}));

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-1',
    user_id: 'u1',
    goal_id: 'g-piano',
    label: 'Clair de lune',
    status: 'known',
    kind: 'piece',
    meta: { composer: 'Debussy' },
    collection_id: null,
    collection_name: null,
    started_at: '2026-01-05T09:00:00Z',
    learned_at: '2026-03-14T09:00:00Z',
    last_practiced_at: '2026-08-29T18:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  patchRepertoireItem.mockReset();
  deleteRepertoireItem.mockReset();
  addCollection.mockReset();
  vi.restoreAllMocks();
});

describe('rename', () => {
  it('saves and preserves the id — the write targets the row, never the label', async () => {
    const user = userEvent.setup();
    const saved = item({ label: 'Clair de lune (easier arrangement)' });
    patchRepertoireItem.mockResolvedValue(saved);
    render(<ItemScreen item={item()} onBack={() => {}} />);

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Clair de lune (easier arrangement)');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));

    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune (easier arrangement)',
      composer: 'Debussy',
      collection_id: null,
    });
    expect(await screen.findByText('Clair de lune (easier arrangement)')).toBeInTheDocument();
  });

  it('renders the reassurance sentence under the name fields, verbatim', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(
      screen.getByText('Whatever you call it, it keeps its sessions, tempo and dates. Only the words change.'),
    ).toBeInTheDocument();
  });

  it('a blank name cannot be saved — the button stays disabled, near-miss for "saves anything"', async () => {
    const user = userEvent.setup();
    render(<ItemScreen item={item()} onBack={() => {}} />);
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    expect(screen.getByRole('button', { name: 'Save the name' })).toBeDisabled();
    expect(patchRepertoireItem).not.toHaveBeenCalled();
  });

  it("a rename collision surfaces the server's own message rather than a generic failure", async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockRejectedValue(new Error('"Clair de lune" already has this name'));
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByText('"Clair de lune" already has this name')).toBeInTheDocument();
  });
});

/**
 * The practice note (P8: "the practice note gets a store") — how the work is going, saved through
 * the same "Save the name" action as the other fields, for every kind (not just music). The label
 * the person reads is "Notes"; the schema key stays `practice_note` (CLAUDE.md's nomenclature
 * rule), which is why every assertion here names the label and the key separately.
 */
describe('the practice note', () => {
  it('saves alongside the other fields when filled in', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.type(screen.getByLabelText('Notes (optional)'), 'bars 9-16');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
      note: 'bars 9-16',
    });
  });

  it('starts from what is already on file', () => {
    render(<ItemScreen item={item({ meta: { composer: 'Debussy', practice_note: 'p. 240' } })} onBack={() => {}} />);
    expect(screen.getByLabelText('Notes (optional)')).toHaveDisplayValue('p. 240');
  });

  it('a blank note is left out of the request rather than sent as "" — same rule as composer', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
    });
  });

  it('is not the tempo field — it stays editable for a piece that already has a settled tempo', () => {
    render(<ItemScreen item={item({ meta: { composer: 'Debussy', tempo_bpm: 60 } })} onBack={() => {}} />);
    const note = screen.getByLabelText('Notes (optional)');
    expect(note).not.toBeDisabled();
    expect(note).toHaveDisplayValue('');
  });
});

/**
 * The Collection control — a picker over the person's collections, and it picks an ID (P11,
 * migration 0056). Never a text box (owner ruling 2026-09-03: *"a collection only works if it's not
 * free-text"*): typing a name is how groups drift — "Suzuki Book 2", "Suzuki book 2" and "suzuki bk
 * 2" are three groups where the person meant one, and nothing on any screen ever shows them that.
 *
 * A table, because every case here fails silently — the wrong value saves, the screen looks right,
 * and the person finds the item in the wrong collection (or in none) a week later.
 */
describe('the collection picker', () => {
  const BOOK2 = { collection_id: 'c-1', name: 'Suzuki Piano Book 2', item_count: 12 };
  const KATA = { collection_id: 'c-2', name: 'Shotokan kata syllabus', item_count: 27 };

  const withCollections = (collections: RepertoireCollection[], over: Partial<RepertoireItem> = {}) =>
    render(<ItemScreen item={item(over)} collections={collections} onBack={() => {}} />);

  const optionTexts = () =>
    [...screen.getByLabelText('Collection').querySelectorAll('option')].map((o) => o.textContent);

  it('offers None, every collection they have, and one way to add a new name', () => {
    withCollections([BOOK2, KATA]);
    expect(optionTexts()).toEqual(['None', 'Suzuki Piano Book 2', 'Shotokan kata syllabus', 'Add a collection…']);
  });

  it('offers "Manage collections…" only when there is a screen to open', () => {
    const { unmount } = withCollections([BOOK2]);
    expect(screen.queryByRole('option', { name: MANAGE_COLLECTIONS })).not.toBeInTheDocument();
    unmount();
    render(<ItemScreen item={item()} collections={[BOOK2]} onManageCollections={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('option', { name: MANAGE_COLLECTIONS })).toBeInTheDocument();
  });

  it('choosing "Manage collections…" opens the screen and never becomes the collection', async () => {
    const user = userEvent.setup();
    const onManageCollections = vi.fn();
    patchRepertoireItem.mockResolvedValue(item());
    render(
      <ItemScreen
        item={item({ collection_id: 'c-1', collection_name: 'Suzuki Piano Book 2' })}
        collections={[BOOK2]}
        onManageCollections={onManageCollections}
        onBack={() => {}}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Collection'), MANAGE_COLLECTIONS);
    expect(onManageCollections).toHaveBeenCalled();
    expect(screen.getByLabelText('Collection')).toHaveValue('c-1');
  });

  it('starts on the collection this item is already in', () => {
    withCollections([BOOK2], { collection_id: 'c-1', collection_name: 'Suzuki Piano Book 2' });
    expect(screen.getByLabelText('Collection')).toHaveValue('c-1');
  });

  /** A stale list read can come back without this item's own collection. The picker must still show
   *  it — silently dropping the value would read as "you never chose one". */
  it("keeps this item's own collection in the list even when the read did not carry it", () => {
    withCollections([KATA], { collection_id: 'c-9', collection_name: 'A Private Book' });
    expect(optionTexts()).toContain('A Private Book');
    expect(screen.getByLabelText('Collection')).toHaveValue('c-9');
  });

  it('saves the id of the one that was picked, never its name', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    withCollections([BOOK2, KATA]);
    await user.selectOptions(screen.getByLabelText('Collection'), 'c-2');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: 'c-2',
    });
  });

  /** None is a real state, not an absent field: `collection_id: null` is what takes an item out of
   *  a collection, and omitting it would make that impossible to say. */
  it('None saves collection_id null, so an item can leave a collection', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    withCollections([BOOK2], { collection_id: 'c-1', collection_name: 'Suzuki Piano Book 2' });
    await user.selectOptions(screen.getByLabelText('Collection'), 'None');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
    });
  });

  it('an item in none saves null without being touched', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    withCollections([BOOK2]);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
    });
  });

  /**
   * "Add a collection…" makes the collection through the API BEFORE the item is saved, then selects
   * it. Carrying a typed name until the item's own save would need a second way for a collection to
   * come into existence, and would surface a duplicate as a failure to save the item.
   */
  it('adds a new collection through the API and selects it', async () => {
    const user = userEvent.setup();
    addCollection.mockResolvedValue({
      ok: true,
      collection: { collection_id: 'c-new', name: 'ABRSM Grade 3', item_count: 0 },
    });
    patchRepertoireItem.mockResolvedValue(item());
    withCollections([BOOK2]);
    expect(screen.queryByLabelText('Collection name')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Collection'), 'Add a collection…');
    await user.type(screen.getByLabelText('Collection name'), 'ABRSM Grade 3');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(addCollection).toHaveBeenCalledWith('ABRSM Grade 3');
    expect(await screen.findByRole('option', { name: 'ABRSM Grade 3' })).toBeInTheDocument();
    expect(screen.getByLabelText('Collection')).toHaveValue('c-new');

    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: 'c-new',
    });
  });

  it('the Add button stays disabled until something is typed', async () => {
    const user = userEvent.setup();
    withCollections([BOOK2]);
    await user.selectOptions(screen.getByLabelText('Collection'), 'Add a collection…');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(screen.getByLabelText('Collection name'), '   ');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(addCollection).not.toHaveBeenCalled();
  });

  /** A name they already have is refused by the server, which names the spelling on file — the
   *  screen shows that sentence rather than a generic failure, because it is the only one that
   *  knows which collection they collided with. */
  it("shows the server's own sentence when the name is already theirs, and adds nothing", async () => {
    const user = userEvent.setup();
    addCollection.mockResolvedValue({
      ok: false,
      fault: 'You already have a collection called "Suzuki Piano Book 2".',
    });
    withCollections([BOOK2]);
    await user.selectOptions(screen.getByLabelText('Collection'), 'Add a collection…');
    await user.type(screen.getByLabelText('Collection name'), 'suzuki piano book 2');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('You already have a collection called "Suzuki Piano Book 2".')).toBeInTheDocument();
    expect(screen.getByLabelText('Collection')).toHaveValue('Add a collection…');
  });

  it('a person with none still gets None and the way to add one', () => {
    withCollections([]);
    expect(optionTexts()).toEqual(['None', 'Add a collection…']);
  });

  it("states what the field is for, in the owner's words", () => {
    withCollections([BOOK2]);
    expect(screen.getByText(FIELD_HINTS.collection)).toBeInTheDocument();
    expect(screen.queryByText(COLLECTION_NAME_HINT)).not.toBeInTheDocument();
  });
});

/**
 * The description (owner ruling 2026-09-03) — their own words for which one this is, and the field
 * that replaced the music-only catalogue number.
 */
describe('the description', () => {
  it('saves alongside the other fields', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.type(screen.getByLabelText('Description (optional)'), 'the fast one in G');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
      description: 'the fast one in G',
    });
  });

  it('starts from what is already on file', () => {
    render(
      <ItemScreen item={item({ meta: { composer: 'Debussy', description: 'the moonlight one' } })} onBack={() => {}} />,
    );
    expect(screen.getByLabelText('Description (optional)')).toHaveDisplayValue('the moonlight one');
  });

  it('is left out of the request when blank, the same rule as every other field', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item());
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune',
      composer: 'Debussy',
      collection_id: null,
    });
  });

  it('has no catalogue field to type into any more', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(screen.queryByLabelText(/catalogue/i)).not.toBeInTheDocument();
  });

  it('reads the fields top to bottom: Name, By, Collection, Description, Notes', () => {
    const { container } = render(<ItemScreen item={item()} onBack={() => {}} />);
    const labels = [...container.querySelectorAll('.ri-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Name', 'By', 'Collection', 'Description (optional)', 'Notes (optional)']);
  });
});

describe('standing control', () => {
  it('posts the exact schema word for each of the four taps, never the button label', async () => {
    const user = userEvent.setup();
    const table: Array<[string, RepertoireItem['status']]> = [
      ['Up next', 'queued'],
      ['Learning', 'working'],
      ['Keeping up', 'known'],
      ['Learned', 'retired'],
    ];
    for (const [buttonLabel, status] of table) {
      patchRepertoireItem.mockReset();
      patchRepertoireItem.mockResolvedValue(item({ status }));
      // Start from a DIFFERENT standing than the one under test — the control is a no-op when
      // you tap the standing it is already showing, which would otherwise make this loop pass
      // for the wrong reason on the one row whose target happens to equal a fixed starting point.
      const startingStatus = status === 'working' ? 'queued' : 'working';
      const { unmount } = render(<ItemScreen item={item({ status: startingStatus })} onBack={() => {}} />);
      await user.click(screen.getByRole('button', { name: buttonLabel }));
      expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', { status });
      unmount();
    }
  });

  it('shows what the chosen standing means, and updates the line when a different one is tapped', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item({ status: 'retired' }));
    render(<ItemScreen item={item({ status: 'known' })} onBack={() => {}} />);
    expect(screen.getByText(/learned, and still played/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Learned' }));
    expect(await screen.findByText(/Bring it back any time/i)).toBeInTheDocument();
  });

  it('reverts to the last-confirmed standing when the write fails, and says so', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockRejectedValue(new Error('network down'));
    render(<ItemScreen item={item({ status: 'known' })} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Learned' }));
    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keeping up' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('tempo — read-only', () => {
  it('renders the settled tempo as text, with no input anywhere on the screen for it', () => {
    render(
      <ItemScreen item={item({ meta: { composer: 'Debussy', tempo_bpm: 60, tempo_meter: 4 } })} onBack={() => {}} />,
    );
    // The header caption ALSO carries a compact "♩ = 60" — this checks the full read-only
    // sentence in the TEMPO section specifically, which is unique to it.
    expect(screen.getByText(/settled from your metronome · changes when you play, not here/)).toBeInTheDocument();
    // Every control on the screen is one of the name fields — Name, By, Description, Notes as text
    // boxes and Collection as a select — and none of them is the tempo, which stays read-only lower
    // down. A tempo input appearing here would let the app overwrite the person's own datum.
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
    for (const el of inputs) expect(el).not.toHaveDisplayValue(/60/);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('the tempo section is absent entirely when no tempo is on file', () => {
    render(<ItemScreen item={item({ meta: { composer: 'Debussy' } })} onBack={() => {}} />);
    expect(screen.queryByText(/♩/)).not.toBeInTheDocument();
  });
});

describe('remove', () => {
  it('asks before it deletes, and does nothing on Cancel', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteRepertoireItem).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('deletes and reports back once confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteRepertoireItem.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(deleteRepertoireItem).toHaveBeenCalledWith('it-1');
    expect(await vi.waitFor(() => onDeleted)).toHaveBeenCalledWith('it-1');
  });

  it('states the consequence at the point of choice, visible before any tap', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(screen.getByText(REMOVE_CONSEQUENCE)).toBeInTheDocument();
  });

  it('a failed delete reports the fault and never calls onDeleted', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteRepertoireItem.mockRejectedValue(new Error('server is down'));
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(await screen.findByText('server is down')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('the collision card', () => {
  it('appears, naming the other piece, only when the caller says one collides', () => {
    render(<ItemScreen item={item()} collidesWithLabel="Clair de lune (reprise)" onBack={() => {}} />);
    expect(screen.getByText(COLLISION_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/Clair de lune \(reprise\)/)).toBeInTheDocument();
  });

  it('is absent for the ordinary case — no collision given', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(screen.queryByText(COLLISION_NOTICE)).not.toBeInTheDocument();
  });

  it('is absent when the caller explicitly says null, same as undefined', () => {
    render(<ItemScreen item={item()} collidesWithLabel={null} onBack={() => {}} />);
    expect(screen.queryByText(COLLISION_NOTICE)).not.toBeInTheDocument();
  });
});
