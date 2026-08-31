import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getDietaryProfile: vi.fn(async () => ({ status: 'ok', profile: { allergies: [], diet: null, dislikes: [], notes: null } })),
  saveDietaryProfile: vi.fn(),
  setMacroTargets: vi.fn(async () => ({})),
}));
vi.mock('../../lib/api.ts', () => api);

const query = vi.hoisted(() => ({
  useNutritionDay: vi.fn(),
  useInvalidateNutritionDay: vi.fn(() => vi.fn()),
}));
vi.mock('../../lib/query/index.ts', () => query);

const { SettingsNutrition } = await import('./SettingsNutrition.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  query.useInvalidateNutritionDay.mockReturnValue(vi.fn());
});

describe('SettingsNutrition — daily target steppers', () => {
  it('steps calories by 25 and grams by 5, saving the full set of current values', async () => {
    query.useNutritionDay.mockReturnValue({
      data: { targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 } },
    });
    render(<SettingsNutrition onBack={() => {}} />);

    fireEvent.click(await screen.findByLabelText('Increase Calories'));
    await waitFor(() =>
      expect(api.setMacroTargets).toHaveBeenCalledWith({ kcal: 2025, protein_g: 150, carbs_g: 200, fat_g: 60 }),
    );
    expect(screen.getByText('2025')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Increase Protein'));
    await waitFor(() =>
      expect(api.setMacroTargets).toHaveBeenLastCalledWith({ kcal: 2025, protein_g: 155, carbs_g: 200, fat_g: 60 }),
    );

    fireEvent.click(screen.getByLabelText('Decrease Fat'));
    await waitFor(() =>
      expect(api.setMacroTargets).toHaveBeenLastCalledWith({ kcal: 2025, protein_g: 155, carbs_g: 200, fat_g: 55 }),
    );
  });

  it('hides the sodium row when no sodium target is on file', async () => {
    query.useNutritionDay.mockReturnValue({
      data: { targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 } },
    });
    render(<SettingsNutrition onBack={() => {}} />);
    await screen.findByText('Calories');
    expect(screen.queryByText('Sodium')).not.toBeInTheDocument();
  });

  it('shows the sodium row once a sodium target already exists, and steps it', async () => {
    query.useNutritionDay.mockReturnValue({
      data: { targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, sodium_mg: 2000 } },
    });
    render(<SettingsNutrition onBack={() => {}} />);

    expect(await screen.findByText('Sodium')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Increase Sodium'));
    await waitFor(() =>
      expect(api.setMacroTargets).toHaveBeenCalledWith({
        kcal: 2000,
        protein_g: 150,
        carbs_g: 200,
        fat_g: 60,
        sodium_mg: 2050,
      }),
    );
  });

  it('states the helper line about saving right away', async () => {
    query.useNutritionDay.mockReturnValue({ data: { targets: {} } });
    render(<SettingsNutrition onBack={() => {}} />);
    expect(
      await screen.findByText('Change a number and Cadence is told right away — next meals plan against it.'),
    ).toBeInTheDocument();
  });
});

describe('SettingsNutrition — allergies & preferences', () => {
  it('carries the asymmetry line: Cadence can add an allergy, never remove one', async () => {
    query.useNutritionDay.mockReturnValue({ data: { targets: {} } });
    api.getDietaryProfile.mockResolvedValueOnce({
      status: 'ok',
      profile: { allergies: ['peanuts'], diet: null, dislikes: [], notes: null },
    });
    render(<SettingsNutrition onBack={() => {}} />);

    expect(await screen.findByText('peanuts')).toBeInTheDocument();
    expect(
      screen.getByText('Cadence can add one if she spots it in conversation — she can never remove one.'),
    ).toBeInTheDocument();
  });

  it('the user CAN remove an allergy chip themselves', async () => {
    query.useNutritionDay.mockReturnValue({ data: { targets: {} } });
    api.getDietaryProfile.mockResolvedValueOnce({
      status: 'ok',
      profile: { allergies: ['peanuts'], diet: null, dislikes: [], notes: null },
    });
    api.saveDietaryProfile.mockResolvedValueOnce({ allergies: [], diet: null, dislikes: [], notes: null });
    render(<SettingsNutrition onBack={() => {}} />);

    fireEvent.click(await screen.findByLabelText('Remove peanuts'));
    await waitFor(() => expect(api.saveDietaryProfile).toHaveBeenCalledWith({
      allergies: [],
      diet: null,
      dislikes: [],
      notes: null,
    }));
  });
});
