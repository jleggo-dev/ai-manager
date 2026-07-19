import { DevsAiClient } from './devs-ai/client.ts';
import { DevsAiV2Client } from './devs-ai-v2/client.ts';
import { GoogleGeminiClient } from './google-gemini/client.ts';
import { resolveApiKeyForUser } from '../models/user-provider-credentials.ts';
import type { ProviderRow } from '../types.ts';

export type LlmClientInstance = DevsAiClient | DevsAiV2Client | GoogleGeminiClient;

function createClientForType(type: string, baseUrl: string, apiKey: string): LlmClientInstance {
  const normalized = String(type || '')
    .trim()
    .toLowerCase();
  if (normalized === 'devs-ai-v2') return new DevsAiV2Client(baseUrl, apiKey);
  if (normalized === 'google-gemini') return new GoogleGeminiClient(baseUrl, apiKey);
  if (normalized === 'devs-ai' || !normalized) return new DevsAiClient(baseUrl, apiKey);
  throw new Error(`Unsupported provider type "${type}"`);
}

/**
 * Create an LLM client instance from a provider row.
 * Uses the provider-level API key (shared across users).
 */
export function createLlmClientForProvider(provider: ProviderRow): LlmClientInstance {
  if (!provider.api_key) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  return createClientForType(provider.type, provider.base_url, provider.api_key);
}

/**
 * Create an LLM client using the user's personal API key when available,
 * falling back to the provider-level key. Works for any provider type.
 */
export async function createLlmClientForUser(provider: ProviderRow, userId: string | null): Promise<LlmClientInstance> {
  const apiKey = await resolveApiKeyForUser(userId, provider);
  if (!apiKey) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  return createClientForType(provider.type, provider.base_url, apiKey);
}

/**
 * Convenience: create a DevsAiClient using user's personal key if available.
 */
export async function createDevsAiClientForUser(provider: ProviderRow, userId: string | null): Promise<DevsAiClient> {
  const apiKey = await resolveApiKeyForUser(userId, provider);
  if (!apiKey) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  const type = String(provider?.type || '')
    .trim()
    .toLowerCase();
  if (type !== 'devs-ai' && type !== '') {
    throw new Error(`createDevsAiClientForUser requires devs-ai provider, got "${provider.type}"`);
  }
  return new DevsAiClient(provider.base_url, apiKey);
}

/**
 * Convenience: create a DevsAiV2Client using user's personal key if available.
 */
export async function createDevsAiV2ClientForUser(
  provider: ProviderRow,
  userId: string | null,
): Promise<DevsAiV2Client> {
  const apiKey = await resolveApiKeyForUser(userId, provider);
  if (!apiKey) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  if (
    String(provider.type || '')
      .trim()
      .toLowerCase() !== 'devs-ai-v2'
  ) {
    throw new Error(`createDevsAiV2ClientForUser requires devs-ai-v2 provider, got "${provider.type}"`);
  }
  return new DevsAiV2Client(provider.base_url, apiKey);
}
