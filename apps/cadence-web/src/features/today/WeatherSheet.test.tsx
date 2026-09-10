/**
 * The weather sheet, on its own: what each tab draws, and that the days tab is named for what is
 * under it — never more. The header's side — that the forecast is read before the tap — is pinned
 * in TrailHeader.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { WeatherSheet } from './WeatherSheet.tsx';
import type { Forecast } from '../../lib/api.ts';

/** A local Date at a given wall-clock hour, whatever the test machine's zone is. */
const at = (hour: number) => new Date(2026, 7, 18, hour, 0);
const NOW = at(13);

const CLEAR = {
  available: true,
  temp_c: 19,
  conditions: 'clear',
  label: 'Montreal',
  precip_chance: 0.1,
  attribution: null,
};

const APPLE = { name: 'Apple Weather', url: 'https://weather-data.apple.com/legal-attribution.html' };

/** Ten days from Apple and a day of hours, starting on the hour in progress. */
function forecast(days = 10, hours = 24): Forecast {
  return {
    available: true,
    timezone: null, // the device's zone, so the labels below are deterministic
    source: 'weatherkit',
    attribution: APPLE,
    hourly: Array.from({ length: hours }, (_, i) => ({
      at: new Date(NOW.getTime() + i * 3600_000).toISOString(),
      temp_c: 19 - i,
      conditions: i < 4 ? 'clear' : 'rain',
      precip_chance: i === 4 ? 0.65 : 0.05,
    })),
    daily: Array.from({ length: days }, (_, i) => ({
      date: `2026-08-${String(18 + i).padStart(2, '0')}`,
      high_c: 25 - i,
      low_c: 14 - i,
      conditions: i === 2 ? 'heavy rain' : 'mostly clear',
      precip_chance: i === 2 ? 0.8 : 0.05,
    })),
  };
}

