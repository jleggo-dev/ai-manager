export const ACCOUNT_STATUSES = ['pending', 'approved', 'suspended'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: string): value is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

export const ACCOUNT_STATUS_CODES = {
  pending: 'ACCOUNT_PENDING',
  suspended: 'ACCOUNT_SUSPENDED',
} as const satisfies Record<Exclude<AccountStatus, 'approved'>, string>;
