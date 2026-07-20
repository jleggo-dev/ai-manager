/**
 * Unit tests for config-as-code content compare (INFRA-P2 dry-run).
 */
import { describe, it, expect } from 'vitest';
import {
  contentMatches,
  looksLikePlaceholder,
  stableStringify,
  JOB_COMPARE_FIELDS,
} from '../src/services/config-sync-compare.ts';

describe('config-sync-compare', () => {
  it('detects placeholder UUID tokens', () => {
    expect(looksLikePlaceholder('<CADENCE_BROKER_PROFILE_UUID>')).toBe(true);
    expect(looksLikePlaceholder('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(false);
  });

  it('stableStringify ignores key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('contentMatches skips placeholder fields and compares the rest', () => {
    const live = {
      name: 'capture_extract',
      description: 'Ambient capture',
      ai_profile_id: 'live-uuid',
      config: { promptTemplate: 'hello' },
    };
    const desired = {
      name: 'capture_extract',
      description: 'Ambient capture',
      ai_profile_id: '<CADENCE_BROKER_PROFILE_UUID>',
      config: { promptTemplate: 'hello' },
    };
    expect(contentMatches(live, desired, [...JOB_COMPARE_FIELDS])).toBe(true);
  });

  it('contentMatches reports promptTemplate drift', () => {
    const live = {
      name: 'capture_extract',
      config: { promptTemplate: 'live prompt' },
    };
    const desired = {
      name: 'capture_extract',
      config: { promptTemplate: 'repo prompt' },
    };
    expect(contentMatches(live, desired, [...JOB_COMPARE_FIELDS])).toBe(false);
  });
});
