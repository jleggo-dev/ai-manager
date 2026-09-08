/**
 * The forecast's labels, tabled — each one decides what a row SAYS, and a wrong one fails on
 * screen without a throw: "Tomorrow" over today's row, or an hour written in the device's zone
 * for a forecast cut in another.
 */
import { dayLabel, forecastTabs, hourLabel, localDateIn, localHourIn, precipLabel } from './forecastCopy.ts';

/** A local Date at a given wall-clock hour, whatever the test machine's zone is. */
const at = (hour: number) => new Date(2026, 7, 18, hour, 0);
const iso = (hour: number) => at(hour).toISOString();

describe('the hour on the strip', () => {
  const now = at(13);

  it.each([
    [iso(13), '24h', 'Now'], // the hour in progress
    [iso(14), '24h', '14:00'],
    [iso(0 + 24), '24h', '00:00'], // midnight, tomorrow
    [iso(14), '12h', '2 pm'],
    [iso(12 + 12), '12h', '12 am'],
    [iso(12 + 24), '12h', '12 pm'],
    [iso(9 + 24), '12h', '9 am'],
  ] as const)('%s on a %s clock reads %s', (when, clock, label) => {
    expect(hourLabel(when, null, clock, now)).toBe(label);
  });

  it('writes the hour in the forecast’s zone, not the device’s', () => {
    // 16:00Z is noon in Toronto and 5 pm in London, whatever this machine thinks.
    const noonToronto = '2026-08-18T16:00:00Z';
    const now = new Date('2026-08-18T10:00:00Z');
    expect(hourLabel(noonToronto, 'America/Toronto', '24h', now)).toBe('12:00');
    expect(hourLabel(noonToronto, 'Europe/London', '12h', now)).toBe('5 pm');
    expect(localHourIn(new Date(noonToronto), 'America/Toronto')).toBe(12);
  });

  it('falls back to the device’s zone for one it cannot use', () => {
    expect(() => hourLabel(iso(14), 'Not/AZone', '24h', at(13))).not.toThrow();
    expect(localDateIn(at(13), 'Not/AZone')).toBe('2026-08-18');
  });
});

describe('the day in the list', () => {
  it.each([
    ['2026-08-18', 'Today'],
    ['2026-08-19', 'Tomorrow'],
    ['2026-08-20', 'Thu 20'],
    ['2026-08-31', 'Mon 31'], // a month boundary crossed inside the ten days
    ['2026-09-01', 'Tue 1'],
  ])('%s reads %s when today is the 18th', (date, label) => {
    expect(dayLabel(date, '2026-08-18')).toBe(label);
  });

  it('rolls "Tomorrow" over a month end', () => {
    expect(dayLabel('2026-09-01', '2026-08-31')).toBe('Tomorrow');
  });

  it('cuts the date in the forecast’s zone', () => {
    // 03:00Z on the 19th is still the evening of the 18th in Toronto.
    expect(localDateIn(new Date('2026-08-19T03:00:00Z'), 'America/Toronto')).toBe('2026-08-18');
    expect(localDateIn(new Date('2026-08-19T03:00:00Z'), 'Europe/London')).toBe('2026-08-19');
  });
});

describe('the chance of rain', () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, null],
    [0.19, null], // below one in five the row says nothing
    [0.2, '20%'],
    [0.55, '55%'],
    [1, '100%'],
  ])('%s → %s', (chance, label) => {
    expect(precipLabel(chance)).toBe(label);
  });
});

/**
 * The tabs are a router: the count decides whether a days tab exists and what it promises, and a
 * tab that promises more than the list under it (the old "14 days" over Apple's ten) fails on
 * screen without a throw. Owner, 2026-09-07: if we can't show it, don't offer it.
 */
describe('the forecast tabs', () => {
  it.each([
    [10, '10 days', 10], // Apple sees ten
    [7, '7 days', 7],
    [5, '5 days', 5], // OpenWeatherMap's five
    [1, '1 day', 1], // singular, never "1 days"
    [14, '10 days', 10], // more than Apple's ten is never promised — nobody forecasts fourteen
    [12.7, '10 days', 10],
    [3.9, '3 days', 3], // never a fraction of a row
  ])('%s days → a "%s" tab promising %s', (count, label, promised) => {
    const tabs = forecastTabs(count);
    expect(tabs.map((t) => t.id)).toEqual(['hourly', 'days']);
    expect(tabs[0]).toEqual({ id: 'hourly', label: 'Hourly' });
    expect(tabs[1]).toEqual({ id: 'days', label, days: promised });
  });

  it.each([[0], [-1], [Number.NaN]])('%s days → hourly only, no days tab to disappoint', (count) => {
    expect(forecastTabs(count)).toEqual([{ id: 'hourly', label: 'Hourly' }]);
  });

  it('never offers the fourteen days it used to', () => {
    for (const count of [7, 10, 14, 30]) {
      expect(forecastTabs(count).map((t) => t.label)).not.toContain('14 days');
    }
  });
});
