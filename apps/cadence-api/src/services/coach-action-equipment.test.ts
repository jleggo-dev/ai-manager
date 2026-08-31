import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Equipment } from '@cadence/shared';

/**
 * `update_equipment` against an in-memory equipment store. The repo seam is faked, not the DB:
 * what these tests pin is the tool's contract — matching sees through retellings, reword folds
 * the duplicates the older matcher let in, and every return describes a fresh read.
 */
const store = vi.hoisted(() => {
  const state = { rows: [] as Equipment[], nextId: 1 };
  return {
    state,
    listEquipment: vi.fn(async () => [...state.rows]),
    insertEquipment: vi.fn(async (_uid: string, e: Partial<Equipment>) => {
      const row = {
        equipment_id: `eq-${state.nextId++}`,
        user_id: 'u1',
        name: e.name ?? '',
        category: e.category ?? 'other',
        owned: e.owned ?? true,
        recommended_by: null,
        linked_goal_ids: [],
        wear: null,
      } as unknown as Equipment;
      state.rows.push(row);
      return row;
    }),
    updateEquipment: vi.fn(async (_uid: string, id: string, f: Partial<Equipment>) => {
      const row = state.rows.find((r) => r.equipment_id === id);
      if (row && f.name) row.name = f.name;
      if (row && f.category) row.category = f.category;
    }),
    deleteEquipment: vi.fn(async (_uid: string, id: string) => {
      state.rows = state.rows.filter((r) => r.equipment_id !== id);
    }),
  };
});

vi.mock('../repos/equipment.ts', () => ({
  listEquipment: store.listEquipment,
  insertEquipment: store.insertEquipment,
  updateEquipment: store.updateEquipment,
  deleteEquipment: store.deleteEquipment,
}));

import { UPDATE_EQUIPMENT } from './coach-action-equipment.ts';

const seed = (...names: string[]) => {
  store.state.rows = names.map(
    (name, i) =>
      ({
        equipment_id: `seed-${i}`,
        user_id: 'u1',
        name,
        category: 'strength',
        owned: true,
        recommended_by: null,
        linked_goal_ids: [],
        wear: null,
      }) as unknown as Equipment,
  );
};

beforeEach(() => {
  store.state.rows = [];
  store.state.nextId = 1;
  vi.clearAllMocks();
});

describe('update_equipment', () => {
  it('reword renames through a retelling and folds duplicate rows in — the 2026-08-31 dumbbells', () => {
    seed('two 50lb dumbbells', '2x50lb dumbbells', 'pull-up bar');
    return UPDATE_EQUIPMENT.run('u1', {
      item: '2x50lb dumbbells',
      action: 'reword',
      new_label: '2x25lb dumbbells',
    }).then((out) => {
      expect(out).toContain('verified');
      expect(out).toContain('2x25lb dumbbells');
      expect(out).toContain('1 duplicate row');
      expect(store.state.rows.map((r) => r.name)).toEqual(['2x25lb dumbbells', 'pull-up bar']);
    });
  });

  it('add refuses a retelling of something already on file', async () => {
    seed('two 50lb dumbbells');
    const out = await UPDATE_EQUIPMENT.run('u1', { item: '2x50lb dumbbells', action: 'add' });
    expect(out).toContain('already on their file');
    expect(store.state.rows).toHaveLength(1);
  });

  it('add inserts and verifies genuinely new gear', async () => {
    seed('pull-up bar');
    const out = await UPDATE_EQUIPMENT.run('u1', { item: 'rowing machine', action: 'add', category: 'cardio' });
    expect(out).toContain('On file and verified');
    expect(store.state.rows.map((r) => r.name)).toContain('rowing machine');
  });

  it('remove takes every matching row, duplicates included, and verifies the file is clear', async () => {
    seed('Suzuki Book 2', 'Suzuki book', 'piano');
    const out = await UPDATE_EQUIPMENT.run('u1', { item: 'Suzuki book', action: 'remove' });
    expect(out).toContain('Removed');
    expect(out).toContain('verified gone');
    expect(store.state.rows.map((r) => r.name)).toEqual(['piano']);
  });

  it('a miss reports what IS on file instead of pretending', async () => {
    seed('piano');
    const out = await UPDATE_EQUIPMENT.run('u1', { item: 'treadmill', action: 'remove' });
    expect(out).toContain('Nothing on file matches');
    expect(out).toContain('piano');
  });

  it('a lone word never absorbs a longer name — a bike is not a bike trainer', async () => {
    seed('bike trainer');
    const out = await UPDATE_EQUIPMENT.run('u1', { item: 'bike', action: 'add' });
    expect(out).toContain('On file and verified');
    expect(store.state.rows.map((r) => r.name).sort()).toEqual(['bike', 'bike trainer']);
  });
});
