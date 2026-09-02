/**
 * The dial is a promise about what will and will not arrive on someone's lock screen, so the
 * tests here are about the promise: that the card names what the tier LEAVES OUT as well as what
 * it includes, that the closing reassurance is present at every tier, and that no channel is
 * offered which nothing sends on.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationSettings } from './NotificationSettings.tsx';

const getPrefs = vi.fn();
const savePrefs = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
  saveNotificationPrefs: (...a: unknown[]) => savePrefs(...a),
  registerPushToken: vi.fn().mockResolvedValue(true),
  removePushToken: vi.fn().mockResolvedValue(true),
  getUnits: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: {
    push: { isAvailable: () => true, register: async () => 'tok-1' },
  },
}));

const PREFS = {
  enabled: true,
  tier: 'moderate' as const,
  quietStartMin: 21 * 60 + 30,
  quietEndMin: 7 * 60,
  includes: ['weekly_checkin', 'freeze_save', 'detour_ending', 'almost_time', 're_entry', 'milestone_waypoint'],
  excludes: ['before_quiet_hours', 'morning_adjust', 'weather_move'],
  maxPerDay: 1,
};

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getPrefs.mockResolvedValue({ ...PREFS });
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({ ...PREFS, ...patch }));
});

describe('NotificationSettings', () => {
  it('opens by saying who is in charge of the volume', async () => {
    renderSettings();
    expect(await screen.findByText(/I'll only say what's useful\. You set how much I say\./)).toBeTruthy();
  });

  it('offers three amounts and marks the one in force', async () => {
    renderSettings();
    const moderate = await screen.findByRole('radio', { name: /Moderate/ });
    expect(moderate.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Few/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: /Lots/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('names what the tier includes AND what it leaves out', async () => {
    renderSettings();
    expect(await screen.findByText('MODERATE MEANS')).toBeTruthy();
    expect(screen.getByText(/Shortly before something you set a time for/)).toBeTruthy();
    // The half that makes this a setting rather than a sales page.
    expect(screen.getByText('AND NOT')).toBeTruthy();
    expect(screen.getByText(/weather argues with an outdoor session/)).toBeTruthy();
  });

  it('states the day’s ceiling in words a person would use', async () => {
    renderSettings();
    expect(await screen.findByText('At most one a day.')).toBeTruthy();
  });

  it('saves a tier change and shows the SERVER’s answer', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('radio', { name: /Lots/ }));
    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ tier: 'lots' }));
    expect(await screen.findByText('LOTS MEANS')).toBeTruthy();
  });

  it('shows the quiet window and calls its start a wind-down', async () => {
    renderSettings();
    expect(await screen.findByText(/Quiet hours · 21:30 to 07:00/)).toBeTruthy();
    expect(screen.getByText('I treat the start as your wind-down')).toBeTruthy();
  });

  it('offers PUSH and nothing else — no toggle for a channel nothing sends on', async () => {
    renderSettings();
    expect(await screen.findByRole('switch', { name: /Push/ })).toBeTruthy();
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.queryByText(/text message|sms/i)).toBeNull();
  });

  it('closes on the promise that holds at every tier', async () => {
    renderSettings();
    expect(
      await screen.findByText(
        /no broken-streak alarms, nothing about falling behind, and going quiet never costs you anything/,
      ),
    ).toBeTruthy();
  });

  it('renders nothing where push does not exist — the web build is untouched', async () => {
    const { capabilities } = await import('../../lib/capability/index.ts');
    vi.spyOn(capabilities.push, 'isAvailable').mockReturnValue(false);
    const { container } = renderSettings();
    expect(container.textContent).toBe('');
  });
});
