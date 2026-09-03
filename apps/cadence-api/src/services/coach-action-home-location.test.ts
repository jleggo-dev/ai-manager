import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `set_home_location` against faked geocoding + a faked user row. The repo and weather seams are
 * mocked, not the DB: what these tests pin is the tool's contract — a geocode miss rejects
 * plainly and writes nothing, a hit writes and reads back its own write before claiming success,
 * an existing timezone is preserved rather than blanked, and a write that does not take is never
 * reported as done.
 */
const store = vi.hoisted(() => {
  const state: {
    user: { timezone: string | null; home_location: { lat: number; lon: number; label?: string } | null };
  } = {
    user: { timezone: null, home_location: null },
  };
  return {
    state,
    getUser: vi.fn(async () => ({ ...state.user })),
    setHomeLocation: vi.fn(
      async (_uid: string, location: { lat: number; lon: number; label?: string }, timezone: string | null) => {
        state.user.home_location = location;
        state.user.timezone = timezone;
      },
    ),
  };
});

const geocodeCity = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: store.getUser,
  setHomeLocation: store.setHomeLocation,
}));

vi.mock('./weather/weather.ts', () => ({
  geocodeCity: (...a: unknown[]) => geocodeCity(...a),
}));

import { SET_HOME_LOCATION } from './coach-action-home-location.ts';

beforeEach(() => {
  store.state.user = { timezone: null, home_location: null };
  vi.clearAllMocks();
});

describe('set_home_location', () => {
  it('rejects plainly and writes nothing when no place is given', async () => {
    const out = await SET_HOME_LOCATION.run('u1', { place: '  ' });
    expect(out).toContain('No place was given');
    expect(geocodeCity).not.toHaveBeenCalled();
    expect(store.setHomeLocation).not.toHaveBeenCalled();
  });

  it('rejects plainly when the place cannot be geocoded, and writes nothing', async () => {
    geocodeCity.mockResolvedValue(null);

    const out = await SET_HOME_LOCATION.run('u1', { place: 'Nowhereville' });

    expect(out).toBe('"Nowhereville" could not be found; nothing was changed.');
    expect(store.setHomeLocation).not.toHaveBeenCalled();
  });

  it('geocodes, writes, and verifies with a fresh read on a hit', async () => {
    geocodeCity.mockResolvedValue({ lat: 39.7392, lon: -104.9903, label: 'Denver, CO, US' });

    const out = await SET_HOME_LOCATION.run('u1', { place: 'Denver' });

    expect(geocodeCity).toHaveBeenCalledWith('Denver');
    expect(store.setHomeLocation).toHaveBeenCalledWith(
      'u1',
      { lat: 39.7392, lon: -104.9903, label: 'Denver, CO, US' },
      null,
    );
    expect(out).toContain('Home location set to Denver, CO, US (39.7392, -104.9903)');
    expect(out).toContain('Weather and daylight for outdoor sessions are read from here from now on.');
    // Facts only — never tells her what to say next or how.
    expect(out).not.toMatch(/warmly|say it back|in one line/i);
  });

  it('preserves an existing timezone instead of blanking it', async () => {
    store.state.user.timezone = 'America/Denver';
    geocodeCity.mockResolvedValue({ lat: 39.7392, lon: -104.9903, label: 'Denver, CO, US' });

    await SET_HOME_LOCATION.run('u1', { place: 'Denver' });

    expect(store.setHomeLocation).toHaveBeenCalledWith(
      'u1',
      { lat: 39.7392, lon: -104.9903, label: 'Denver, CO, US' },
      'America/Denver',
    );
  });

  it('reports a write that did not take instead of claiming success', async () => {
    geocodeCity.mockResolvedValue({ lat: 1, lon: 2, label: 'Somewhere' });
    // The write "succeeds" but the read-back sees stale state — simulating a failed persist.
    store.setHomeLocation.mockImplementationOnce(async () => {
      /* no-op: home_location on the user row never actually changes */
    });

    const out = await SET_HOME_LOCATION.run('u1', { place: 'Somewhere' });

    expect(out).toContain('did NOT get set');
    expect(out).not.toMatch(/^Home location set to/i);
  });
});
