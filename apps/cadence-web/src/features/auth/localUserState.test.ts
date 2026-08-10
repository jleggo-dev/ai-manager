import { syncLocalStateToUser, USER_SCOPED_KEYS } from './localUserState.ts';

const seed = () => USER_SCOPED_KEYS.forEach((k) => window.localStorage.setItem(k, 'from-the-last-person'));
const survivors = () => USER_SCOPED_KEYS.filter((k) => window.localStorage.getItem(k) !== null);

beforeEach(() => window.localStorage.clear());

/**
 * Reported by the owner after restarting onboarding: an Apple Health offer dismissed by a previous
 * anonymous identity was still suppressing the card for a brand-new one. *"There's no way of
 * knowing I'm the same user, is there?"* — there isn't, and inheriting their answers is the app
 * claiming to recognise someone it cannot.
 */
describe('syncLocalStateToUser', () => {
  it('adopts the current user on a first run without wiping anything', () => {
    seed();
    expect(syncLocalStateToUser('user-a')).toBe(false);
    expect(survivors()).toEqual([...USER_SCOPED_KEYS]);
  });

  it('clears the previous person’s answers when the identity changes', () => {
    syncLocalStateToUser('user-a');
    seed();

    expect(syncLocalStateToUser('user-b')).toBe(true);
    expect(survivors()).toEqual([]);
  });

  it('leaves state alone when the same person returns', () => {
    syncLocalStateToUser('user-a');
    seed();

    expect(syncLocalStateToUser('user-a')).toBe(false);
    expect(survivors()).toEqual([...USER_SCOPED_KEYS]);
  });

  /** Signing out is not a new person — they may well sign straight back in as themselves. */
  it('does nothing on sign-out', () => {
    syncLocalStateToUser('user-a');
    seed();

    expect(syncLocalStateToUser(null)).toBe(false);
    expect(survivors()).toEqual([...USER_SCOPED_KEYS]);
  });

  it('clears across a start-over: sign out, then a NEW anonymous identity', () => {
    syncLocalStateToUser('anon-1');
    window.localStorage.setItem('cadence.healthOffer', 'dismissed');

    syncLocalStateToUser(null); // "Start over" signs the anonymous session out
    syncLocalStateToUser('anon-2'); // and a fresh one is minted

    expect(window.localStorage.getItem('cadence.healthOffer')).toBeNull();
  });

  /** The roster is a fact about the PHONE — wiping it would defeat "welcome back". */
  it('never touches device-scoped state', () => {
    syncLocalStateToUser('user-a');
    window.localStorage.setItem('cadence.deviceAccounts', '[{"userId":"user-a"}]');
    window.localStorage.setItem('cadence.devAccount', 'account-1');

    syncLocalStateToUser('user-b');

    expect(window.localStorage.getItem('cadence.deviceAccounts')).not.toBeNull();
    expect(window.localStorage.getItem('cadence.devAccount')).toBe('account-1');
  });
});
