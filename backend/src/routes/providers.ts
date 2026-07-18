/**
 * Routes – Providers
 * -------------------
 * Admin CRUD for LLM providers (Devs.ai, OpenAI, Anthropic, etc.).
 * Also exposes a "test" endpoint and a proxy to fetch available AIs.
 */

import { Router, Request, Response } from 'express';
import { createProvider, updateProvider, listProviders, getProvider, deleteProvider } from '../models/providers.ts';
import { listAiProfiles } from '../models/ai-profiles.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';
import {
  listLlmModels,
  createLlmModel,
  bulkCreateLlmModels,
  updateLlmModel,
  deleteLlmModel,
} from '../models/llm-models.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import { GoogleGeminiClient } from '../integrations/google-gemini/client.ts';
import {
  categorizeModel,
  prettifyModelId,
  DEVS_AI_SEED_MODEL_IDS,
  isGoogleGeminiCatalogModel,
} from '../services/llm-models-seed.ts';
import { validateBody } from '../middleware/validate.ts';
import { createProviderSchema, updateProviderSchema } from '../schemas/providers.ts';
import { sanitizeProvider } from '../lib/sanitize.ts';
import { z } from 'zod';
import type { LlmModelRow, AiProfileRow } from '../types.ts';

const addModelsSchema = z.object({
  models: z
    .array(
      z.object({
        external_ai_id: z.string().max(200),
        display_name: z.string().max(200).optional(),
        category: z.string().max(100).optional(),
        model_id: z.string().max(200).optional(),
        is_active: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
  model_id: z.string().max(200).optional(),
  display_name: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  is_active: z.boolean().optional(),
});

const updateModelSchema = z.object({
  display_name: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  is_active: z.boolean().optional(),
});

const router = Router();

function filterModelsForProvider(providerType: string, models: LlmModelRow[] = []): LlmModelRow[] {
  if (providerType === 'google-gemini') {
    return models.filter((m) => isGoogleGeminiCatalogModel(m.model_id));
  }
  return models;
}

function modelIdMatchesProvider(providerType: string, modelId: string): boolean {
  if (providerType === 'google-gemini') return isGoogleGeminiCatalogModel(modelId);
  if (providerType === 'devs-ai' || providerType === 'devs-ai-v2') return true;
  return true;
}

function isUuidLike(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

/* ================================================================
   GET /api/providers — list all providers
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req);
    const rows = await listProviders({ cursor: params.cursor ?? undefined, limit: params.limit });
    const result = buildPaginatedResponse(rows, params);
    result.data = result.data.map((p) => sanitizeProvider(p)) as unknown as typeof result.data;
    return res.json(result);
  } catch (err) {
    console.error('[GET /providers]', err);
    return res.status(500).json({ error: 'Failed to list providers' });
  }
});

/* ================================================================
   POST /api/providers — create a new provider
   ================================================================ */

router.post('/', validateBody(createProviderSchema), async (req: Request, res: Response) => {
  try {
    const { name, type, base_url, api_key, is_active, request_timeout_ms } = req.body;

    const row = await createProvider({
      name,
      type: type || 'devs-ai',
      base_url,
      api_key,
      is_active: is_active !== false,
      ...(request_timeout_ms !== undefined && { request_timeout_ms: Number(request_timeout_ms) || null }),
    });

    return res.status(201).json(sanitizeProvider(row));
  } catch (err) {
    console.error('[POST /providers]', err);
    return res.status(500).json({ error: 'Failed to create provider' });
  }
});

/* ================================================================
   GET /api/providers/:id
   ================================================================ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getProvider(req.params.id as string);
    return res.json(sanitizeProvider(row));
  } catch (_err) {
    return res.status(404).json({ error: 'Provider not found' });
  }
});

/* ================================================================
   PUT /api/providers/:id
   ================================================================ */

router.put('/:id', validateBody(updateProviderSchema), async (req: Request, res: Response) => {
  try {
    const updated = await updateProvider(req.params.id as string, req.body);
    return res.json(sanitizeProvider(updated));
  } catch (err) {
    console.error('[PUT /providers/:id]', err);
    return res.status(500).json({ error: 'Failed to update provider' });
  }
});

/* ================================================================
   DELETE /api/providers/:id
   ================================================================ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const profiles = await listAiProfiles(undefined, { limit: 200 });
    const dependents = (profiles || []).filter(
      (p: AiProfileRow) => p.provider_id === id || p.failover_provider_id === id,
    );
    if (dependents.length > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${dependents.length} AI profile(s) reference this provider`,
        dependents: dependents.map((d: AiProfileRow) => ({ id: d.id, name: d.name })),
      });
    }
    await deleteProvider(id);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /providers/:id]', err);
    return res.status(500).json({ error: 'Failed to delete provider' });
  }
});

/* ================================================================
   POST /api/providers/:id/test — test provider connectivity
   ================================================================ */

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const provider = await getProvider(req.params.id as string);

    if (!provider.api_key) {
      return res.status(400).json({ success: false, error: 'Provider has no API key configured' });
    }

    if (provider.type === 'devs-ai') {
      const client = new DevsAiClient(provider.base_url, provider.api_key);
      const ais = await client.listAIs('ALL');
      return res.json({ success: true, ai_count: Array.isArray(ais) ? ais.length : 0 });
    }
    if (provider.type === 'devs-ai-v2') {
      const client = new DevsAiV2Client(provider.base_url, provider.api_key);
      const models = await client.listModels();
      return res.json({
        success: true,
        model_count: models.length,
        message: models.length > 0 ? 'v2 provider reachable' : 'v2 provider reachable (no models listed)',
      });
    }
    if (provider.type === 'google-gemini') {
      const client = new GoogleGeminiClient(provider.base_url, provider.api_key);
      const models = await client.listModels();
      return res.json({ success: true, model_count: Array.isArray(models) ? models.length : 0 });
    }

    /* Future: add test logic for openai, anthropic, etc. */
    return res.json({ success: true, message: 'Connection assumed OK (no test available for this provider type)' });
  } catch (_err) {
    return res.status(400).json({ success: false, error: 'Provider connectivity test failed' });
  }
});

/* ================================================================
   GET /api/providers/:id/ais — list available AIs from the provider
   ================================================================ */

router.get('/:id/ais', async (req: Request, res: Response) => {
  try {
    const provider = await getProvider(req.params.id as string);

    if (provider.type !== 'devs-ai') {
      return res.status(400).json({ error: 'AI listing only supported for Devs.ai providers' });
    }

    if (!provider.api_key) {
      return res.status(400).json({ error: 'Provider has no API key configured' });
    }
    const scope = ((req.query.scope as string) || 'ALL') as 'ALL' | 'OWNED' | 'SHARED';
    const client = new DevsAiClient(provider.base_url, provider.api_key);
    const raw = await client.listAIs(scope);

    const ais = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>)?.content)
        ? ((raw as Record<string, unknown>).content as unknown[])
        : Array.isArray((raw as Record<string, unknown>)?.data)
          ? ((raw as Record<string, unknown>).data as unknown[])
          : [];

    // DIAG: temporary logging to diagnose missing "AppDirect Assistant (Website)" agent — remove after resolved
    const names = ais.map((a) => {
      const ai = a as Record<string, unknown>;
      return { id: ai.id ?? ai.aiId, name: ai.name };
    });
    console.log(
      `[GET /providers/:id/ais] scope=${scope} rawType=${typeof raw} isArray=${Array.isArray(raw)}` +
        ` rawKeys=${!Array.isArray(raw) && raw ? Object.keys(raw as object).join(',') : 'N/A'}` +
        ` count=${ais.length} names=${JSON.stringify(names)}`,
    );

    return res.json(ais);
  } catch (err) {
    console.error('[GET /providers/:id/ais]', err);
    return res.status(500).json({ error: 'Failed to list AIs from provider' });
  }
});

