import { describe, it, expect } from 'vitest';
import { resolveCallingApplication } from '../src/models/calling-applications.ts';
import type { RequestAuthContext } from '../src/types.ts';

describe('resolveCallingApplication', () => {
  const apiKeyCtxWithLink: RequestAuthContext = {
    mode: 'api_key',
    workspaceId: 'ws-1',
    apiKeyId: 'key-1',
    callingApplicationId: 'linked-app',
  };

  const apiKeyCtxNoLink: RequestAuthContext = {
    mode: 'api_key',
    workspaceId: 'ws-1',
    apiKeyId: 'key-2',
    callingApplicationId: null,
  };

  const jwtCtx: RequestAuthContext = {
    mode: 'jwt',
    workspaceId: 'ws-1',
    userId: 'user-1',
    userClient: {} as never,
  };

  /* ── Priority 1: API key with linked calling_application_id ── */

  it('returns key-linked app, ignoring body field', () => {
    expect(resolveCallingApplication(apiKeyCtxWithLink, 'body-app')).toBe('linked-app');
  });

  it('returns key-linked app when body field is empty', () => {
    expect(resolveCallingApplication(apiKeyCtxWithLink)).toBe('linked-app');
  });

  it('returns key-linked app when body field is whitespace', () => {
    expect(resolveCallingApplication(apiKeyCtxWithLink, '   ')).toBe('linked-app');
  });

  /* ── Priority 2: Body field (no key link) ── */

  it('falls back to body field when API key has no link', () => {
    expect(resolveCallingApplication(apiKeyCtxNoLink, 'lovable:my-app')).toBe('lovable:my-app');
  });

  it('trims whitespace from body field', () => {
    expect(resolveCallingApplication(apiKeyCtxNoLink, '  lovable:my-app  ')).toBe('lovable:my-app');
  });

  it('returns body field for JWT context', () => {
    expect(resolveCallingApplication(jwtCtx, 'admin-app')).toBe('admin-app');
  });

  it('returns body field when context is null', () => {
    expect(resolveCallingApplication(null, 'some-app')).toBe('some-app');
  });

  it('returns body field when context is undefined', () => {
    expect(resolveCallingApplication(undefined, 'some-app')).toBe('some-app');
  });

  /* ── Priority 3: Throw when neither source provides a value ── */

  it('throws when API key has no link and body is missing', () => {
    expect(() => resolveCallingApplication(apiKeyCtxNoLink)).toThrow(/callingApplication is required/);
  });

  it('throws when API key has no link and body is empty string', () => {
    expect(() => resolveCallingApplication(apiKeyCtxNoLink, '')).toThrow(/callingApplication is required/);
  });

  it('throws when API key has no link and body is whitespace', () => {
    expect(() => resolveCallingApplication(apiKeyCtxNoLink, '   ')).toThrow(/callingApplication is required/);
  });

  it('throws when context is null and body is missing', () => {
    expect(() => resolveCallingApplication(null)).toThrow(/callingApplication is required/);
  });

  it('throws when JWT context and body is missing', () => {
    expect(() => resolveCallingApplication(jwtCtx)).toThrow(/callingApplication is required/);
  });
});
