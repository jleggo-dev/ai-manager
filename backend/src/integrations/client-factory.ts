import { DevsAiClient } from './devs-ai/client.ts';
import { GoogleGeminiClient } from './google-gemini/client.ts';
import { resolveApiKeyForUser } from '../models/user-provider-credentials.ts';
import type { ProviderRow } from '../types.ts';

/**
 * Create an LLM client instance from a provider row.
 * Uses the provider-level API key (shared across users).
 */
export function createLlmClientForProvider(provider: ProviderRow): DevsAiClient | GoogleGeminiClient {
  if (!provider.api_key) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  const type = String(provider?.type || '')
    .trim()
    .toLowerCase();
  if (type === 'devs-ai' || !type) {
    return new DevsAiClient(provider.base_url, provider.api_key);
  }
  if (type === 'google-gemini') {
    return new GoogleGeminiClient(provider.base_url, provider.api_key);
  }
  throw new Error(`Unsupported provider type "${provider?.type}"`);
}

/**
 * Create an LLM client using the user's personal API key when available,
 * falling back to the provider-level key. Works for any provider type.
 */
export async function createLlmClientForUser(
  provider: ProviderRow,
  userId: string | null,
): Promise<DevsAiClient | GoogleGeminiClient> {
  const apiKey = await resolveApiKeyForUser(userId, provider);
  if (!apiKey) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  const type = String(provider?.type || '')
    .trim()
    .toLowerCase();
  if (type === 'devs-ai' || !type) {
    return new DevsAiClient(provider.base_url, apiKey);
  }
  if (type === 'google-gemini') {
    return new GoogleGeminiClient(provider.base_url, apiKey);
  }
  throw new Error(`Unsupported provider type "${provider?.type}"`);
}

/**
 * Convenience: create a DevsAiClient using user's personal key if available.
 */
export async function createDevsAiClientForUser(provider: ProviderRow, userId: string | null): Promise<DevsAiClient> {
  const apiKey = await resolveApiKeyForUser(userId, provider);
  if (!apiKey) {
    throw new Error(`Provider "${provider.name}" has no API key configured`);
  }
  return new DevsAiClient(provider.base_url, apiKey);
}
