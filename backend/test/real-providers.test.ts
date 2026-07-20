/**
 * Unit tests for real-provider discovery helpers used by live e2e suites.
 */
import { describe, it, expect } from 'vitest';
import {
  isMockProviderHost,
  isRealProvider,
  pickDevsChatProfile,
  filterRealProviderProfiles,
  type ProfileLite,
  type ProviderLite,
} from './helpers/real-providers.ts';

describe('isMockProviderHost', () => {
  it('flags example.com and subdomains', () => {
    expect(isMockProviderHost('https://example.com')).toBe(true);
    expect(isMockProviderHost('https://cs-test.example.com')).toBe(true);
    expect(isMockProviderHost('https://api.example.com/v1')).toBe(true);
  });

  it('flags localhost and reserved TLDs', () => {
    expect(isMockProviderHost('http://localhost:3000')).toBe(true);
    expect(isMockProviderHost('https://foo.test')).toBe(true);
    expect(isMockProviderHost('https://bar.invalid')).toBe(true);
  });

  it('allows real Devs.ai / Gemini hosts', () => {
    expect(isMockProviderHost('https://devs.ai')).toBe(false);
    expect(isMockProviderHost('https://api.devs.ai')).toBe(false);
    expect(isMockProviderHost('https://generativelanguage.googleapis.com')).toBe(false);
  });
});

describe('isRealProvider', () => {
  it('accepts protected names even without base_url', () => {
    expect(isRealProvider({ name: 'Devs.ai' })).toBe(true);
    expect(isRealProvider({ name: 'Devs.ai v2' })).toBe(true);
    expect(isRealProvider({ name: 'Google Gemini' })).toBe(true);
  });

  it('rejects mock hosts and unprotected nameless rows', () => {
    expect(isRealProvider({ name: 'CS Test Provider', base_url: 'https://cs-test.example.com' })).toBe(false);
    expect(isRealProvider({ name: 'Mystery', base_url: null })).toBe(false);
    expect(isRealProvider(null)).toBe(false);
  });

  it('accepts non-protected names with a real base_url', () => {
    expect(isRealProvider({ name: 'Custom Devs', base_url: 'https://devs.ai' })).toBe(true);
  });
});

describe('pickDevsChatProfile', () => {
  const mockProvider: ProviderLite = {
    id: 'prov-mock',
    name: 'CS Test Provider',
    type: 'devs-ai',
    base_url: 'https://cs-test.example.com',
  };
  const realProvider: ProviderLite = {
    id: 'prov-real',
    name: 'Devs.ai',
    type: 'devs-ai',
    base_url: 'https://devs.ai',
  };

  const mockProfile: ProfileLite = {
    id: 'prof-mock',
    mode: 'chat',
    external_ai_id: 'test-ai-cs',
    profile_type: 'agent',
    provider_id: mockProvider.id,
    provider: { id: mockProvider.id, name: mockProvider.name, type: 'devs-ai' },
  };
  const realAgent: ProfileLite = {
    id: 'prof-real-agent',
    mode: 'chat',
    external_ai_id: 'real-agent-uuid',
    profile_type: 'agent',
    provider_id: realProvider.id,
    provider: { id: realProvider.id, name: realProvider.name, type: 'devs-ai' },
  };
  const realModel: ProfileLite = {
    id: 'prof-real-model',
    mode: 'chat',
    external_ai_id: 'gpt-4o',
    profile_type: 'model',
    provider_id: realProvider.id,
    provider: { id: realProvider.id, name: realProvider.name, type: 'devs-ai' },
  };

  it('skips mock example.com profiles and prefers protected Devs.ai agent', () => {
    const picked = pickDevsChatProfile([mockProfile, realModel, realAgent], [mockProvider, realProvider]);
    expect(picked?.id).toBe('prof-real-agent');
  });

  it('returns null when only mock hosts are present', () => {
    expect(pickDevsChatProfile([mockProfile], [mockProvider])).toBeNull();
  });

  it('filterRealProviderProfiles drops mocks', () => {
    const kept = filterRealProviderProfiles([mockProfile, realAgent], [mockProvider, realProvider]);
    expect(kept.map((p) => p.id)).toEqual(['prof-real-agent']);
  });
});
