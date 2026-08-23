/**
 * The gates that decide when the header is allowed to say a different city (A21).
 *
 * The geography is the owner's own, because it is what broke: he lives in Notre-Dame-de-l'Île-
 * Perrot and works downtown, 30.4 km away, and the old check only moved past 50 km — so it ran
 * every morning, measured correctly, and did nothing. The interesting cases here are the two that
 * pull in opposite directions: a commute has to register, and the four legs of that same commute
 * must not each buy a new name.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decidePlace,
  forgetCandidate,
  loadCandidate,
  loadLastSavedMs,
  markSaved,
  rememberCandidate,
  haversineKm,
  DWELL_MS,
  SAVE_FLOOR_MS,
  type Candidate,
} from './placeDwell.ts';

const HOME = { lat: 45.4, lon: -73.9 }; // Notre-Dame-de-l'Île-Perrot
const DOWNTOWN = { lat: 45.5, lon: -73.57 }; // where he actually is, most days
const DORVAL = { lat: 45.45, lon: -73.75 }; // a leg of the drive in
const LACHINE = { lat: 45.44, lon: -73.68 }; // the next one
const JITTER = { lat: 45.41, lon: -73.91 }; // 2 d.p. rounding wobble, ~1.3 km

const T0 = 1_760_000_000_000; // a fixed clock; nothing here reads the real one
const base = { home: HOME, current: null, candidate: null, lastSavedMs: null };

describe('the yardstick', () => {
  it('measures the commute that the old 50 km bar threw away', () => {
    expect(haversineKm(HOME, DOWNTOWN)).toBeGreaterThan(25);
    expect(haversineKm(HOME, DOWNTOWN)).toBeLessThan(50);
    // ...and the wobble it was set that high to reject is a rounding artefact, not a journey.
    expect(haversineKm(HOME, JITTER)).toBeLessThan(2);
  });
});

describe('deciding whether the header may move', () => {
  it('holds the first sighting of somewhere new rather than committing to it', () => {
    const d = decidePlace({ ...base, reading: DOWNTOWN, nowMs: T0 });
    expect(d.kind).toBe('hold');
    if (d.kind === 'hold') expect(d.candidate.firstSeenMs).toBe(T0);
  });

  it('commits once the place has kept you twenty minutes', () => {
    const candidate: Candidate = { ...DOWNTOWN, firstSeenMs: T0 };
    const d = decidePlace({ ...base, reading: DOWNTOWN, candidate, nowMs: T0 + DWELL_MS + 1 });
    expect(d.kind).toBe('commit');
  });

  it('never settles on a moving train: every leg restarts the clock', () => {
    let candidate: Candidate | null = null;
    // Three app opens on the way in, ten minutes apart — each one somewhere else than the last.
    for (const [i, leg] of [DORVAL, LACHINE, DOWNTOWN].entries()) {
      const d = decidePlace({ ...base, reading: leg, candidate, nowMs: T0 + i * 10 * 60_000 });
      expect(d.kind).toBe('hold');
      candidate = d.kind === 'hold' ? d.candidate : null;
      expect(candidate?.firstSeenMs).toBe(T0 + i * 10 * 60_000); // the clock starts over each leg
    }
  });

  it('keeps the clock with the place, not with the mount', () => {
    const candidate: Candidate = { ...DOWNTOWN, firstSeenMs: T0 };
    // Same building, a few hundred metres of drift, five minutes later: still waiting, and still
    // waiting from T0 — otherwise checking the app often would postpone the move forever.
    const d = decidePlace({
      ...base,
      reading: { lat: DOWNTOWN.lat + 0.003, lon: DOWNTOWN.lon },
      candidate,
      nowMs: T0 + 5 * 60_000,
    });
    expect(d.kind).toBe('hold');
    if (d.kind === 'hold') expect(d.candidate.firstSeenMs).toBe(T0);
  });

  it('treats coarse-rounding wobble at home as staying put', () => {
    expect(decidePlace({ ...base, reading: JITTER, nowMs: T0 }).kind).toBe('stay');
  });

  it('drops the transient the moment you are home again — no dwell, no geocode', () => {
    const d = decidePlace({ ...base, current: DOWNTOWN, reading: HOME, nowMs: T0 });
    expect(d.kind).toBe('home');
  });

  it('says nothing when you are still where the header already points', () => {
    const d = decidePlace({ ...base, current: DOWNTOWN, reading: DOWNTOWN, nowMs: T0 });
    expect(d.kind).toBe('stay');
  });

  it('holds a dwelt place that is inside the save floor, and commits it once the floor passes', () => {
    const candidate: Candidate = { ...DOWNTOWN, firstSeenMs: T0 };
    const dwelt = { ...base, reading: DOWNTOWN, candidate };

    const tooSoon = decidePlace({ ...dwelt, lastSavedMs: T0, nowMs: T0 + DWELL_MS + 1 });
    expect(tooSoon.kind).toBe('hold'); // 20 minutes of dwell, but only 20 minutes since the save
    if (tooSoon.kind === 'hold') expect(tooSoon.candidate.firstSeenMs).toBe(T0); // and it is not forgotten

    const later = decidePlace({ ...dwelt, lastSavedMs: T0, nowMs: T0 + SAVE_FLOOR_MS + 1 });
    expect(later.kind).toBe('commit');
  });

  it('commits the freshest reading, not the candidate’s first fix', () => {
    const candidate: Candidate = { ...DOWNTOWN, firstSeenMs: T0 };
    const moved = { lat: DOWNTOWN.lat + 0.008, lon: DOWNTOWN.lon }; // ~0.9 km, same place
    const d = decidePlace({ ...base, reading: moved, candidate, nowMs: T0 + DWELL_MS + 1 });
    expect(d).toEqual({ kind: 'commit', point: moved });
  });

  it('leaves first-run alone when nothing is stored at all', () => {
    const d = decidePlace({ ...base, home: null, reading: DOWNTOWN, nowMs: T0 });
    expect(d.kind).toBe('stay'); // the auto-detect path owns this case, and it sets HOME
  });
});

describe('what the phone remembers between mounts', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a candidate and forgets it on request', () => {
    rememberCandidate({ ...DOWNTOWN, firstSeenMs: T0 });
    expect(loadCandidate()).toEqual({ ...DOWNTOWN, firstSeenMs: T0 });
    forgetCandidate();
    expect(loadCandidate()).toBeNull();
  });

  it('refuses a half-written candidate rather than measuring against nonsense', () => {
    localStorage.setItem('cadence.place.candidate', '{"lat":45.5}');
    expect(loadCandidate()).toBeNull();
    localStorage.setItem('cadence.place.candidate', 'not json');
    expect(loadCandidate()).toBeNull();
  });

  it('remembers when it last paid for a name', () => {
    expect(loadLastSavedMs()).toBeNull();
    markSaved(T0);
    expect(loadLastSavedMs()).toBe(T0);
  });
});
