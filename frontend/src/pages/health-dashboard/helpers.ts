/**
 * Shared helpers/types for the Health Dashboard page views.
 */

import type { HcDashboardItem } from '../../types/api';

export type UnifiedDashboardItem = HcDashboardItem;
export type ViewMode = 'graph' | 'detail';
export type DetailMode = 'cards' | 'list';
export type SortField = 'name' | 'status' | 'lastRun' | 'latency' | 'cadence';
export type SortDir = 'asc' | 'desc';

export const SEMAPHORE_HEX: Record<string, string> = {
  green: '#40c057',
  yellow: '#fab005',
  red: '#fa5252',
  gray: '#adb5bd',
};

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function runStatusColor(status: string): string {
  switch (status) {
    case 'pass':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'fail':
      return 'red';
    case 'timeout':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

export function semaphoreOrder(s: string): number {
  switch (s) {
    case 'red':
      return 0;
    case 'yellow':
      return 1;
    case 'green':
      return 2;
    default:
      return 3;
  }
}
