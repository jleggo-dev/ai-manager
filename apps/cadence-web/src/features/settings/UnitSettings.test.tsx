/**
 * The point of five controls is that they are INDEPENDENT — so most of what matters here is that
 * changing one leaves the others where the user put them.
 *
 * Owner, 2026-08-22: pounds for himself, grams for food, cups for food volume, feet and inches for
 * height, kilometres for distance. A single metric/imperial switch cannot express that, and a set
 * of controls that quietly drag each other is the same failure wearing five hats.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = { getUnits: vi.fn(), setUnits: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  getUnits: () => api.getUnits(),
  setUnits: (p: unknown) => api.setUnits(p),
}));

const { UnitSettings } = await import('./UnitSettings.tsx');

const RESOLVED = {
  body_weight: 'lb',
  height: 'ft_in',
  food_mass: 'g',
  food_volume: 'cup',
  distance: 'km',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getUnits.mockResolvedValue({ prefs: null, resolved: RESOLVED });
  api.setUnits.mockImplementation((patch: Record<string, string>) =>
    Promise.resolve({ prefs: patch, resolved: { ...RESOLVED, ...patch } }),
  );
});

const row = (label: string) => screen.getByRole('group', { name: label });

describe('UnitSettings', () => {
  it('shows every axis at the unit the server resolved', async () => {
    render(<UnitSettings />);
    await waitFor(() => expect(screen.getByText('Units')).toBeInTheDocument());

    expect(within(row('Your weight')).getByRole('button', { name: 'pounds' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row('Food weight')).getByRole('button', { name: 'grams' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row('Your height')).getByRole('button', { name: 'feet & inches' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sends ONLY the axis that changed — the rest are not asserted', async () => {
    const user = userEvent.setup();
    render(<UnitSettings />);
    await waitFor(() => expect(screen.getByText('Units')).toBeInTheDocument());

    await user.click(within(row('Food volume')).getByRole('button', { name: 'millilitres' }));
    expect(api.setUnits).toHaveBeenCalledWith({ food_volume: 'ml' });
    expect(api.setUnits).toHaveBeenCalledTimes(1);
  });

  /** THE one that matters: changing food volume must not move body weight. */
  it('leaves the other axes alone', async () => {
    const user = userEvent.setup();
    render(<UnitSettings />);
    await waitFor(() => expect(screen.getByText('Units')).toBeInTheDocument());

    await user.click(within(row('Food volume')).getByRole('button', { name: 'millilitres' }));

    await waitFor(() =>
      expect(within(row('Your weight')).getByRole('button', { name: 'pounds' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(within(row('Food weight')).getByRole('button', { name: 'grams' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when a save fails, and does not pretend it worked', async () => {
    api.setUnits.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<UnitSettings />);
    await waitFor(() => expect(screen.getByText('Units')).toBeInTheDocument());

    await user.click(within(row('Distance')).getByRole('button', { name: 'miles' }));
    expect(await screen.findByText(/didn't save/i)).toBeInTheDocument();
  });

  /** Nothing to show is better than an empty shell of controls that cannot save. */
  it('renders nothing until it knows the current units', () => {
    api.getUnits.mockReturnValue(new Promise(() => {}));
    const { container } = render(<UnitSettings />);
    expect(container).toBeEmptyDOMElement();
  });
});
