import { sql, json } from '../db/sql.ts';
import type { Equipment, EquipmentWear } from '@cadence/shared';

export async function listEquipment(userId: string): Promise<Equipment[]> {
  return sql<Equipment[]>`select * from cadence.equipment where user_id = ${userId}`;
}

/** Clear all equipment for a user (used to replace the captured set during onboarding). */
export async function deleteAllEquipment(userId: string): Promise<void> {
  await sql`delete from cadence.equipment where user_id = ${userId}`;
}

/** User edit from the review wizard — update name/category (null keeps existing). */
export async function updateEquipment(userId: string, equipmentId: string, f: Partial<Equipment>): Promise<void> {
  await sql`
    update cadence.equipment set
      name = coalesce(${f.name ?? null}, name),
      category = coalesce(${f.category ?? null}, category)
    where user_id = ${userId} and equipment_id = ${equipmentId}`;
}

/** User reject from the review wizard. */
export async function deleteEquipment(userId: string, equipmentId: string): Promise<void> {
  await sql`delete from cadence.equipment where user_id = ${userId} and equipment_id = ${equipmentId}`;
}

export async function insertEquipment(userId: string, eq: Partial<Equipment>): Promise<Equipment> {
  const [row] = await sql<Equipment[]>`
    insert into cadence.equipment (user_id, name, category, owned, recommended_by, wear)
    values (
      ${userId}, ${eq.name ?? ''}, ${eq.category ?? 'other'}, ${eq.owned ?? true},
      ${eq.recommended_by ?? null}, ${eq.wear ? json(eq.wear) : null}
    )
    returning *`;
  if (!row) throw new Error('insertEquipment: no row returned');
  return row;
}

/** The user's single active footwear (spec §A2: one active pair, mileage accrues to it). */
export async function getActiveFootwear(userId: string): Promise<Equipment | null> {
  const [row] = await sql<Equipment[]>`
    select * from cadence.equipment
    where user_id = ${userId} and category = 'footwear' and wear->>'status' = 'active'
    limit 1`;
  return row ?? null;
}

export async function updateWear(
  userId: string,
  equipmentId: string,
  wear: EquipmentWear,
): Promise<void> {
  await sql`
    update cadence.equipment set wear = ${json(wear)}
    where user_id = ${userId} and equipment_id = ${equipmentId}`;
}
