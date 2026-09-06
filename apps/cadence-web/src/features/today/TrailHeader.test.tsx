/**
 * The floating Plan header (frame 2a) and the sheet behind its weather chip.
 *
 * Three of these pin things that were actually wrong before: a header that kept its cream palette
 * over a night trail, a clear sky at nine in the evening drawn with a sun, and a weather line that
 * kept its adjective on the one row that also has to hold the quiet-hours chip.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrailHeader } from './TrailHeader.tsx';

const getWeather = vi.fn();
const getForecast = vi.fn();
const getHomeLocation = vi.fn();
const getNotificationPrefs = vi.fn();
const locationAvailable = vi.fn(() => false);
const getCoarseLocation = vi.fn(() => Promise.resolve(null as { lat: number; lon: number } | null));

vi.mock('../../lib/api.ts', () => ({
  getWeather: (...a: unknown[]) => getWeather(...a),
  getForecast: (...a: unknown[]) => getForecast(...a),
  getUnits: vi.fn().mockResolvedValue(null),
  getHomeLocation: (...a: unknown[]) => getHomeLocation(...a),
  saveHomeLocation: vi.fn(),
  saveCurrentLocation: vi.fn(),
  clearCurrentLocation: vi.fn(),
  browserTimezone: () => 'America/Toronto',
  getNotificationPrefs: (...a: unknown[]) => getNotificationPrefs(...a),
  saveNotificationPrefs: vi.fn(),
}));
vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: {
    location: { isAvailable: () => locationAvailable(), getCoarseLocation: () => getCoarseLocation() },
  },
}));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));

const CLEAR = {
  available: true,
  temp_c: 19,
  conditions: 'clear',
  label: "Notre-Dame-de-l'Île-Perrot, QC",
  precip_chance: 0.1,
  attribution: { name: 'Apple Weather', url: 'https://weather-data.apple.com/legal-attribution.html' },
};

/** The day of hours and the ten days behind the sheet's tabs, as `/me/forecast` hands them back. */
const FORECAST = {
  available: true,
  timezone: null,
  source: 'weatherkit' as const,
  attribution: CLEAR.attribution,
  hourly: Array.from({ length: 24 }, (_, i) => ({
    at: new Date(2026, 7, 18, 13 + i, 0).toISOString(),
    temp_c: 19 - i,
    conditions: 'clear',
    precip_chance: 0,
  })),
  daily: Array.from({ length: 10 }, (_, i) => ({
    date: `2026-08-${18 + i}`,
    high_c: 25 - i,
    low_c: 14 - i,
    conditions: 'mostly clear',
    precip_chance: 0.05,
  })),
};

/** A place on file, and a read that came back to say so. */
const HOME = {
  home_location: { lat: 45.4, lon: -73.9, label: "Notre-Dame-de-l'Île-Perrot, QC" },
  current_location: null,
  timezone: 'America/Toronto',
  available: true,
};

const PREFS = {
  enabled: true,
  tier: 'moderate' as const,
  quietStartMin: 21 * 60 + 30,
  quietEndMin: 7 * 60,
  includes: [],
  excludes: [],
  maxPerDay: 1,
};

/** A local Date at a given wall-clock hour, whatever the test machine's zone is. */
const at = (hour: number) => new Date(2026, 7, 18, hour, 0);

/** jsdom lays nothing out, so the header and the day-skies are given the geometry to sample. */
function stubRect(el: Element, top: number, height: number) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 402, width: 402 }) as DOMRect;
}

/** The header over a trail: `.app` is the frame it floats in, `.scrollbody` the sky it reads. */
function renderHeader(now: Date) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <div className="app">
        <TrailHeader streak={3} xp={10} now={now} />
        <div className="scrollbody">
          <div className="trail">
            <section className="trail-day" />
            <section className="trail-day is-later" />
          </div>
        </div>
      </div>
    </QueryClientProvider>,
  );
  const q = (sel: string) => view.container.querySelector(sel)!;
  return { ...view, q };
}

/** Put the sky where a given scroll position would put it, then let the header re-read it. */
function scrollTo(view: ReturnType<typeof renderHeader>, scrollTop: number) {
  stubRect(view.q('.thead'), 0, 54);
  stubRect(view.q('.trail-day'), -scrollTop, 1000);
  stubRect(view.q('.trail-day.is-later'), 1000 - scrollTop, 1000);
  fireEvent.scroll(view.q('.scrollbody'));
}

