/**
 * Pure helpers for Health Check Profiles form/list derivation.
 * Extracted alongside useHealthCheckProfilesData (FE-08) so option builders
 * and eligibility filtering stay unit-testable without a React tree.
 */

import type { HcProviderKey, LlmModel, Provider } from '../types/api';

export interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOptionGroup {
  group: string;
  items: SelectOption[];
}

/** Providers that have at least one HC key configured. */
export function filterEligibleProviders(providers: Provider[], providerKeys: HcProviderKey[]): Provider[] {
  const keyProviderIds = new Set(providerKeys.map((k) => k.provider_id));
  return providers.filter((p) => keyProviderIds.has(p.id));
}

/** Keys belonging to the currently selected provider. */
export function filterKeysForProvider(providerKeys: HcProviderKey[], providerId: string): HcProviderKey[] {
  return providerKeys.filter((k) => k.provider_id === providerId);
}

/** Build Select options for Devs.ai-style agent listings (id/aiId, not external_ai_id). */
export function buildAiOptions(availableAis: ProviderAi[]): SelectOption[] {
  return availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));
}

/** Build Select options for models, grouped by category (active models only). */
export function buildModelOptions(availableModels: LlmModel[]): SelectOptionGroup[] {
  const activeModels = availableModels.filter((m) => m.is_active);
  const groups: Record<string, SelectOption[]> = {};
  for (const m of activeModels) {
    const g = m.category || 'Other';
    if (!groups[g]) groups[g] = [];
    const group = groups[g] ?? (groups[g] = []);
    group.push({ value: m.model_id, label: m.display_name || m.model_id });
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

export function resolveProviderName(providers: Provider[], id: string): string {
  return providers.find((p) => p.id === id)?.name ?? id;
}

export function isModelOnlyProviderType(providerType: string): boolean {
  return providerType === 'google-gemini';
}
