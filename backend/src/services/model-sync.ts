/**
 * Discovering a provider's models, in one place.
 *
 * This lived inside `POST /providers/:id/models/sync` as ~70 lines of handler, reachable only by
 * an owner/admin pressing a button. Nobody pressed it: measured 2026-08-20, the cached catalog held
 * **66** models where the provider then listed **73** — and the seven missing were precisely the
 * ones a model decision needed that hour: `kimi-k2.6`, `kimi-k3`, `grok-4.5`, `grok-4.6`,
 * `qwen3.6-27b`. A stale list is worse than no list; it reads as authoritative while quietly
 * omitting the option you wanted.
 *
 * (A personal Devs.ai key saw 467 models against this provider key's 73 — the catalog is scoped to
 * the account asking, so "how many models exist" has no single answer. Compare like for like.)
 *
 * So the logic moved here, and `tick/models` runs it on a schedule. The route keeps its behaviour
 * by calling this; there is one implementation rather than two that drift.
 *
 * ADDITIVE BY DESIGN. `bulkCreateLlmModels` upserts and nothing here deletes: Devs.ai silently
 * REMOVES model ids (the reason this project pins primary AND failover on catalog-verified ids),
 * and a sync that pruned aggressively could yank the model a live profile points at, mid-turn.
 * A vanished model is reported in `missing` for a human to judge — never deleted underneath one.
 */
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import { GoogleGeminiClient } from '../integrations/google-gemini/client.ts';
import { bulkCreateLlmModels, listLlmModels } from '../models/llm-models.ts';
import {
  categorizeModel,
  prettifyModelId,
  DEVS_AI_SEED_MODEL_IDS,
  isGoogleGeminiCatalogModel,
} from './llm-models-seed.ts';
import type { ProviderRow } from '../types.ts';

export interface ModelSyncResult {
  providerId: string;
  providerName: string;
  synced: number;
  discovered: number;
  /** Ids we hold that the provider no longer lists — reported, never deleted. */
  missing: string[];
  discoverySource: 'provider-api' | 'seed-fallback';
  discoveryNote: string | null;
  refreshedAt: string;
}

function isUuidLike(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function matchesProvider(providerType: string, modelId: string): boolean {
  if (providerType === 'google-gemini') return isGoogleGeminiCatalogModel(modelId);
  return true;
}

/** Ask the provider what it serves. Throws only for a provider type we cannot discover. */
async function discover(
  provider: ProviderRow,
): Promise<{ ids: string[]; source: ModelSyncResult['discoverySource']; note: string | null }> {
  if (provider.type === 'google-gemini') {
    const client = new GoogleGeminiClient(provider.base_url, provider.api_key as string);
    const models = await client.listModels();
    const ids = (Array.isArray(models) ? models : [])
      .map((m) => String((m as { name?: string }).name || m))
      .map((n) => n.replace(/^models\//, ''));
    return { ids, source: 'provider-api', note: null };
  }

  if (provider.type === 'devs-ai' || provider.type === 'devs-ai-v2') {
    const client =
      provider.type === 'devs-ai-v2'
        ? new DevsAiV2Client(provider.base_url, provider.api_key as string)
        : new DevsAiClient(provider.base_url, provider.api_key as string);
    try {
      const raw = await client.listModels();
      const filtered = (raw || [])
        .map((id: string) => String(id || '').trim())
        .filter(Boolean)
        // A provider that answers with AI ids (UUIDs) is not answering with MODEL ids.
        .filter((id: string) => !isUuidLike(id));
      if (filtered.length < 5) {
        return {
          ids: [...DEVS_AI_SEED_MODEL_IDS],
          source: 'seed-fallback',
          note: 'Provider returned non-model identifiers; used curated seed catalog',
        };
      }
      return { ids: filtered, source: 'provider-api', note: null };
    } catch {
      return {
        ids: [...DEVS_AI_SEED_MODEL_IDS],
        source: 'seed-fallback',
        note: 'Provider model list endpoint unavailable; used curated seed catalog',
      };
    }
  }

  throw new Error(`Model discovery is not supported for provider type "${provider.type}"`);
}

/** Discover and upsert one provider's models. Never deletes; reports what vanished. */
export async function syncProviderModels(provider: ProviderRow): Promise<ModelSyncResult> {
  if (!provider.api_key) throw new Error('Provider has no API key configured');

  const { ids, source, note } = await discover(provider);
  const unique = [...new Set(ids.filter(Boolean))].filter((id) => matchesProvider(provider.type, id)).sort();

  const held = await listLlmModels(provider.id).catch(() => []);
  const heldIds = new Set((held ?? []).map((m) => String((m as { model_id?: string }).model_id ?? '')));
  const missing = [...heldIds].filter((id) => id && !unique.includes(id));

  const base: ModelSyncResult = {
    providerId: provider.id,
    providerName: provider.name,
    synced: 0,
    discovered: unique.length,
    missing,
    discoverySource: source,
    discoveryNote: note,
    refreshedAt: new Date().toISOString(),
  };
  if (unique.length === 0) return base;

  const inserted = await bulkCreateLlmModels(
    provider.id,
    unique.map((modelId) => ({
      model_id: modelId,
      display_name: prettifyModelId(modelId),
      category: categorizeModel(modelId),
      is_active: true,
    })),
  );
  return { ...base, synced: inserted.length };
}
