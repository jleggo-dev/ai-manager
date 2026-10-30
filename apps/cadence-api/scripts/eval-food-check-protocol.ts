/**
 * One meal through the food-check: the model asks for lookups, the REAL fan-out answers
 * (`fanOutFoodSources` — what `check_food_sources` runs), and the model picks from what it saw.
 *
 * WHY ROUNDS OF SINGLE CALLS AND NOT NATIVE TOOL CALLS. The deployed AI Admin's HTTP chat routes
 * carry no app-side tool definitions (the coach passes `extraTools` in-process, which needs the
 * provider key this machine does not hold). So each round is one `/test` run of an e2e job, and
 * the model "calls" the lookup by replying `{"lookups":[…]}`. That measures what this eval is for
 * — the judgement over real lookup results — and not native function-calling, which the coach
 * already runs on Devs.ai. The write-up says so.
 */
import type { FanOutResult } from '../src/services/food-source-fanout.ts';
import type { FinalItem, ShownCandidate } from './eval-food-check-score.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';

export const MAX_ROUNDS = 4;
const MAX_LOOKUPS_PER_ROUND = 8;
const SHOW_PER_LOOKUP = 6;

export interface Lookup {
  q: string;
  measure?: string | null;
  brand?: string | null;
}

export interface RoundRun {
  raw: string;
  ms: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface MealRun {
  rounds: RoundRun[];
  lookups: Lookup[];
  final: FinalItem[] | null;
  shown: Map<string, ShownCandidate>;
  error: string | null;
}

const fmt = (n: number | null | undefined, dp = 0) => (typeof n === 'number' ? n.toFixed(dp) : '?');

/**
 * One entry per label. The record's headline measure is usually in its list too, and listing it
 * twice made every match on it ambiguous — which the matcher rightly refuses (2026-10-29 run).
 */
export function uniqueMeasures(ms: Array<{ label: string; grams: number }>): Array<{ label: string; grams: number }> {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = m.label.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Builds the per-meal id space: the same record seen twice keeps its first id. */
export class CandidateBook {
  readonly shown = new Map<string, ShownCandidate>();
  private byKey = new Map<string, string>();

  render(l: Lookup, r: FanOutResult): string {
    const head = `Lookup "${l.q}"${l.brand ? ` brand ${l.brand}` : ''}${l.measure ? ` at ${l.measure}` : ''}:`;
    if (!r.candidates.length) return `${head}\n  no records on file`;
    const lines = r.candidates.slice(0, SHOW_PER_LOOKUP).map((c) => {
      const key = `${c.source}|${c.food_id ?? ''}|${c.name}|${c.brand ?? ''}`;
      let id = this.byKey.get(key);
      const g = c.per.grams;
      const n = c.per.nutrients as Record<string, number | undefined>;
      const perG = (k: string) => (g && typeof n[k] === 'number' ? (n[k] as number) / g : null);
      if (!id) {
        id = `c${this.shown.size + 1}`;
        this.byKey.set(key, id);
        this.shown.set(id, {
          id,
          name: c.name,
          per_g: { kcal: perG('kcal'), protein_g: perG('protein_g') },
          measures: uniqueMeasures([...c.measures, ...(g ? [{ label: c.per.measure, grams: g }] : [])]),
        });
      }
      const per100 = (k: string) => fmt(perG(k) === null ? null : (perG(k) as number) * 100, 1);
      const measures = this.shown.get(id)!.measures.map((m) => `${m.label} = ${fmt(m.grams, 1)} g`);
      return (
        `  ${id} · ${c.source} · ${c.name}${c.brand ? ` (${c.brand})` : ''} · per 100 g: ${per100('kcal')} kcal, ` +
        `${per100('protein_g')} g protein, ${per100('carbs_g')} g carbs, ${per100('fat_g')} g fat · ` +
        `measures: ${measures.join('; ') || 'grams only'} · completeness: ${c.completeness}` +
        (c.notes.length ? ` · notes: ${c.notes.join('; ')}` : '')
      );
    });
    return [head, ...lines].join('\n');
  }
}

export function buildPrompt(c: FoodCheckCase, results: string[], lastRound: boolean): string {
  return [
    'You check one meal a person logged. You decide which food records describe what they ate.',
    '',
    `Meal: ${c.meal}. What they said: "${c.text}"`,
    '',
    'Reply with ONE JSON object and nothing else.',
    '',
    `To look foods up, reply {"lookups":[{"q":"food name","measure":"1 cup","brand":null}]}. At most ${MAX_LOOKUPS_PER_ROUND} lookups per reply. Look up each part of the meal separately. Put the plain food name in q. Put a brand only if they named one. measure is optional.`,
    '',
    'When you have what you need, reply {"final":{"items":[ ... ]}} with one entry per part of the meal:',
    '{"said":"their words for this part","pick":"c3","measure":"1 cup","count":1.5,"assumption":null,"question":null,"estimate":null}',
    '',
    'Rules:',
    '- pick must be an id shown in the lookup results below. Never invent an id.',
    '- measure must be one of the measures listed for that record, or "g" with count = grams.',
    '- count multiplies the measure.',
    '- Do not write calories or protein for a picked record. They are worked out from the record.',
    '- If no record fits, set pick to null and give estimate as {"kcal":number,"protein_g":number}. It is shown to the person as your estimate.',
    '- If the words leave the amount or the kind open, still answer. Write what you assumed in assumption, or the one question you would ask in question.',
    '- Where records disagree, choose the one that matches what they said. Say why in assumption when it changes the numbers.',
    '',
    'Lookup results so far:',
    results.length ? results.join('\n\n') : '(none yet)',
    ...(lastRound ? ['', 'This is your last reply. Answer with final now.'] : []),
  ].join('\n');
}

/** The first JSON object in a reply — models wrap JSON in prose or fences more often than not. */
export function firstJson(raw: string): Record<string, unknown> | null {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const v = JSON.parse(raw.slice(s, e + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readLookups(o: Record<string, unknown>): Lookup[] {
  const arr = Array.isArray(o.lookups) ? o.lookups : [];
  return arr
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof (l as Lookup).q === 'string')
    .slice(0, MAX_LOOKUPS_PER_ROUND)
    .map((l) => ({
      q: String(l.q).trim().slice(0, 80),
      measure: typeof l.measure === 'string' ? l.measure : null,
      brand: typeof l.brand === 'string' ? l.brand : null,
    }))
    .filter((l) => l.q);
}

export function readFinal(o: Record<string, unknown>): FinalItem[] | null {
  const f = o.final as { items?: unknown } | undefined;
  return f && Array.isArray(f.items) ? (f.items as FinalItem[]) : null;
}

export interface MealDeps {
  run: (prompt: string) => Promise<RoundRun>;
  lookup: (l: Lookup) => Promise<FanOutResult>;
}

export async function runMeal(c: FoodCheckCase, deps: MealDeps): Promise<MealRun> {
  const book = new CandidateBook();
  const results: string[] = [];
  const out: MealRun = { rounds: [], lookups: [], final: null, shown: book.shown, error: null };
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let r: RoundRun;
    try {
      r = await deps.run(buildPrompt(c, results, round === MAX_ROUNDS));
    } catch (e) {
      out.error = `round ${round} failed: ${String(e).slice(0, 200)}`;
      return out;
    }
    out.rounds.push(r);
    const o = firstJson(r.raw);
    if (!o) {
      out.error = `round ${round}: no JSON in reply`;
      return out;
    }
    const final = readFinal(o);
    if (final) {
      out.final = final;
      return out;
    }
    const lookups = readLookups(o);
    if (!lookups.length) {
      out.error = `round ${round}: neither lookups nor final`;
      return out;
    }
    out.lookups.push(...lookups);
    const found = await Promise.all(lookups.map((l) => deps.lookup(l)));
    found.forEach((f, i) => results.push(book.render(lookups[i]!, f)));
  }
  out.error = `no final answer after ${MAX_ROUNDS} rounds`;
  return out;
}
