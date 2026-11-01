import { sql } from '../db/sql.ts';

/**
 * The phrase memory (0063): what someone's own words for a food resolved to, once the
 * food-check picked a record and they confirmed it. services/food-phrases.ts normalises the
 * phrase and decides when to write; this file only reads and writes rows.
 */
export interface FoodPhraseRow {
  phrase: string;
  food_id: string;
  qty: number;
  unit: string | null;
  uses: number;
}

/** Write or overwrite one phrase → food link. The newest confirmed pick is the person's usual. */
export async function rememberFoodPhrase(
  userId: string,
  link: { phrase: string; food_id: string; qty: number; unit: string | null },
): Promise<void> {
  const phrase = link.phrase.trim();
  if (!phrase || !(link.qty > 0)) return;
  await sql`
    insert into cadence.food_phrases (user_id, phrase, food_id, qty, unit)
    values (${userId}, ${phrase}, ${link.food_id}, ${link.qty}, ${link.unit})
    on conflict (user_id, phrase) do update
      set food_id      = excluded.food_id,
          qty          = excluded.qty,
          unit         = excluded.unit,
          uses         = cadence.food_phrases.uses + 1,
          last_used_at = now()`;
}

/** The links this person holds for these phrases, keyed by phrase. Unknown phrases are absent. */
export async function recallFoodPhrases(userId: string, phrases: string[]): Promise<Map<string, FoodPhraseRow>> {
  const wanted = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].slice(0, 20);
  if (!wanted.length) return new Map();
  const rows = await sql<FoodPhraseRow[]>`
    select phrase, food_id, qty::float8 as qty, unit, uses
      from cadence.food_phrases
     where user_id = ${userId} and phrase in ${sql(wanted)}`;
  return new Map(rows.map((r) => [r.phrase, r]));
}

/** Everything this person has taught the memory — for the dev reset and for tests. */
export async function deleteFoodPhrases(userId: string): Promise<number> {
  const rows = await sql`delete from cadence.food_phrases where user_id = ${userId} returning phrase_id`;
  return rows.length;
}
