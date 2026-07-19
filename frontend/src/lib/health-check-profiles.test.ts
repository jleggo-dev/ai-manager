import { describe, expect, it } from 'vitest';
import type { HcProviderKey, LlmModel, Provider } from '../types/api';
import {
  buildAiOptions,
  buildModelOptions,
  filterEligibleProviders,
  filterKeysForProvider,
  isModelOnlyProviderType,
  resolveProviderName,
} from './health-check-profiles';

function makeProvider(overrides: Partial<Provider> & Pick<Provider, 'id' | 'name'>): Provider {
  return {
    type: 'devs-ai',
    base_url: 'https://example.com',
    is_active: true,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    request_timeout_ms: null,
    ...overrides,
  };
}

function makeKey(
  overrides: Partial<HcProviderKey> & Pick<HcProviderKey, 'id' | 'provider_id' | 'name'>,
): HcProviderKey {
  return {
    workspace_id: 'ws-1',
    user_id: 'user-1',
    is_active: true,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

function makeModel(overrides: Partial<LlmModel> & Pick<LlmModel, 'model_id'>): LlmModel {
  return {
    id: overrides.model_id,
    provider_id: 'p1',
    display_name: overrides.model_id,
    category: 'chat',
    is_active: true,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

describe('filterEligibleProviders', () => {
  it('keeps only providers that have at least one HC key', () => {
    const providers = [
      makeProvider({ id: 'p1', name: 'Devs.ai' }),
      makeProvider({ id: 'p2', name: 'Gemini', type: 'google-gemini' }),
    ];
    const keys = [makeKey({ id: 'k1', provider_id: 'p1', name: 'Key' })];

    expect(filterEligibleProviders(providers, keys).map((p) => p.id)).toEqual(['p1']);
  });

  it('returns empty when no keys are configured', () => {
    const providers = [makeProvider({ id: 'p1', name: 'Devs.ai' })];
    expect(filterEligibleProviders(providers, [])).toEqual([]);
  });
});

describe('filterKeysForProvider', () => {
  it('filters keys to the selected provider', () => {
    const keys = [
      makeKey({ id: 'k1', provider_id: 'p1', name: 'A' }),
      makeKey({ id: 'k2', provider_id: 'p2', name: 'B' }),
      makeKey({ id: 'k3', provider_id: 'p1', name: 'C' }),
    ];
    expect(filterKeysForProvider(keys, 'p1').map((k) => k.id)).toEqual(['k1', 'k3']);
  });
});

describe('buildAiOptions', () => {
  it('prefers id, then aiId, for the option value', () => {
    expect(
      buildAiOptions([
        { id: 'a1', name: 'Agent One' },
        { aiId: 'a2', name: 'Agent Two' },
      ]),
    ).toEqual([
      { value: 'a1', label: 'Agent One' },
      { value: 'a2', label: 'Agent Two' },
    ]);
  });
});

describe('buildModelOptions', () => {
  it('groups active models by category and skips inactive ones', () => {
    const models = [
      makeModel({ model_id: 'gpt-4o', display_name: 'GPT-4o', category: 'OpenAI' }),
      makeModel({ model_id: 'claude', display_name: 'Claude', category: 'Anthropic' }),
      makeModel({ model_id: 'old', display_name: 'Old', category: 'OpenAI', is_active: false }),
      makeModel({ model_id: 'misc', display_name: 'Misc', category: '' }),
    ];

    expect(buildModelOptions(models)).toEqual([
      { group: 'OpenAI', items: [{ value: 'gpt-4o', label: 'GPT-4o' }] },
      { group: 'Anthropic', items: [{ value: 'claude', label: 'Claude' }] },
      { group: 'Other', items: [{ value: 'misc', label: 'Misc' }] },
    ]);
  });
});

describe('resolveProviderName', () => {
  it('returns the provider name or falls back to the id', () => {
    const providers = [makeProvider({ id: 'p1', name: 'Devs.ai' })];
    expect(resolveProviderName(providers, 'p1')).toBe('Devs.ai');
    expect(resolveProviderName(providers, 'missing')).toBe('missing');
  });
});

describe('isModelOnlyProviderType', () => {
  it('treats google-gemini as model-only', () => {
    expect(isModelOnlyProviderType('google-gemini')).toBe(true);
    expect(isModelOnlyProviderType('devs-ai')).toBe(false);
  });
});
