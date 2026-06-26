/**
 * Service – LLM Models Seed
 * ---------------------------
 * Seeds the initial list of available LLM models for each provider
 * on first startup. Auto-categorizes by vendor and generates
 * human-friendly display names from model IDs.
 */

import { listProviders } from '../models/providers.ts';
import { countLlmModels, bulkCreateLlmModels } from '../models/llm-models.ts';

interface CategoryRule {
  test: (id: string) => boolean;
  category: string;
}

interface SeedModelRow {
  model_id: string;
  display_name: string;
  category: string;
}

/* ── Full model catalogue (user-provided) ─────────────────────── */
export const SEED_MODEL_IDS: string[] = [
  'auto',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-codex',
  'gpt-5-azure',
  'gpt-5-mini-azure',
  'gpt-5-nano-azure',
  'gpt-4o-azure',
  'gpt-4o-mini-azure',
  'o3-mini-azure',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'o4-mini',
  'o3-mini',
  'gpt-image-1.5',
  'gpt-image-1',
  'anthropic-claude-3-5-haiku',
  'anthropic-claude-3-7-sonnet',
  'anthropic-claude-4-sonnet',
  'anthropic-claude-4-5-sonnet',
  'anthropic-claude-4-5-haiku',
  'anthropic-claude-4-opus',
  'anthropic-claude-4-1-opus',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-preview',
  'gemini-3-pro',
  'gemini-2.5-flash-preview',
  'gemini-3-flash',
  'gemini-2.5-flash-lite',
  'perplexity-sonar',
  'perplexity-sonar-pro',
  'perplexity-sonar-reasoning',
  'perplexity-sonar-reasoning-pro',
  'perplexity-sonar-deep-research',
  'llama-4-maverick-instruct',
  'llama-4-scout-instruct',
  'deepseek-r1-azure',
  'deepseek-r1',
  'cohere-command',
  'cohere-command-a',
  'cohere-command-r-plus',
  'grok-4',
  'grok-4-fast-reasoning',
  'grok-4-fast-non-reasoning',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1',
  'grok-3-beta',
  'grok-3-mini-beta',
  'grok-2-image',
  'gpt-4',
  'gpt35-16k',
  'o1-azure',
  'anthropic-claude-3-opus',
  'anthropic-claude-3-sonnet',
  'anthropic-claude-3-haiku',
  'anthropic-claude-2.1',
  'meta-llama-3.1-405b-instruct',
  'llama-3-70b-instruct',
  'codellama-70b-instruct',
  'cohere-command-light',
  'cohere-command-r',
  'grok-beta',
  'flux-schnell',
  'flux-1.1-pro',
  'flux-1.1-pro-ultra',
  'flux-1.1-pro-raw',
  'flux-kontext-pro',
  'flux-kontext-max',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'google-imagen-3',
  'google-imagen-3-fast',
  'replicate-google-imagen-4',
  'replicate-google-imagen-4-ultra',
  'replicate-google-imagen-4-fast',
  'stable-diffusion-3',
  'stable-diffusion-3.5-medium',
  'stable-diffusion-3.5-large',
  'stable-diffusion-3.5-large-turbo',
  'ideogram-v3-balanced',
  'ideogram-v3-quality',
  'ideogram-v3-turbo',
  'minimax-image-01',
  'recraft-v3',
  'recraft-v3-svg',
  'bytedance-seedream-3',
  'bytedance-seedream-4',
];

export function isGoogleGeminiCatalogModel(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  return id.startsWith('gemini-') || id.startsWith('google-imagen') || id.startsWith('veo-');
}

export const GOOGLE_GEMINI_SEED_MODEL_IDS: string[] = SEED_MODEL_IDS.filter((id) => isGoogleGeminiCatalogModel(id));
export const DEVS_AI_SEED_MODEL_IDS: string[] = [...SEED_MODEL_IDS];

/* ── Category detection rules (order matters — first match wins) ── */
const CATEGORY_RULES: CategoryRule[] = [
  /* Image generation models (check before general vendor prefixes) */
  {
    test: (id) => /^(flux-|stable-diffusion|ideogram-|minimax-image|recraft-|bytedance-|gpt-image)/.test(id),
    category: 'Image Generation',
  },
  { test: (id) => /^(google-imagen|replicate-google-imagen)/.test(id), category: 'Image Generation' },
  { test: (id) => /(-image$)/.test(id) && !/^grok/.test(id), category: 'Image Generation' },

  /* OpenAI models */
  { test: (id) => /^(gpt-|gpt3|o1-|o3|o4)/.test(id), category: 'OpenAI' },

  /* Anthropic models */
  { test: (id) => /^(anthropic-claude|claude-)/.test(id), category: 'Anthropic' },

  /* Google models */
  { test: (id) => /^gemini-/.test(id), category: 'Google' },

  /* Perplexity models */
  { test: (id) => /^perplexity-/.test(id), category: 'Perplexity' },

  /* Meta / Llama models */
  { test: (id) => /^(llama-|meta-llama|codellama)/.test(id), category: 'Meta' },

  /* DeepSeek models */
  { test: (id) => /^deepseek-/.test(id), category: 'DeepSeek' },

  /* Cohere models */
  { test: (id) => /^cohere-/.test(id), category: 'Cohere' },

  /* xAI / Grok models */
  { test: (id) => /^grok-/.test(id), category: 'xAI' },
];

/**
 * Determine the category for a model ID based on prefix rules.
 */
export function categorizeModel(modelId: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(modelId)) return rule.category;
  }
  return 'Other';
}

/**
 * Generate a human-friendly display name from a model ID.
 * Examples:
 *   gpt-5.2-codex        → GPT 5.2 Codex
 *   anthropic-claude-4-sonnet → Anthropic Claude 4 Sonnet
 *   gemini-2.5-flash-preview  → Gemini 2.5 Flash Preview
 *   o3-mini               → O3 Mini
 *   auto                  → Auto
 */
export function prettifyModelId(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .map((segment) => {
      /* Preserve version-like segments as-is (e.g. "5.2", "3.5", "2.1", "16k") */
      if (/^\d+(\.\d+)?$/.test(segment) || /^\d+[a-z]+$/i.test(segment)) return segment;
      /* Capitalize first letter of each word */
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

/**
 * Seed LLM models for all existing providers.
 * Only inserts if the provider currently has zero models (first-run guard).
 */
export async function seedLlmModels(): Promise<{ seeded: number; skipped: number }> {
  const providers = await listProviders();
  let seeded = 0;
  let skipped = 0;

  for (const provider of providers) {
    const existingCount = await countLlmModels(provider.id);

    if (existingCount > 0) {
      skipped++;
      continue;
    }

    let providerSeedModelIds: string[] = [];
    if (provider.type === 'google-gemini') {
      providerSeedModelIds = GOOGLE_GEMINI_SEED_MODEL_IDS;
    } else if (provider.type === 'devs-ai') {
      providerSeedModelIds = DEVS_AI_SEED_MODEL_IDS;
    }

    if (providerSeedModelIds.length === 0) {
      skipped++;
      continue;
    }

    /* Build seed data with auto-categorization and display names */
    const models: SeedModelRow[] = providerSeedModelIds.map((modelId) => ({
      model_id: modelId,
      display_name: prettifyModelId(modelId),
      category: categorizeModel(modelId),
    }));

    await bulkCreateLlmModels(provider.id, models);
    seeded++;
    console.log(`    [LLM Models] Seeded ${models.length} models for provider "${provider.name}"`);
  }

  return { seeded, skipped };
}
