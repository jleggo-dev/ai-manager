/**
 * "Your collections" (P11, migration 0056) — every button on the screen: Back; Try again on a
 * fault; Rename (open, save, cancel, the disabled near-miss, and the server's own fault); Remove
 * (confirm, cancel, and a fault that must not look like a delete that happened). `lib/api/
 * repertoire-collections.ts` is mocked — this pins the SCREEN's behaviour, not the network (that is
 * routes/repertoire-collections.test.ts's job, on the API side).
 *
 * CollectionRow.tsx has no test file of its own: every one of its buttons is reachable only through
 * this screen (it renders nothing on its own), so pinning them here is pinning the real thing a
 * person taps, not a component in isolation that could drift from how it is actually mounted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RepertoireCollection } from '@cadence/shared';
import { CollectionsScreen } from './CollectionsScreen.tsx';
import { COLLECTIONS_EMPTY, COLLECTIONS_TITLE, REMOVE_COLLECTION_CONFIRM } from './collectionsCopy.ts';

const getCollections = vi.hoisted(() => vi.fn());
const renameCollection = vi.hoisted(() => vi.fn());
const removeCollection = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/repertoire-collections.ts', () => ({
  getCollections: (...a: unknown[]) => getCollections(...a),
  renameCollection: (...a: unknown[]) => renameCollection(...a),
  removeCollection: (...a: unknown[]) => removeCollection(...a),
}));

function collection(over: Partial<RepertoireCollection> = {}): RepertoireCollection {
  return { collection_id: 'c-1', name: 'Suzuki Piano Book 2', item_count: 3, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loading and reading the list', () => {
  it('shows a reading line before the fetch resolves', () => {
    getCollections.mockReturnValue(new Promise(() => {})); // never resolves in this test
    render(<CollectionsScreen onBack={() => {}} />);
    expect(screen.getByText('Reading your collections…')).toBeInTheDocument();
  });

  it('the empty line, when the person has none — never a bare blank screen', async () => {
    getCollections.mockResolvedValue({ ok: true, collections: [] });
    render(<CollectionsScreen onBack={() => {}} />);
    expect(await screen.findByText(COLLECTIONS_EMPTY)).toBeInTheDocument();
  });

  it('a row per collection, its name and its item count', async () => {
    getCollections.mockResolvedValue({
      ok: true,
      collections: [collection(), collection({ collection_id: 'c-2', name: 'Someday', item_count: 0 })],
    });
    render(<CollectionsScreen onBack={() => {}} />);
    expect(await screen.findByRole('dialog', { name: COLLECTIONS_TITLE })).toBeInTheDocument();
    expect(screen.getByText('Suzuki Piano Book 2')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('Someday')).toBeInTheDocument();
    expect(screen.getByText('0 items')).toBeInTheDocument();
  });
});

describe('a fault reading the list', () => {
  it('shows the fault and retries on request, never an empty list read as "you have none"', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValueOnce({ ok: false, fault: 'a fault on our side' });
    render(<CollectionsScreen onBack={() => {}} />);
    expect(await screen.findByText('a fault on our side')).toBeInTheDocument();
    expect(screen.queryByText(COLLECTIONS_EMPTY)).not.toBeInTheDocument();

    getCollections.mockResolvedValueOnce({ ok: true, collections: [collection()] });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Suzuki Piano Book 2')).toBeInTheDocument();
  });
});

describe('Back', () => {
  it('calls onBack', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    const onBack = vi.fn();
    render(<CollectionsScreen onBack={onBack} />);
    await screen.findByText('Suzuki Piano Book 2');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('Rename', () => {
  it('opens an inline field pre-filled with the current name', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    expect(screen.getByDisplayValue('Suzuki Piano Book 2')).toBeInTheDocument();
  });

  it('saves the new name, refreshes the list, and reports the change upward', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValueOnce({ ok: true, collections: [collection()] });
    renameCollection.mockResolvedValue({ ok: true, collection: collection({ name: 'Suzuki Piano Book 2 (rev.)' }) });
    getCollections.mockResolvedValueOnce({
      ok: true,
      collections: [collection({ name: 'Suzuki Piano Book 2 (rev.)' })],
    });
    const onChanged = vi.fn();
    render(<CollectionsScreen onBack={() => {}} onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    const field = screen.getByDisplayValue('Suzuki Piano Book 2');
    await user.clear(field);
    await user.type(field, 'Suzuki Piano Book 2 (rev.)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(renameCollection).toHaveBeenCalledWith('c-1', 'Suzuki Piano Book 2 (rev.)');
    expect(await screen.findByText('Suzuki Piano Book 2 (rev.)')).toBeInTheDocument();
    // No toast (brief's own ruling): the row just shows the new name, nothing else appears.
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('Cancel reverts the typed text and closes without saving', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    const field = screen.getByDisplayValue('Suzuki Piano Book 2');
    await user.clear(field);
    await user.type(field, 'Something else entirely');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(renameCollection).not.toHaveBeenCalled();
    expect(screen.getByText('Suzuki Piano Book 2')).toBeInTheDocument();
    expect(screen.queryByText('Something else entirely')).not.toBeInTheDocument();
    // Reopening starts from the saved name again, not the discarded typing.
    await user.click(screen.getByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    expect(screen.getByDisplayValue('Suzuki Piano Book 2')).toBeInTheDocument();
  });

  it('Save stays disabled for a blank name — near-miss for "saves anything"', async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    const field = screen.getByDisplayValue('Suzuki Piano Book 2');
    await user.clear(field);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(renameCollection).not.toHaveBeenCalled();
  });

  /** A duplicate name is the server's own sentence, naming the spelling already on file — the same
   *  contract the item picker's "Add a collection…" shows. The field stays OPEN on a refusal,
   *  holding what they typed, so the fix is one edit away rather than starting over. */
  it("a rename conflict shows the server's own sentence and leaves the field open", async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    renameCollection.mockResolvedValue({
      ok: false,
      fault: 'You already have a collection called "Shotokan kata syllabus".',
    });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Rename Suzuki Piano Book 2' }));
    const field = screen.getByDisplayValue('Suzuki Piano Book 2');
    await user.clear(field);
    await user.type(field, 'Shotokan kata syllabus');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('You already have a collection called "Shotokan kata syllabus".'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shotokan kata syllabus')).toBeInTheDocument();
  });
});

