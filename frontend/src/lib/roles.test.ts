import { isAdminRole } from './roles';

describe('isAdminRole', () => {
  it('returns true for "owner"', () => {
    expect(isAdminRole('owner')).toBe(true);
  });

  it('returns true for "admin"', () => {
    expect(isAdminRole('admin')).toBe(true);
  });

  it('returns false for "member"', () => {
    expect(isAdminRole('member')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAdminRole(null)).toBe(false);
  });
});
