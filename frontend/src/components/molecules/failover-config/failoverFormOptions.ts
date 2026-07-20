import type { LlmModel } from '../../../types/api';

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

export function mapAiOptions(availableAis: ProviderAi[]) {
  return availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));
}

export function buildModelOptions(availableModels: LlmModel[]) {
  const active = availableModels.filter((m) => m.is_active);
  const groups: Record<string, { value: string; label: string }[]> = {};
  for (const m of active) {
    const g = m.category || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push({ value: m.model_id, label: m.display_name || m.model_id });
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

export type { ProviderAi };
