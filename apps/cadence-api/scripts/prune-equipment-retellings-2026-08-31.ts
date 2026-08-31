/**
 * One-shot cleanup, 2026-08-31 (second round): the coach's update_equipment and the Broker's
 * capture both wrote the owner's gear list in the same hour, and capture re-emitted several items
 * under its own canonical phrasings that token matching cannot bridge ("workout ball (big one for
 * abs)" vs "stability ball"). Rule applied: THE USER'S OWN WORDS WIN (BRAND.md) — every kept row
 * is a phrasing the owner typed at 11:35; every dropped row is the extractor's rename of the same
 * physical object. Nothing the owner owns disappears; only second names for it do.
 */
import { listEquipment, deleteEquipment } from '../src/repos/equipment.ts';

const USER = '91e914fa-f014-4e26-accf-c50ca316660e';

/** exact names to drop → the kept row they duplicate (for the report). */
const DROP: Record<string, string> = {
  'rowing machine': 'row machine',
  bike: 'bike (regular and stationary)',
  'stationary bike': 'bike (regular and stationary)',
  'TRX suspension trainer': 'trx ropes',
  'kettlebells (12lb, 2x20lb, 24kg, 32kg)': 'full set of kettlebells (1x12lb, 2x20, 2x40, 1x24kg, 1x32kg)',
  'resistance bands': 'various bands',
  'stability ball': 'workout ball (big one for abs)',
  '125lb medecine ball': '125lb medicine ball',
};

const rows = await listEquipment(USER);
for (const row of rows) {
  const keeper = DROP[row.name];
  if (!keeper) continue;
  const keeperExists = rows.some((r) => r.name === keeper);
  if (!keeperExists) {
    console.log(`skip "${row.name}" — keeper "${keeper}" not found, leaving it alone`);
    continue;
  }
  await deleteEquipment(USER, row.equipment_id);
  console.log(`dropped "${row.name}" (a retelling of "${keeper}")`);
}
console.log('\nOn file now:');
for (const r of await listEquipment(USER)) console.log(` - ${r.name}`);
process.exit(0);
