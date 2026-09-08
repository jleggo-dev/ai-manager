/**
 * The dial is a promise about what will and will not arrive on someone's lock screen, so the
 * tests here are the dial's table (owner, 2026-09-01: every button gets one): four positions,
 * Off forgets this device, an amount picked from Off registers it first, the active position is a
 * no-op, and nothing is offered on a channel nothing sends on.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationSettings } from './NotificationSettings.tsx';
import { PUSH_TOKEN_KEY } from './notifications/enablePush.ts';

const getPrefs = vi.fn();
const savePrefs = vi.fn();
const registerToken = vi.fn();
const removeToken = vi.fn();
const pushRegister = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
  saveNotificationPrefs: (...a: unknown[]) => savePrefs(...a),
  registerPushToken: (...a: unknown[]) => registerToken(...a),
  removePushToken: (...a: unknown[]) => removeToken(...a),
  getUnits: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: {
    push: { isAvailable: () => true, register: (...a: unknown[]) => pushRegister(...a) },
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

const radio = (name: string) => screen.findByRole('radio', { name });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getPrefs.mockResolvedValue({ ...PREFS });
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({ ...PREFS, ...patch }));
  registerToken.mockResolvedValue(true);
  removeToken.mockResolvedValue(true);
  pushRegister.mockResolvedValue('tok-1');
});

describe('NotificationSettings — the dial', () => {
  it('offers Off plus three amounts and marks the one in force', async () => {
    renderSettings();
    expect((await radio('Moderate')).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Few' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Lots' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('shows Off as the position in force when push is disabled', async () => {
    getPrefs.mockResolvedValue({ ...PREFS, enabled: false });
    renderSettings();
    expect((await radio('Off')).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Moderate' }).getAttribute('aria-checked')).toBe('false');
  });

  it('carries no gloss, no "MEANS" card and no closing paragraph — labels only', async () => {
    renderSettings();
    await radio('Moderate');
    expect(screen.queryByText(/MEANS/)).toBeNull();
    expect(screen.queryByText(/AND NOT/)).toBeNull();
    expect(screen.queryByText(/only what happened/)).toBeNull();
    expect(screen.queryByText(/broken-streak/)).toBeNull();
    expect(screen.queryByText(/You set how much I say/)).toBeNull();
  });

  /** The dial's table: what each press does, from each position. */
  describe('presses', () => {
    it('Off, from an amount: forgets this device’s token and saves enabled: false', async () => {
      window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-old');
      renderSettings();
      fireEvent.click(await radio('Off'));

      await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ enabled: false }));
      expect(removeToken).toHaveBeenCalledWith('tok-old');
      expect(window.localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
      expect(pushRegister).not.toHaveBeenCalled();
      expect((await radio('Off')).getAttribute('aria-checked')).toBe('true');
    });

    it('an amount, from Off: registers this device FIRST, then saves enabled: true with the tier', async () => {
      getPrefs.mockResolvedValue({ ...PREFS, enabled: false });
      renderSettings();
      fireEvent.click(await radio('Lots'));

      await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ enabled: true, tier: 'lots' }));
      expect(pushRegister).toHaveBeenCalled();
      expect(registerToken).toHaveBeenCalledWith('tok-1');
      expect(window.localStorage.getItem(PUSH_TOKEN_KEY)).toBe('tok-1');
      expect(pushRegister.mock.invocationCallOrder[0]).toBeLessThan(savePrefs.mock.invocationCallOrder[0]!);
      expect((await radio('Lots')).getAttribute('aria-checked')).toBe('true');
    });

    it('an amount, from Off, when iOS says no: stays Off and says so', async () => {
      getPrefs.mockResolvedValue({ ...PREFS, enabled: false });
      pushRegister.mockResolvedValue(null);
      renderSettings();
      fireEvent.click(await radio('Few'));

      expect(await screen.findByText(/iOS said no/)).toBeTruthy();
      expect(savePrefs).not.toHaveBeenCalled();
      expect((await radio('Off')).getAttribute('aria-checked')).toBe('true');
    });

    it('another amount, from an amount: saves ONLY the tier and shows the server’s answer', async () => {
      renderSettings();
      fireEvent.click(await radio('Lots'));

      await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ tier: 'lots' }));
      expect(pushRegister).not.toHaveBeenCalled();
      expect(removeToken).not.toHaveBeenCalled();
      expect((await radio('Lots')).getAttribute('aria-checked')).toBe('true');
    });

    it('the active amount: a no-op', async () => {
      renderSettings();
      fireEvent.click(await radio('Moderate'));
      await radio('Moderate');
      expect(savePrefs).not.toHaveBeenCalled();
      expect(pushRegister).not.toHaveBeenCalled();
    });

    it('Off, from Off: a no-op', async () => {
      getPrefs.mockResolvedValue({ ...PREFS, enabled: false });
      renderSettings();
      fireEvent.click(await radio('Off'));
      await radio('Off');
      expect(savePrefs).not.toHaveBeenCalled();
      expect(removeToken).not.toHaveBeenCalled();
    });
  });
});

describe('NotificationSettings — the rest of the screen', () => {
  it('shows the quiet window as a value, with no wind-down sentence', async () => {
    renderSettings();
    expect(await screen.findByText('Quiet hours')).toBeTruthy();
    expect(screen.getByText('21:30–07:00')).toBeTruthy();
    expect(screen.queryByText(/wind-down/)).toBeNull();
  });

  it('offers no separate push switch and no channel nothing sends on', async () => {
    renderSettings();
    await radio('Moderate');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.queryByText(/text message|sms/i)).toBeNull();
  });

  it('renders nothing where push does not exist — the web build is untouched', async () => {
    const { capabilities } = await import('../../lib/capability/index.ts');
    vi.spyOn(capabilities.push, 'isAvailable').mockReturnValue(false);
    const { container } = renderSettings();
    expect(container.textContent).toBe('');
  });
});