/* ================================================================
   GET /api/providers/:id/models — list LLM models for a provider
   ================================================================ */

router.get('/:id/models', async (req: Request, res: Response) => {
  try {
    const provider = await getProvider(req.params.id as string);
    const models = await listLlmModels(req.params.id as string);
    return res.json(filterModelsForProvider(provider.type, models));
  } catch (err) {
    console.error('[GET /providers/:id/models]', err);
    return res.status(500).json({ error: 'Failed to list models' });
  }
});

/* ================================================================
  POST /api/providers/:id/models/sync — discover provider models
  and upsert them into llm_models for this provider
   ================================================================ */
router.post('/:id/models/sync', async (req: Request, res: Response) => {
  try {
    const provider = await getProvider(req.params.id as string);
    let discoveredModelIds: string[] = [];
    let discoverySource = 'provider-api';
    let discoveryNote: string | null = null;

    if (!provider.api_key) {
      return res.status(400).json({ error: 'Provider has no API key configured' });
    }

    if (provider.type === 'google-gemini') {
      const client = new GoogleGeminiClient(provider.base_url, provider.api_key);
      const models = await client.listModels();
      discoveredModelIds = (models || [])
        .filter(
          (m: { supportedGenerationMethods?: string[]; name?: string }) =>
            Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m: { name?: string }) => String(m?.name || '').trim())
        .filter((name: string) => name.startsWith('models/'))
        .map((name: string) => name.replace(/^models\//, ''))
        .filter(Boolean)
        .filter(
          (id: string) =>
            !(
              id.includes('embedding') ||
              id.includes('imagen') ||
              id.includes('veo') ||
              id.includes('tts') ||
              id.includes('speech') ||
              id.includes('aqa')
            ),
        );
    } else if (provider.type === 'devs-ai' || provider.type === 'devs-ai-v2') {
      const client =
        provider.type === 'devs-ai-v2'
          ? new DevsAiV2Client(provider.base_url, provider.api_key)
          : new DevsAiClient(provider.base_url, provider.api_key);
      try {
        const raw = await client.listModels();
        const filtered = (raw || [])
          .map((id: string) => String(id || '').trim())
          .filter(Boolean)
          .filter((id: string) => !isUuidLike(id));

        /* If provider returns AI IDs (UUIDs) rather than model IDs, fallback to curated catalog. */
        if (filtered.length < 5) {
          discoverySource = 'seed-fallback';
          discoveryNote = 'Provider returned non-model identifiers; used curated seed catalog';
          discoveredModelIds = [...DEVS_AI_SEED_MODEL_IDS];
        } else {
          discoveredModelIds = filtered;
        }
      } catch (_err) {
        discoverySource = 'seed-fallback';
        discoveryNote = 'Provider model list endpoint unavailable; used curated seed catalog';
        discoveredModelIds = [...DEVS_AI_SEED_MODEL_IDS];
      }
    } else {
      return res
        .status(400)
        .json({ error: 'Model discovery is supported for Google Gemini, Devs.ai, and Devs.ai v2 providers' });
    }

    const unique = [...new Set(discoveredModelIds.filter(Boolean))]
      .filter((id) => modelIdMatchesProvider(provider.type, id))
      .sort();
    if (unique.length === 0) {
      return res.json({
        synced: 0,
        discovered: 0,
        refreshedAt: new Date().toISOString(),
        discoverySource,
        discoveryNote,
        models: [],
      });
    }

    const rows = unique.map((modelId) => ({
      model_id: modelId,
      display_name: prettifyModelId(modelId),
      category: categorizeModel(modelId),
      is_active: true,
    }));

    const inserted = await bulkCreateLlmModels(provider.id, rows);
    return res.json({
      synced: inserted.length,
      discovered: unique.length,
      refreshedAt: new Date().toISOString(),
      discoverySource,
      discoveryNote,
      models: inserted,
    });
  } catch (err) {
    console.error('[POST /providers/:id/models/sync]', err);
    return res.status(500).json({ error: 'Failed to sync models' });
  }
});

/* ================================================================
   POST /api/providers/:id/models — add model(s) to a provider
   Supports single { model_id, display_name, category } or
   batch { models: [{ model_id, display_name, category }, ...] }
   ================================================================ */

router.post('/:id/models', validateBody(addModelsSchema), async (req: Request, res: Response) => {
  try {
    const providerId = req.params.id as string;

    /* Batch mode: array of models */
    if (Array.isArray(req.body.models)) {
      const results = await bulkCreateLlmModels(providerId, req.body.models);
      return res.status(201).json(results);
    }

    /* Single mode */
    const { model_id, display_name, category, is_active } = req.body;
    if (!model_id) {
      return res.status(400).json({ error: 'model_id is required' });
    }

    const row = await createLlmModel({
      provider_id: providerId,
      model_id,
      display_name: display_name || model_id,
      category: category || 'Other',
      is_active: is_active !== false,
    });

    return res.status(201).json(row);
  } catch (err) {
    console.error('[POST /providers/:id/models]', err);
    return res.status(500).json({ error: 'Failed to add model' });
  }
});

/* ================================================================
   PUT /api/providers/:providerId/models/:modelId — update a model
   ================================================================ */

router.put('/:providerId/models/:modelId', validateBody(updateModelSchema), async (req: Request, res: Response) => {
  try {
    const { display_name, category, is_active } = req.body;
    const updated = await updateLlmModel(req.params.modelId as string, {
      ...(display_name !== undefined && { display_name }),
      ...(category !== undefined && { category }),
      ...(is_active !== undefined && { is_active }),
    });
    return res.json(updated);
  } catch (err) {
    console.error('[PUT /providers/:providerId/models/:modelId]', err);
    return res.status(500).json({ error: 'Failed to update model' });
  }
});

/* ================================================================
   DELETE /api/providers/:providerId/models/:modelId — remove a model
   ================================================================ */

router.delete('/:providerId/models/:modelId', async (req: Request, res: Response) => {
  try {
    await deleteLlmModel(req.params.modelId as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /providers/:providerId/models/:modelId]', err);
    return res.status(500).json({ error: 'Failed to delete model' });
  }
});

export default router;
