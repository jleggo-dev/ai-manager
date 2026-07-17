/**
 * Backfill vision parses for meal photos logged BEFORE the engine could see (capture-first era),
 * or whose parse failed. Re-runs parse-meal with the stored photo for rows that have a photo_ref
 * but no items AND no macros; fills items/est/flags/macros/confidence/provisional in place.
 * The user's raw_text (if any) rides along as the caption.
 *
 * Run: node --import tsx apps/cadence-api/scripts/backfill-meal-photos.ts <user-id-or-slug> [limit]
 *      (slug 'account-1' / 'account-2' accepted; limit defaults to 25 per run)
 */
import { cadenceConfig } from '../src/config.ts';
import { sql } from '../src/db/sql.ts';
import { runJobBySlug } from '../src/ai/aim.ts';
import { signMealPhotoUrl } from '../src/services/meal-photos.ts';
import { sanitizeMacros } from '../src/services/nutrition-day.ts';
import { updateNutritionLog } from '../src/repos/nutrition.ts';
import type { NutritionLog } from '@cadence/shared';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: backfill-meal-photos.ts <user-id-or-slug> [limit]');
  process.exit(1);
}
const userId = cadenceConfig.devAccounts[arg] ?? arg;
const limit = Math.min(100, Math.max(1, Number(process.argv[3]) || 25));

const rows = await sql<Array<Pick<NutritionLog, 'log_id' | 'meal' | 'raw_text' | 'photo_ref'> & { date: string }>>`
  select log_id, to_char(date, 'YYYY-MM-DD') as date, meal, raw_text, photo_ref
  from cadence.nutrition_logs
  where user_id = ${userId} and photo_ref is not null
    and (items = '[]'::jsonb or items is null) and (macros = '{}'::jsonb or macros is null)
  order by date desc
  limit ${limit}`;

console.log(`backfilling ${rows.length} photo meal(s) for ${arg}…`);
let filled = 0;
for (const row of rows) {
  try {
    const url = await signMealPhotoUrl(row.photo_ref!);
    const res = await runJobBySlug(
      userId,
      'parse-meal',
      { meal_text: row.raw_text || '(no caption — read the photo)', meal_hint: row.meal ?? '' },
      { images: [url] },
    );
    const parsed = JSON.parse(res.formatted ?? res.raw ?? '{}') as Record<string, unknown>;
    const items = (Array.isArray(parsed.items) ? (parsed.items as Array<Record<string, unknown>>) : [])
      .filter((i) => i && typeof i.name === 'string' && (i.name as string).trim())
      .slice(0, 12)
      .map((i) => {
        const est = sanitizeMacros(i.est);
        return {
          name: (i.name as string).trim(),
          ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
          ...(typeof i.unit === 'string' && (i.unit as string).trim() ? { unit: (i.unit as string).trim() } : {}),
          ...(est ? { est } : {}),
        };
      });
    const est = sanitizeMacros(parsed.est_macros);
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : null;
    if (!items.length && !est) {
      console.log(`  - ${row.log_id.slice(0, 8)} (${row.date}): nothing readable — left as-is`);
      continue;
    }
    await updateNutritionLog(userId, row.log_id, {
      ...(items.length ? { items } : {}),
      ...(est ? { macros: { ...est, source: 'ai' } } : {}),
      ai_confidence: confidence,
      provisional: !!est && confidence !== null && confidence < 0.5,
    });
    filled++;
    console.log(
      `  ✓ ${row.log_id.slice(0, 8)} (${row.date}): ${items.map((i) => i.name).join(', ') || '(items unchanged)'}${est ? ` · ~${est.kcal ?? '?'} kcal` : ''}`,
    );
  } catch (e) {
    console.warn(`  ! ${row.log_id.slice(0, 8)} failed:`, (e as Error).message.slice(0, 160));
  }
}
console.log(`done — ${filled}/${rows.length} filled.`);
await sql.end();
process.exit(0);