beforeEach(() => {
  vi.clearAllMocks();
  getWeather.mockResolvedValue({ ...CLEAR });
  getForecast.mockResolvedValue({ ...FORECAST });
  getHomeLocation.mockResolvedValue({ ...HOME });
  getNotificationPrefs.mockResolvedValue({ ...PREFS });
  locationAvailable.mockReturnValue(false);
  getCoarseLocation.mockResolvedValue(null);
  // The hook reads the sky one frame after a scroll; run that frame inline so the test can assert.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe('the header takes the sky it floats over', () => {
  it('flips its palette across the day/night seam, and back', async () => {
    const view = renderHeader(at(9));

    // Morning stretch of today under the band: cream.
    scrollTo(view, 0);
    await waitFor(() => expect(view.q('.thead').className).not.toContain('is-night'));

    // Scrolled to the evening stretch of the same day: the band goes with it.
    scrollTo(view, 800);
    await waitFor(() => expect(view.q('.thead').className).toContain('is-night'));

    // Into tomorrow, past the sunrise band at the divider: cream again.
    scrollTo(view, 1300);
    await waitFor(() => expect(view.q('.thead').className).not.toContain('is-night'));
  });

  it('measures itself so the trail below can clear it', async () => {
    const view = renderHeader(at(9));
    scrollTo(view, 0);
    const app = view.q('.app') as HTMLElement;
    await waitFor(() => expect(app.style.getPropertyValue('--thead-h')).toBe('54px'));
  });

  it('keeps the clock’s answer where there is no sky to read', async () => {
    // No trail at all (the Week lens, or the moment before the plan paints) at ten at night.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <div className="app">
          <TrailHeader streak={3} xp={10} now={at(22)} />
          <div className="scrollbody" />
        </div>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector('.thead')!.className).toContain('is-night'));
  });
});

describe('the weather line', () => {
  it('draws a clear night sky with the moon, not the sun', async () => {
    const view = renderHeader(at(21));
    await waitFor(() => expect(view.q('.thead-wx').textContent).toContain('🌙'));
    expect(view.q('.thead-wx').textContent).not.toContain('☀️');
  });

  it('draws the same sky with the sun in the middle of the day', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-wx').textContent).toContain('☀️'));
  });

  it('drops its condition word while the quiet-hours chip is up', async () => {
    const view = renderHeader(at(18)); // chip shows from 5pm, quiet hours start at 9:30
    await screen.findByText(/quiet at 21:30/);
    await waitFor(() => expect(view.q('.thead-wx').textContent).toBe('☀️ 19°'));
    expect(view.q('.thead-wx').textContent).not.toContain('Clear');
  });

  it('names the condition the rest of the day', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-wx').textContent).toBe('☀️ Clear · 19°'));
  });

  it('keeps Apple’s trademark on Plan itself', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-attr').textContent).toContain('Apple Weather'));
  });
});

describe('the boot paint', () => {
  it('opens on the place and the sky it last had, before a single request lands', async () => {
    // What `seedBootCache` puts in the client before React's first render (boot-cache.ts). Both
    // reads hang, so nothing here can have come from the network.
    getHomeLocation.mockReturnValue(new Promise(() => {}));
    getWeather.mockReturnValue(new Promise(() => {}));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['location'], { ...HOME });
    client.setQueryData(['weather'], { ...CLEAR });

    const view = render(
      <QueryClientProvider client={client}>
        <div className="app">
          <TrailHeader streak={3} xp={10} now={at(13)} />
          <div className="scrollbody" />
        </div>
      </QueryClientProvider>,
    );

    expect(view.container.querySelector('.thead-wx')!.textContent).toBe('☀️ Clear · 19°');
    expect(view.container.querySelector('.thead-set')).toBeNull();

    // And the city the sheet needs came off disk with it — not from the label the sky carries.
    fireEvent.click(view.container.querySelector('.thead-wxbtn')!);
    expect((await screen.findByRole('dialog', { name: 'Weather' })).textContent).toContain(
      "Notre-Dame-de-l'Île-Perrot, QC",
    );
  });
});

/**
 * Whether the header asks for a place — the router that had no negative cases.
 *
 * It used to read "no weather" as "no location", so three of these four rows drew a first-run
 * button at someone who had stored a place in August; the owner pressed one, and it re-homed him
 * to the street he was standing on. Only the row where a read comes BACK and says the file is
 * empty may ask.
 */
