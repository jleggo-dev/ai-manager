/**
 * The Apple Health toggle (owner, 2026-09-07: "a toggle that remains persistently on or off").
 * Persistence IS the localStorage marker — there is no server flag — so the table is about the
 * marker: on sets it after the permission sheet, off clears it, a sheet that cannot be reached
 * leaves it clear, and web (no HealthKit) renders nothing at all.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HEALTH_CONNECTED_KEY } from './health-import.ts';

const isAvailable = vi.fn(() => true);
const requestPermissions = vi.fn();

vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: {
    health: {
      isAvailable: () => isAvailable(),
      requestPermissions: (...a: unknown[]) => requestPermissions(...a),
    },
  },
}));

const { SettingsHealthRow } = await import('./SettingsHealthRow.tsx');

const toggle = () => screen.getByRole('switch', { name: 'Apple Health' });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  isAvailable.mockReturnValue(true);
  requestPermissions.mockResolvedValue(true);
});

describe('SettingsHealthRow', () => {
  it('starts off with no marker, and no Workouts door', () => {
    render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'Workouts' })).not.toBeInTheDocument();
    // Label and switch only — no sub-line.
    expect(toggle().textContent).toBe('Apple Health');
  });

  it('starts on when the marker is already set', () => {
    window.localStorage.setItem(HEALTH_CONNECTED_KEY, '1');
    render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Workouts' })).toBeInTheDocument();
  });

  it('on: asks HealthKit for workouts, then sets the marker and shows the Workouts door', async () => {
    render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    fireEvent.click(toggle());

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));
    expect(requestPermissions).toHaveBeenCalledWith(['workouts']);
    expect(window.localStorage.getItem(HEALTH_CONNECTED_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Workouts' })).toBeInTheDocument();
  });

  it('on, when the sheet cannot be reached: stays off, marker clear, error line shown', async () => {
    requestPermissions.mockRejectedValue(new Error('no HealthKit'));
    render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    fireEvent.click(toggle());

    expect(await screen.findByText(/Couldn't reach Apple Health/)).toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem(HEALTH_CONNECTED_KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Workouts' })).not.toBeInTheDocument();
  });

  it('off: clears the marker without asking HealthKit anything, and hides the Workouts door', () => {
    window.localStorage.setItem(HEALTH_CONNECTED_KEY, '1');
    render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem(HEALTH_CONNECTED_KEY)).toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Workouts' })).not.toBeInTheDocument();
  });

  it('the Workouts door opens the import list', () => {
    window.localStorage.setItem(HEALTH_CONNECTED_KEY, '1');
    const onOpenWorkouts = vi.fn();
    render(<SettingsHealthRow onOpenWorkouts={onOpenWorkouts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Workouts' }));
    expect(onOpenWorkouts).toHaveBeenCalled();
  });

  it('renders nothing where HealthKit does not exist — the web build is untouched', () => {
    isAvailable.mockReturnValue(false);
    const { container } = render(<SettingsHealthRow onOpenWorkouts={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
