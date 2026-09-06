/**
 * The weather sheet, on its own: what each tab draws, and what it shows when there is less to
 * draw than the tab promised. The header's side — that the forecast is read before the tap — is
 * pinned in TrailHeader.test.tsx.
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
      onHereNow={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('the sheet opens on the forecast', () => {
  it('leads with the reading, then the three ranges, on the hourly strip', () => {
    const { container } = open();
    expect(container.querySelector('.wxsheet-now')!.textContent).toContain('Clear · 19°');
    expect(screen.getByRole('tablist', { name: 'Forecast range' })).toBeTruthy();
    expect(tab('Hourly').getAttribute('aria-selected')).toBe('true');
    expect(tab('7 days').getAttribute('aria-selected')).toBe('false');
    expect(tab('14 days').getAttribute('aria-selected')).toBe('false');
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
  it('shows a week on the 7-day tab, from Today, without a horizon line', () => {
    const { container } = open();
    fireEvent.click(tab('7 days'));
    expect(tab('7 days').getAttribute('aria-selected')).toBe('true');
    const rows = container.querySelectorAll('.wxsheet-day');
    expect(rows).toHaveLength(7);
    expect(rows[0]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Today');
    expect(rows[1]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Tomorrow');
    expect(rows[2]!.querySelector('.wxsheet-day-when')!.textContent).toBe('Thu 20');
    expect(rows[2]!.querySelector('.wxsheet-day-cond')!.textContent).toBe('Heavy rain');
    expect(rows[2]!.querySelector('.wxsheet-day-precip')!.textContent).toBe('80%');
    expect(rows[0]!.querySelector('.wxsheet-day-range')!.textContent).toBe('14° 25°');
    expect(container.querySelector('.wxsheet-horizon')).toBeNull();
    expect(container.querySelector('.wxsheet-hours')).toBeNull();
  });

  it('shows what there is on the 14-day tab, and says how far she got', () => {
    const { container } = open();
    fireEvent.click(tab('14 days'));
    expect(container.querySelectorAll('.wxsheet-day')).toHaveLength(10); // Apple sees ten
    expect(container.querySelector('.wxsheet-horizon')!.textContent).toBe(
      "That's as far ahead as I can see — 10 days.",
    );
  });

  it('never pads a short series — five days from OpenWeatherMap is five rows on either tab', () => {
    const { container } = open({ forecast: { ...forecast(5, 8), source: 'openweathermap', attribution: null } });
    fireEvent.click(tab('7 days'));
    expect(container.querySelectorAll('.wxsheet-day')).toHaveLength(5);
    expect(container.querySelector('.wxsheet-horizon')!.textContent).toContain('5 days');
    fireEvent.click(tab('Hourly'));
    expect(container.querySelectorAll('.wxsheet-hour')).toHaveLength(8); // three-hourly slots, as given
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

  it('keeps the city, CHANGE, and the coach’s line whatever the forecast did', () => {
    const { container } = open({ weather: { ...CLEAR, precip_chance: 0.4 }, forecast: { available: false } });
    expect(container.textContent).toContain('Montreal');
    expect(container.textContent).toContain('CHANGE');
    expect(container.querySelector('.wxsheet-coach')!.textContent).toBe(
      'Clear and 19° right now — about a 40% chance of rain later on.',
    );
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
