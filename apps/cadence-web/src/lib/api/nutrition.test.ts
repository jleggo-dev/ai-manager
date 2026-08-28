/**
 * MP19 — logging a composed planned meal (frame 10a) in one tap. There is no single server endpoint
 * for a mixed recipe+food row, so `logPlannedMealItems` fans out to the calls that already exist:
 * one `logMealFromRecipe`-shaped write per recipe item, one batched `logMealFromItems`-shaped write
 * for every food item. These pin the fan-out shape and that a partial failure is reported honestly
 * rather than read as success.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logPlannedMealItems } from './nutrition.ts';

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('logPlannedMealItems', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ log_id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs each recipe item through its own deterministic recipe write', async () => {
    const ok = await logPlannedMealItems(
      [{ kind: 'recipe', id: 'r1', name: 'Chicken thighs & lemon orzo', qty: 1.5 }],
      'dinner',
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]!)).toMatchObject({ recipe_id: 'r1', servings: 1.5, meal: 'dinner' });
  });

  it('batches every food item into ONE plate write, serving_index left for the server default', async () => {
    const ok = await logPlannedMealItems(
      [
        { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g' },
        { kind: 'food', id: 'f2', name: 'Olive oil', qty: 1, unit: 'tbsp' },
      ],
      'dinner',
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock.mock.calls[0]!);
    expect(body.items).toEqual([
      { food_id: 'f1', quantity: 120 },
      { food_id: 'f2', quantity: 1 },
    ]);
  });

  it('mixes both — one call per recipe, one call for all the foods together', async () => {
    await logPlannedMealItems(
      [
        { kind: 'recipe', id: 'r1', name: 'Chicken thighs & lemon orzo', qty: 1 },
        { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g' },
        { kind: 'food', id: 'f2', name: 'Olive oil', qty: 1, unit: 'tbsp' },
      ],
      'dinner',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports false when any write in the fan-out fails, rather than reading as a success', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.recipe_id === 'bad') return new Response(null, { status: 500 });
      return new Response(JSON.stringify({ log_id: 'm1' }), { status: 200 });
    });
    const ok = await logPlannedMealItems([
      { kind: 'recipe', id: 'bad', name: 'Broken', qty: 1 },
      { kind: 'food', id: 'f1', name: 'Rocket', qty: 1 },
    ]);
    expect(ok).toBe(false);
  });

  it('is a no-op — false, no fetch — for an empty or all-zero-qty item list', async () => {
    expect(await logPlannedMealItems([])).toBe(false);
    expect(await logPlannedMealItems([{ kind: 'food', id: 'f1', name: 'x', qty: 0 }])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
