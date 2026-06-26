import type { HealthStatus } from '../types/api';

export const HEALTH_STATUS_CONFIG: Record<HealthStatus, { color: string; hex: string; label: string }> = {
  healthy: { color: 'green', hex: '#40c057', label: 'Healthy' },
  degraded: { color: 'yellow', hex: '#fab005', label: 'Degraded' },
  down: { color: 'red', hex: '#fa5252', label: 'Down' },
  unknown: { color: 'gray', hex: '#adb5bd', label: 'Unknown' },
};
