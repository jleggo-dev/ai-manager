import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: vi.fn() }));
vi.mock('./meal-photos.ts', () => ({
  putMealPhoto: vi.fn(async () => 'user/2026-07-25/abc.jpg'),
  signMealPhotoUrl: vi.fn(async () => 'https://example.com/signed.jpg'),
}));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));

import { runJobBySlug } from '../ai/aim.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { estimateFood, identifyFood, parseNutritionLabel } from './food-capture.ts';

const USER = '00000000-0000-4000-a000-00000000a201';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';

/** Partial AIM result — service only reads formatted/raw. */
function aimFormatted(formatted: string) {
  return { formatted } as Awaited<ReturnType<typeof runJobBySlug>>;
}

describe('food-capture service', () => {
  beforeEach(() => {
    vi.mocked(runJobBySlug).mockReset();
    vi.mocked(putMealPhoto).mockClear();
    vi.mocked(signMealPhotoUrl).mockClear();
  });

  it('parseNutritionLabel uploads photo, runs vision job, returns candidate', async () => {
    vi.mocked(runJobBySlug).mockResolvedValueOnce(
      aimFormatted(
        JSON.stringify({
          serving_size: 170,
          serving_unit: 'g',
          serving_label: '1 container (170g)',
          macros_per_serving: { kcal: 90, protein_g: 18, carbs_g: 5, fat_g: 0 },
          name: 'Greek Yogurt',
          brand: 'Fage',
          confidence: 0.9,
          label_readable: true,
        }),
      ),
    );

    const out = await parseNutritionLabel(USER, { photo: PHOTO, hint: 'Fage' });

    expect(putMealPhoto).toHaveBeenCalledOnce();
    expect(signMealPhotoUrl).toHaveBeenCalledWith('user/2026-07-25/abc.jpg');
    expect(runJobBySlug).toHaveBeenCalledWith(
      USER,
      'parse-nutrition-label',
      { hint: 'Fage' },
      { images: ['https://example.com/signed.jpg'] },
    );
    expect(out.label_readable).toBe(true);
    expect(out.candidate.name).toBe('Greek Yogurt');
    expect(out.candidate.source).toBe('label_photo');
    expect(out.candidate.photo_ref).toBe('user/2026-07-25/abc.jpg');
  });

  it('estimateFood runs estimate-food by slug with food_text', async () => {
    vi.mocked(runJobBySlug).mockResolvedValueOnce(
      aimFormatted(
        JSON.stringify({
          name: 'Large egg',
          brand: null,
          serving_size: 1,
          serving_unit: 'item',
          serving_label: '1 large egg',
          macros_per_serving: { kcal: 70, protein_g: 6, carbs_g: 0, fat_g: 5 },
          confidence: 0.8,
        }),
      ),
    );

    const candidate = await estimateFood(USER, '  large egg  ');
    expect(runJobBySlug).toHaveBeenCalledWith(USER, 'estimate-food', { food_text: 'large egg' });
    expect(putMealPhoto).not.toHaveBeenCalled();
    expect(candidate.base_unit).toBe('item');
    expect(candidate.source).toBe('llm');
  });

  it('identifyFood returns name + brand from vision job', async () => {
    vi.mocked(runJobBySlug).mockResolvedValueOnce(
      aimFormatted(JSON.stringify({ name: 'Cheerios', brand: 'General Mills', confidence: 0.88 })),
    );

    const out = await identifyFood(USER, { photo: PHOTO });
    expect(runJobBySlug).toHaveBeenCalledWith(
      USER,
      'identify-food',
      { hint: '' },
      { images: ['https://example.com/signed.jpg'] },
    );
    expect(out).toMatchObject({ name: 'Cheerios', brand: 'General Mills', confidence: 0.88 });
  });

  it('estimateFood rejects empty text before calling AIM', async () => {
    await expect(estimateFood(USER, '   ')).rejects.toThrow(/food text required/);
    expect(runJobBySlug).not.toHaveBeenCalled();
  });
});
