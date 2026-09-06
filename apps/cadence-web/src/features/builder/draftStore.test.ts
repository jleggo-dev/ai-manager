/**
 * The held draft — what makes minimize lossless across a force-quit.
 *
 * Every refusal here is load-bearing. The stamps are the boot snapshot's (lib/query/boot-cache.ts)
 * for the same reasons: a wrong VERSION must be ignored rather than half-read, a wrong OWNER must
 * never hand one account's half-built activity to the next person on the phone, and a stale one
 * must stop presenting itself as unfinished business. And the store has to survive a device where
 * localStorage throws, because a launch that crashes on a disabled store is worse than a launch
 * with no draft.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const persisted = vi.hoisted(() => ({ session: null as { user?: { id?: string } } | null }));
const dev = vi.hoisted(() => ({ on: false, account: 'account-1' }));

vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => persisted.session }));
vi.mock('../../lib/api/http.ts', () => ({
  isDevMode: () => dev.on,
  getDevAccount: () => dev.account,
}));

const { BUILDER_DRAFT_KEY, BUILDER_DRAFT_VERSION, readDraft, writeDraft, clearDraft } = await import('./draftStore.ts');
import type { BuilderDraft } from './draftStore.ts';

const DRAFT: BuilderDraft = {
  phase: 'builder',
  family: 'practice',
  cards: [{ id: 'c1', block: { label: 'Practice', items: [{ name: 'Scales', duration_min: 10 }] } }],
  name: 'Piano — mine',
};

beforeEach(() => {
  window.localStorage.clear();
  persisted.session = null;
  dev.on = false;
});
afterEach(() => vi.restoreAllMocks());

/** Write a stored envelope by hand, to drive the refusals a normal write can't produce. */
function seed(patch: Record<string, unknown>) {
  window.localStorage.setItem(
    BUILDER_DRAFT_KEY,
    JSON.stringify({ ...DRAFT, v: BUILDER_DRAFT_VERSION, owner: null, at: Date.now(), ...patch }),
  );
}

describe('draftStore — holding a draft', () => {
  it('round-trips a draft, steps and all', () => {
    writeDraft(DRAFT);

    expect(readDraft()).toEqual(DRAFT);
  });

  it('an empty draft is not worth holding — it clears instead', () => {
    writeDraft(DRAFT);

    // Deleting the last step and the name is how someone empties a draft; the pill must not then
    // offer a blank activity back.
    writeDraft({ ...DRAFT, cards: [], name: '   ' });

    expect(readDraft()).toBeNull();
    expect(window.localStorage.getItem(BUILDER_DRAFT_KEY)).toBeNull();
  });

  it('a name alone is worth holding — someone who typed one has started', () => {
    writeDraft({ ...DRAFT, cards: [], name: 'Hotel HIIT' });

    expect(readDraft()?.name).toBe('Hotel HIIT');
  });

  it('clearDraft forgets it', () => {
    writeDraft(DRAFT);

    clearDraft();

    expect(readDraft()).toBeNull();
  });
});

describe('draftStore — every reason to refuse a stored draft', () => {
  it.each([
    ['an older version', { v: BUILDER_DRAFT_VERSION - 1 }],
    ['a draft older than two weeks', { at: Date.now() - 15 * 24 * 60 * 60 * 1000 }],
    ['a missing timestamp', { at: undefined }],
    ['somebody else', { owner: 'another-user-id' }],
    ['a shape with no cards array', { cards: 'not an array' }],
  ])('refuses %s', (_label, patch) => {
    seed(patch);

    expect(readDraft()).toBeNull();
  });

  it('refuses unreadable JSON rather than throwing on launch', () => {
    window.localStorage.setItem(BUILDER_DRAFT_KEY, '{ not json');

    expect(readDraft()).toBeNull();
  });

  it('reads nothing when nothing was ever written', () => {
    expect(readDraft()).toBeNull();
  });

  // Near-miss: a draft that is only just inside every bound still reads. Without this, a bug that
  // refused EVERYTHING would pass the whole table above.
  it('accepts a draft just inside the age bound, owned by the current session', () => {
    persisted.session = { user: { id: 'me' } };
    seed({ owner: 'me', at: Date.now() - 13 * 24 * 60 * 60 * 1000 });

    expect(readDraft()?.name).toBe('Piano — mine');
  });
});

describe('draftStore — whose draft it is', () => {
  it('a signed-in person gets their own back, and not the previous account holder’s', () => {
    persisted.session = { user: { id: 'user-a' } };
    writeDraft(DRAFT);

    persisted.session = { user: { id: 'user-b' } };

    expect(readDraft()).toBeNull();
  });

  it('in dev mode the account slug IS the identity — account 2 never opens account 1’s draft', () => {
    dev.on = true;
    dev.account = 'account-1';
    writeDraft(DRAFT);
    expect(readDraft()).not.toBeNull();

    dev.account = 'account-2';

    expect(readDraft()).toBeNull();
  });
});

describe('draftStore — a device where storage does not work', () => {
  it('a write that throws is swallowed: the session keeps working, only the promise is lost', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeDraft(DRAFT)).not.toThrow();
  });

  it('a read that throws is "nothing remembered", never a crash on launch', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(readDraft()).toBeNull();
  });

  it('a clear that throws is swallowed too', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => clearDraft()).not.toThrow();
  });
});
