/**
 * Req 5 Phase 5 — scoped recipe discovery (LLM structure, not live web search).
 * Confirm-before-save via existing POST /nutrition/recipes.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { getDietaryProfile } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { parseGenerateRecipeResult } from './fridge-parse.ts';
import { buildDraftFromStructured, type RecipeDraft } from './recipe.ts';

export interface DiscoverRecipesResult {
  drafts: RecipeDraft[];
  notes: string | null;
  filtered_allergy: number;
}

/**
 * Query → 1–3 unsaved recipe drafts (dietary-safe). Real web retrieval stays
 * behind the future cadence-research agent.
 */
export async function discoverRecipes(userId: string, query: string): Promise<DiscoverRecipesResult> {
  const q = query.trim().slice(0, 200);
  if (!q) throw new Error('query required');

  const profile = await getDietaryProfile(userId);
  const allergies = (profile?.allergies ?? []).join(', ');
  const diet = profile?.diet?.trim() || '';
  const dislikes = (profile?.dislikes ?? []).join(', ');

  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'discover-recipe', {
      query: q,
      allergies,
      diet,
      dislikes,
    });
    rawOut = res.formatted ?? res.raw ?? '';
  } catch (e) {
    console.warn('[recipe-discover] discover-recipe failed:', e);
    throw e instanceof Error ? e : new Error('discover-recipe failed');
  }

  const bundle = parseGenerateRecipeResult(rawOut);
  const drafts: RecipeDraft[] = [];
  let filtered_allergy = 0;

  for (let i = 0; i < bundle.recipes.length; i++) {
    const structured = bundle.recipes[i]!;
    const tags = bundle.tags[i] ?? [];
    const draft = await buildDraftFromStructured(userId, structured, 'ai', tags);
    if (!draft.dietary.safe) {
      filtered_allergy += 1;
      console.info('[recipe-discover] dropped allergen-flagged idea:', draft.name);
      continue;
    }
    drafts.push(draft);
  }

  let notes = bundle.notes;
  if (drafts.length === 0) {
    notes =
      notes ||
      (filtered_allergy > 0
        ? "I couldn't find ideas that stay clear of your allergies — try a different dish or cuisine."
        : "I couldn't shape recipes from that — try a clearer dish name or cuisine.");
  }

  void logAi(userId, {
    kind: 'discover_recipe',
    input: { query: q },
    output: { raw: rawOut.slice(0, 2000) },
    meta: { drafts: drafts.length, filtered_allergy, generated: bundle.recipes.length },
  });

  return { drafts, notes, filtered_allergy };
}
