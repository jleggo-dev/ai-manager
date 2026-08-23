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
import { WeatherSheet } from './WeatherSheet.tsx';

const getWeather = vi.fn();
const getNotificationPrefs = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getWeather: (...a: unknown[]) => getWeather(...a),
  getHomeLocation: () =>
    Promise.resolve({
      home_location: { lat: 45.4, lon: -73.9, label: "Notre-Dame-de-l'Île-Perrot, QC" },
      current_location: null,
    }),
  saveHomeLocation: vi.fn(),
  saveCurrentLocation: vi.fn(),
  clearCurrentLocation: vi.fn(),
  browserTimezone: () => 'America/Toronto',
  getNotificationPrefs: (...a: unknown[]) => getNotificationPrefs(...a),
  saveNotificationPrefs: vi.fn(),
}));
vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: { location: { isAvailable: () => false, getCoarseLocation: () => Promise.resolve(null) } },
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
  getNotificationPrefs.mockResolvedValue({ ...PREFS });
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
    await screen.findByText(/quiet at 9:30/);
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

  it('shows the short forecast when there is one, and no empty row when there is not', () => {
    const hours = [
      { at: '21:00', icon: '🌙', temp: '18°' },
      { at: '22:00', icon: '🌙', temp: '17°' },
      { at: '23:00', icon: '🌙', temp: '16°' },
      { at: '00:00', icon: '🌙', temp: '15°' },
    ];
    const sheet = (rows?: typeof hours) =>
      render(
        <WeatherSheet weather={CLEAR} city="Montreal" night hours={rows} onHereNow={() => {}} onClose={() => {}} />,
      );

    const withRows = sheet(hours);
    expect(withRows.container.querySelectorAll('.wxsheet-hour')).toHaveLength(4);
    expect(withRows.container.querySelector('.wxsheet-hour')!.textContent).toBe('21:00🌙18°');
    withRows.unmount();

    // Nothing supplies the series yet, and a repeated current reading would be a lie — so the row
    // is simply absent rather than filled in.
    expect(sheet().container.querySelector('.wxsheet-hours')).toBeNull();
  });

  it('says what the sky is doing in her own words, from the reading', () => {
    const { container } = render(
      <WeatherSheet
        weather={{ ...CLEAR, precip_chance: 0.4 }}
        city="Montreal"
        night
        onHereNow={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('.wxsheet-coach')!.textContent).toBe(
      'Clear and 19° right now — about a 40% chance of rain later on.',
    );
  });
});
