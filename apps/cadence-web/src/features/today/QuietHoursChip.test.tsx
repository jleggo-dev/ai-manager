/**
 * The chip's whole value is knowing when NOT to appear. A permanent one is a settings badge; one
 * that shows up during quiet hours is telling someone about a thing that has already happened.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuietHoursChip } from './QuietHoursChip.tsx';
import { shouldShowQuietChip } from './quietChipWindow.ts';

const getPrefs = vi.fn();

/** The units the chip reads its clock from; null = not chosen, which reads 24-hour. */
const units = vi.hoisted(() => ({ clock: null as string | null }));
vi.mock('../../lib/api.ts', () => ({
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
  saveNotificationPrefs: vi.fn(),
  getUnits: () => Promise.resolve(units.clock ? { prefs: null, resolved: { clock: units.clock } } : null),
}));

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
const at = (hour: number, minute = 0) => new Date(2026, 7, 10, hour, minute);

function renderChip(now: Date) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuietHoursChip now={now} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getPrefs.mockResolvedValue({ ...PREFS });
});

describe('shouldShowQuietChip', () => {
  it('appears from early evening', () => {
    expect(shouldShowQuietChip(16 * 60 + 59, 21 * 60 + 30, 7 * 60)).toBe(false);
    expect(shouldShowQuietChip(17 * 60, 21 * 60 + 30, 7 * 60)).toBe(true);
    expect(shouldShowQuietChip(21 * 60, 21 * 60 + 30, 7 * 60)).toBe(true);
  });

  it('disappears once quiet hours have started — including after midnight', () => {
    expect(shouldShowQuietChip(21 * 60 + 30, 21 * 60 + 30, 7 * 60)).toBe(false);
    expect(shouldShowQuietChip(2 * 60, 21 * 60 + 30, 7 * 60)).toBe(false);
    expect(shouldShowQuietChip(6 * 60 + 59, 21 * 60 + 30, 7 * 60)).toBe(false);
  });

  it('does not appear at all when there is no window set', () => {
    expect(shouldShowQuietChip(20 * 60, 9 * 60, 9 * 60)).toBe(false);
  });

  it('handles a same-day window without treating it as wrapping', () => {
    // 01:00 → 06:00: the evening is not quiet, so the chip shows from 5pm as usual.
    expect(shouldShowQuietChip(20 * 60, 60, 6 * 60)).toBe(true);
    expect(shouldShowQuietChip(3 * 60, 60, 6 * 60)).toBe(false);
  });
});

describe('QuietHoursChip', () => {
  it('reads like a sentence, not a setting', async () => {
    renderChip(at(18));
    expect(await screen.findByText(/quiet at 21:30/)).toBeTruthy();
  });

  it('is absent in the middle of the day', async () => {
    const { container } = renderChip(at(11));
    // Nothing to await — the chip renders null before the query even matters.
    expect(container.querySelector('.thead-quiet')).toBeNull();
  });

  it('opens the quiet-hours control when tapped', async () => {
    renderChip(at(18));
    (await screen.findByText(/quiet at 21:30/)).click();
    expect(await screen.findByRole('dialog', { name: 'Quiet hours' })).toBeTruthy();
    // The same wind-down framing as Settings — one setting, described one way.
    expect(screen.getAllByText('I treat the start as your wind-down').length).toBeGreaterThan(0);
  });
});

/** The clock is the person's (Settings → Units → Clock): "quiet at 21:30", or "quiet at 9:30". */
describe('QuietHoursChip clock', () => {
  afterEach(() => {
    units.clock = null;
  });

  it('reads 24-hour when that is the setting', async () => {
    units.clock = '24h';
    renderChip(at(18));
    expect((await screen.findByRole('button', { name: /Quiet hours start at/ })).textContent).toContain(
      'quiet at 21:30',
    );
  });

  it('reads 12-hour, without the am/pm, when that is the setting', async () => {
    units.clock = '12h';
    renderChip(at(18));
    const chip = await screen.findByRole('button', { name: /Quiet hours start at 9:30 pm/ });
    expect(chip.textContent).toContain('quiet at 9:30');
    expect(chip.textContent).not.toMatch(/pm/);
  });
});