describe('the set-location prompt', () => {
  const prompt = (view: ReturnType<typeof renderHeader>) => view.container.querySelector('.thead-set');

  it('stays away when the sky is unavailable but the place is on file', async () => {
    locationAvailable.mockReturnValue(true); // a device that COULD find one — the button's only excuse
    getWeather.mockResolvedValue({ available: false });

    const view = renderHeader(at(13));
    await waitFor(() => expect(getWeather).toHaveBeenCalled());
    expect(prompt(view)).toBeNull();
    expect(view.container.querySelector('.thead-wx')).toBeNull(); // and no fabricated sky either
  });

  it('stays away while the reads are still in flight', () => {
    locationAvailable.mockReturnValue(true);
    getHomeLocation.mockReturnValue(new Promise(() => {})); // a cold launch, mid-round-trip

    // Not knowing is not the same as knowing there is nothing, and a cold open is all of the first.
    expect(prompt(renderHeader(at(13)))).toBeNull();
  });

  it('stays away when the location read FAILED — and still asks for the sky', async () => {
    locationAvailable.mockReturnValue(true);
    getHomeLocation.mockResolvedValue({
      home_location: null,
      current_location: null,
      timezone: null,
      available: false,
    });

    const view = renderHeader(at(13));
    // The read that failed used to send this mount down the first-run path, which returned without
    // ever reading `/me/weather`. The server still knows the place; ask it.
    await waitFor(() => expect(getWeather).toHaveBeenCalled());
    expect(prompt(view)).toBeNull();
  });

  it('appears when the server says there is no place stored', async () => {
    locationAvailable.mockReturnValue(true);
    getHomeLocation.mockResolvedValue({ home_location: null, current_location: null, timezone: null, available: true });
    getWeather.mockResolvedValue({ available: false });

    renderHeader(at(13));
    // Auto-detect runs first and finds nothing (declined), which is when asking is the honest move.
    await screen.findByText(/Set location for weather/);
    expect(getCoarseLocation).toHaveBeenCalled();
  });

  it('stays away on a device that could not act on it', async () => {
    locationAvailable.mockReturnValue(false); // no geolocation at all — Settings takes a typed city
    getHomeLocation.mockResolvedValue({ home_location: null, current_location: null, timezone: null, available: true });
    getWeather.mockResolvedValue({ available: false });

    const view = renderHeader(at(13));
    await waitFor(() => expect(getHomeLocation).toHaveBeenCalled());
    expect(prompt(view)).toBeNull();
  });
});

describe('the weather sheet', () => {
  it('opens from the chip, carrying the city and the legal link the header gave up', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-wxbtn')).toBeTruthy());
    fireEvent.click(view.q('.thead-wxbtn'));

    const sheet = await screen.findByRole('dialog', { name: 'Weather' });
    expect(sheet.textContent).toContain("Notre-Dame-de-l'Île-Perrot, QC");
    expect(sheet.textContent).toContain('CHANGE');
    const link = screen.getByRole('link', { name: /Other data sources/ });
    expect(link.getAttribute('href')).toBe('https://weather-data.apple.com/legal-attribution.html');
  });

  it('closes again', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-wxbtn')).toBeTruthy());
    fireEvent.click(view.q('.thead-wxbtn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Weather' })).toBeNull());
  });

  /**
   * The bug this sheet had: it opened on two actions and no forecast. Two things have to hold
   * now — the forecast is read WITH the sky, before anyone taps, and the tap opens on it.
   */
  it('reads the forecast with the sky, before the tap, and opens straight onto it', async () => {
    const view = renderHeader(at(13));
    await waitFor(() => expect(view.q('.thead-wxbtn')).toBeTruthy());
    // Nothing has been tapped, and the forecast has already been asked for.
    await waitFor(() => expect(getForecast).toHaveBeenCalled());

    fireEvent.click(view.q('.thead-wxbtn'));
    const sheet = await screen.findByRole('dialog', { name: 'Weather' });
    expect(screen.getByRole('tablist', { name: 'Forecast range' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hourly' }).getAttribute('aria-selected')).toBe('true');
    expect(sheet.querySelectorAll('.wxsheet-hour')).toHaveLength(24);
    expect(sheet.textContent).not.toContain('Reading the days ahead');

    fireEvent.click(screen.getByRole('tab', { name: '14 days' }));
    expect(sheet.querySelectorAll('.wxsheet-day')).toHaveLength(10);
  });

  it('does not ask for a forecast when there is no sky to hang it on', async () => {
    getWeather.mockResolvedValue({ available: false });
    renderHeader(at(13));
    await waitFor(() => expect(getWeather).toHaveBeenCalled());
    expect(getForecast).not.toHaveBeenCalled();
  });
});
