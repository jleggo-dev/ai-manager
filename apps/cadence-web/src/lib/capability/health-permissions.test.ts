import { grantedFromPermissionResponse } from './health-permissions.ts';

/**
 * The regression, captured from a real iPhone via Safari Web Inspector:
 *
 *   TypeError: (await requestHealthPermissions({...})).permissions.some is not a function
 *
 * The plugin's TypeScript declares `permissions` as an array; iOS does not send one. Reading it
 * directly threw before any workout was ever fetched, and every attempt since the feature shipped
 * surfaced as "I couldn't read Apple Health just now".
 */
describe('grantedFromPermissionResponse', () => {
  it('never throws on the shape iOS actually sends', () => {
    // Whatever it is, it is not an array — that is the entire bug.
    expect(() => grantedFromPermissionResponse({ permissions: undefined })).not.toThrow();
    expect(() => grantedFromPermissionResponse({})).not.toThrow();
    expect(() => grantedFromPermissionResponse(null)).not.toThrow();
    expect(() => grantedFromPermissionResponse(undefined)).not.toThrow();
    expect(() => grantedFromPermissionResponse('granted')).not.toThrow();
  });

  /**
   * Assume granted, not denied. iOS cannot report read state at all — the plugin's own docs say
   * the return "reflects the assumption that all permissions were granted" — so refusing to
   * proceed on an unfamiliar shape would deny someone a feature they had just approved.
   */
  it('assumes granted when the platform tells us nothing usable', () => {
    expect(grantedFromPermissionResponse({ permissions: undefined })).toBe(true);
    expect(grantedFromPermissionResponse({})).toBe(true);
    expect(grantedFromPermissionResponse(null)).toBe(true);
    expect(grantedFromPermissionResponse({ permissions: [] })).toBe(true);
  });

  it("reads Android's documented array shape", () => {
    expect(grantedFromPermissionResponse({ permissions: [{ READ_WORKOUTS: true }] })).toBe(true);
    expect(grantedFromPermissionResponse({ permissions: [{ READ_WORKOUTS: false }] })).toBe(false);
    expect(grantedFromPermissionResponse({ permissions: [{ READ_WORKOUTS: false }, { READ_DISTANCE: true }] })).toBe(
      true,
    );
  });

  it('reads a plain permission→boolean map', () => {
    expect(grantedFromPermissionResponse({ permissions: { READ_WORKOUTS: true } })).toBe(true);
    expect(grantedFromPermissionResponse({ permissions: { READ_WORKOUTS: false, READ_DISTANCE: false } })).toBe(false);
  });

  it('survives nulls inside the array', () => {
    expect(() => grantedFromPermissionResponse({ permissions: [null, undefined] })).not.toThrow();
    expect(grantedFromPermissionResponse({ permissions: [null, { READ_WORKOUTS: true }] })).toBe(true);
  });
});
