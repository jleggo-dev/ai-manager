/**
 * The failure this producer must not have is a confident sentence about weather nobody checked.
 * So the cases here are mostly about REFUSING to send: no drier slot, no forecast, an indoor
 * session, a session that already started.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidates = vi.fn();
const getSlots = vi.fn();

vi.mock('../../../repos/notify-candidates.ts', () => ({
  listWeatherMoveCandidates: (...a: unknown[]) => listCandidates(...a),
}));
// Mocked WHOLE, with no importOriginal: the real module reaches weather-http, which loads config
// and demands a database URL. The slot predicates the producer also uses are pure and live in
// forecast-slots.ts, so they stay real.
vi.mock('../../weather/forecast.ts', () => ({ getForecastSlots: (...a: unknown[]) => getSlots(...a) }));

const { weatherMoveProducer } = await import('./weather-move.ts');

const row = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'Europe/London',
  home_location: { lat: 51.5, lon: -0.1 },
  occurrence_id: 'occ-1',
  date: '2026-08-11',
  title: 'Easy run',
  category: 'cardio',
  time_of_day: '18:00',
  ...over,
});

/** London slots for the 11th: wet at 18:00, clear at 12:00. */
const slot = (iso: string, conditions: string, precipChance: number, tempC = 18) => ({
  at: new Date(iso),
  conditions,
  precipChance,
  tempC,
});
const SLOTS = [
  slot('2026-08-11T08:00:00Z', 'clear sky', 0.05, 15), // 09:00 local
  slot('2026-08-11T11:00:00Z', 'clear sky', 0.05, 18), // 12:00 local — the alternative
  slot('2026-08-11T17:00:00Z', 'light rain', 0.8, 14), // 18:00 local — the conflict
];

/** 19:00 London on the 10th — the session is 22 hours out, inside the horizon. */
const NOW = new Date('2026-08-10T18:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  listCandidates.mockResolvedValue([row()]);
  getSlots.mockResolvedValue(SLOTS);
});

describe('weather_move — when it speaks', () => {
  it('names the conflict, the alternative, and the numbers behind it', async () => {
    const [req] = await weatherMoveProducer.produce(NOW);
    expect(req).toMatchObject({ userId: 'u1', kind: 'weather_move', target: 'occ-1' });
    expect(req?.title).toBe('Rain at 18 tomorrow');
    expect(req?.body).toContain('lunch');
    expect(req?.body).toContain('18 degrees'); // from the alternative slot, not the session's
    expect(req?.body.trim().endsWith('?')).toBe(true);
  });

  it('uses the user’s own words for the session', async () => {
    const [req] = await weatherMoveProducer.produce(NOW);
    expect(req?.body).toContain('Easy run');
  });

  it('passes no judgment — it never suggests going anyway or skipping', async () => {
    const [req] = await weatherMoveProducer.produce(NOW);
    expect(`${req?.title} ${req?.body}`).not.toMatch(/\b(anyway|tough|skip|excuse|brave|no such thing as bad)\b/i);
  });
});

describe('weather_move — when it stays quiet', () => {
  it('says nothing when there is no drier slot to offer', async () => {
    getSlots.mockResolvedValue([SLOTS[2]]); // the wet slot alone
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('says nothing when the forecast is unavailable — no invented weather, ever', async () => {
    getSlots.mockResolvedValue([]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('says nothing when the session’s own slot is fine', async () => {
    getSlots.mockResolvedValue([SLOTS[0], SLOTS[1], slot('2026-08-11T17:00:00Z', 'clear sky', 0.05, 20)]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('ignores indoor sessions', async () => {
    listCandidates.mockResolvedValue([row({ title: 'Bench press', category: 'strength' })]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
    expect(getSlots).not.toHaveBeenCalled();
  });

  it('ignores a session that has already started, and one beyond the 24-hour horizon', async () => {
    expect(await weatherMoveProducer.produce(new Date('2026-08-11T18:00:00Z'))).toEqual([]);
    expect(await weatherMoveProducer.produce(new Date('2026-08-09T16:00:00Z'))).toEqual([]);
  });

  it('will not move a session to a different day — that is a replan, not a nudge', async () => {
    getSlots.mockResolvedValue([SLOTS[2], slot('2026-08-12T11:00:00Z', 'clear sky', 0.05, 22)]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('will not offer a slot within two hours of the original — that is the same session', async () => {
    getSlots.mockResolvedValue([SLOTS[2], slot('2026-08-11T16:00:00Z', 'clear sky', 0.05, 19)]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('holds without a timezone or a home location', async () => {
    listCandidates.mockResolvedValue([row({ timezone: null })]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
    listCandidates.mockResolvedValue([row({ home_location: null })]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });

  it('holds when the session has no parseable time', async () => {
    listCandidates.mockResolvedValue([row({ time_of_day: 'evening' })]);
    expect(await weatherMoveProducer.produce(NOW)).toEqual([]);
  });
});