describe('Remove', () => {
  it('asks before it removes, naming the consequence, and does nothing on Cancel', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Remove Suzuki Piano Book 2' }));
    expect(window.confirm).toHaveBeenCalledWith(REMOVE_COLLECTION_CONFIRM);
    expect(removeCollection).not.toHaveBeenCalled();
    expect(screen.getByText('Suzuki Piano Book 2')).toBeInTheDocument();
  });

  it('removes it once confirmed, refreshes the list, and reports the change upward', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    getCollections.mockResolvedValueOnce({ ok: true, collections: [collection()] });
    removeCollection.mockResolvedValue({ ok: true });
    getCollections.mockResolvedValueOnce({ ok: true, collections: [] });
    const onChanged = vi.fn();
    render(<CollectionsScreen onBack={() => {}} onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Remove Suzuki Piano Book 2' }));
    expect(removeCollection).toHaveBeenCalledWith('c-1');
    expect(await screen.findByText(COLLECTIONS_EMPTY)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  /** A remove that failed must not look like a remove that happened — the row has to stay, with
   *  the fault said in place, or the person would believe a collection is gone when it is not. */
  it('a fault leaves the row in place and says so, rather than looking like it went', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    getCollections.mockResolvedValue({ ok: true, collections: [collection()] });
    removeCollection.mockResolvedValue({ ok: false, fault: 'a fault on our side' });
    render(<CollectionsScreen onBack={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Remove Suzuki Piano Book 2' }));
    expect(await screen.findByText('a fault on our side')).toBeInTheDocument();
    expect(screen.getByText('Suzuki Piano Book 2')).toBeInTheDocument();
  });
});