function open(props: Partial<Parameters<typeof WeatherSheet>[0]> = {}) {
  return render(
    <WeatherSheet
      weather={CLEAR}
      city="Montreal"
      night={false}
      forecast={forecast()}
      clock="24h"
      now={NOW}
      onClose={() => {}}
      {...props}
    />,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('the sheet opens on the forecast', () => {
  it('leads with the reading, then the two ranges, on the hourly strip', () => {
    const { container } = open();
    expect(container.querySelector('.wxsheet-now')!.textContent).toContain('Clear · 19°');
    expect(screen.getByRole('tablist', { name: 'Forecast range' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(tab('Hourly').getAttribute('aria-selected')).toBe('true');
    expect(tab('10 days').getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByRole('tab', { name: /14 days/ })).toBeNull(); // nobody forecasts fourteen
    expect(container.querySelectorAll('.wxsheet-hour')).toHaveLength(24);
  });

  it('labels the hour in progress Now, the rest on the clock, and the wet hour with its odds', () => {
    const { container } = open();
    const hours = container.querySelectorAll('.wxsheet-hour');
    expect(hours[0]!.querySelector('.wxsheet-at')!.textContent).toBe('Now');
    expect(hours[1]!.querySelector('.wxsheet-at')!.textContent).toBe('14:00');
    expect(hours[1]!.querySelector('.wxsheet-temp')!.textContent).toBe('18°');
    expect(hours[4]!.querySelector('.wxsheet-precip')!.textContent).toBe('65%');
    expect(hours[1]!.querySelector('.wxsheet-precip')!.textContent).toBe(''); // one in twenty says nothing
    expect(hours[4]!.querySelector('.wxsheet-icon')!.textContent).toBe('🌧️');
  });

  it('writes the strip in the clock the person chose', () => {
    const { container } = open({ clock: '12h' });
    expect(container.querySelectorAll('.wxsheet-at')[1]!.textContent).toBe('2 pm');
  });
});

describe('the days ahead', () => {
  it('shows all ten of Apple’s days on a tab that says ten, from Today', () => {
    const { container } = open();
    fireEvent.click(tab('10 days'));
    expect(tab('10 days').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: '10 days' })).toBeTruthy();
    const rows = container.querySelectorAll('.wxsheet-day');
    expect(rows).toHaveLength(10);
    expect(rows[0]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Today');
    expect(rows[1]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Tomorrow');
    expect(rows[2]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Thu 20');
    expect(rows[2]!.querySelector('.wxsheet-day-cond')!.textContent).toBe('Heavy rain');
    expect(rows[2]!.querySelector('.wxsheet-day-precip')!.textContent).toBe('80%');
    expect(rows[0]!.querySelector('.wxsheet-day-range')!.textContent).toBe('14° 25°');
    expect(container.querySelector('.wxsheet-horizon')).toBeNull(); // nothing to apologise for
    expect(container.querySelector('.wxsheet-hours')).toBeNull();
  });

  /** The tab is a router over the count — the table for the label itself is in forecastCopy.test.ts. */
  it.each([
    [7, '7 days'],
    [5, '5 days'], // OpenWeatherMap
    [1, '1 day'],
    [14, '10 days'], // more than Apple's ten is never promised
  ])('%s days from the provider is a "%s" tab with exactly that many rows', (days, label) => {
    const { container } = open({ forecast: forecast(days) });
    fireEvent.click(tab(label));
    expect(container.querySelectorAll('.wxsheet-day')).toHaveLength(Math.min(days, 10));
    expect(container.querySelector('.wxsheet-horizon')).toBeNull();
  });

  it('never pads a short series — five days from OpenWeatherMap is five rows and a five-day tab', () => {
    const { container } = open({ forecast: { ...forecast(5, 8), source: 'openweathermap', attribution: null } });
    expect(screen.queryByRole('tab', { name: '7 days' })).toBeNull();
    fireEvent.click(tab('5 days'));
    expect(container.querySelectorAll('.wxsheet-day')).toHaveLength(5);
    fireEvent.click(tab('Hourly'));
    expect(container.querySelectorAll('.wxsheet-hour')).toHaveLength(8); // three-hourly slots, as given
  });

  it('offers no days tab — and nothing to switch between — when the provider gave only hours', () => {
    const { container } = open({ forecast: forecast(0, 12) });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab', { name: /days?$/ })).toBeNull();
    expect(container.querySelectorAll('.wxsheet-hour')).toHaveLength(12);
    expect(container.querySelector('.wxsheet-day')).toBeNull();
  });
});

describe('when there is less to show', () => {
  it('says it is still reading while the forecast is on its way, with no tabs', () => {
    const { container } = open({ forecast: undefined });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.textContent).toContain('Reading the days ahead');
    expect(container.querySelector('.wxsheet-coach')!.textContent).toBe(
      'Clear and 19° right now — dry for the next few hours.',
    );
  });

  it('shows the reading alone when there is no forecast at all — never a made-up week', () => {
    const { container } = open({ forecast: { available: false } });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.textContent).not.toContain('Reading the days ahead');
    expect(container.querySelector('.wxsheet-day')).toBeNull();
    expect(container.querySelector('.wxsheet-hour')).toBeNull();
  });

  /**
   * A read that failed is not "no forecast", and it used to be drawn as one: the reading alone,
   * no line, no door, for the rest of the hour — which on the owner's phone read as the forecast
   * having been reverted (2026-09-09). The coach says so now, and Try again asks.
   */
  it('says the read failed and offers Try again — distinct from there being nothing to read', () => {
    const onRetry = vi.fn();
    const { container } = open({ forecast: { available: false, error: true }, onRetry });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.textContent).toContain('I couldn’t read the days ahead.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the failed line but no door when nobody can be asked', () => {
    const { container } = open({ forecast: { available: false, error: true } });
    expect(container.textContent).toContain('I couldn’t read the days ahead.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('never says the read failed when the server simply has no forecast', () => {
    const { container } = open({ forecast: { available: false }, onRetry: vi.fn() });
    expect(container.textContent).not.toContain('couldn’t read');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps the city and the coach’s line whatever the forecast did', () => {
    const { container } = open({ weather: { ...CLEAR, precip_chance: 0.4 }, forecast: { available: false } });
    expect(container.querySelector('.thead-loc')!.textContent).toContain('Montreal');
    expect(container.querySelector('.wxsheet-coach')!.textContent).toBe(
      'Clear and 19° right now — about a 40% chance of rain later on.',
    );
  });
});

describe('the city line', () => {
  /**
   * It used to be a button labelled CHANGE that moved the transient position — and nothing here
   * ever let anyone change their location, which lives in Settings. Owner, 2026-09-07: a CHANGE
   * that changes nothing you can see comes out. Now it is a fact, not a door.
   */
  it('is plain text with the pin — not a button, and never CHANGE', () => {
    const { container } = open();
    const loc = container.querySelector('.thead-loc')!;
    expect(loc.tagName).not.toBe('BUTTON');
    expect(loc.textContent).toContain('📍');
    expect(loc.textContent).toContain('Montreal');
    expect(container.textContent).not.toContain('CHANGE');
    // The only buttons in the sheet are the tabs and Close — no location control of any kind.
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['×', 'Hourly', '10 days']);
  });

  it('says "Weather nearby" when the city is not known yet', () => {
    const { container } = open({ city: null });
    expect(container.querySelector('.thead-loc')!.textContent).toContain('Weather nearby');
  });
});

describe('Apple’s link', () => {
  it('follows the forecast’s own source when the reading carries none', () => {
    open(); // the reading has no attribution; the series is Apple's
    expect(screen.getByRole('link', { name: /Other data sources/ }).getAttribute('href')).toBe(APPLE.url);
  });

  it('is absent when neither the reading nor the series is Apple’s', () => {
    open({ forecast: { ...forecast(), source: 'openweathermap', attribution: null } });
    expect(screen.queryByRole('link', { name: /Other data sources/ })).toBeNull();
  });
});
