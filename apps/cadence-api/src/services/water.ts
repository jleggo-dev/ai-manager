import { insertWaterLog, sumWaterMl } from '../repos/water.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Water (0037) — deliberately the simplest thing in the food module. No AI, no parse, no
 * provisional state: the user (or the coach, relaying the user's own stated amount) says how
 * much, and the amount is the amount. A pour writes one row; the surfaces read the day's sum.
 */
export async function logWater(userId: string, ml: number, date?: string): Promise<{ date: string; water_ml: number }> {
  const d = date ?? today();
  await insertWaterLog(userId, { date: d, ml });
  return { date: d, water_ml: await sumWaterMl(userId, d) };
}
