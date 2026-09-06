/**
 * The forecast's labels, tabled — each one decides what a row SAYS, and a wrong one fails on
 * screen without a throw: "Tomorrow" over today's row, or an hour written in the device's zone
 * for a forecast cut in another.
 */
import { dayLabel, horizonLine, hourLabel, localDateIn, localHourIn, precipLabel } from './forecastCopy.ts';

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
    ['2026-08-31', 'Mon 31'], // a month boundary crossed inside the fortnight
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

describe('the horizon line', () => {
  it('says nothing when the tab is full', () => {
    expect(horizonLine(7, 7)).toBeNull();
    expect(horizonLine(14, 14)).toBeNull();
  });

  it('says how far she got when the provider stops short of the tab', () => {
    expect(horizonLine(10, 14)).toBe("That's as far ahead as I can see — 10 days.");
    expect(horizonLine(5, 7)).toBe("That's as far ahead as I can see — 5 days.");
    expect(horizonLine(1, 7)).toBe("That's as far ahead as I can see — 1 day.");
  });
});
