export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

interface RunLike {
  status: string;
}

interface IncidentLike {
  id: string;
}

function isPass(status: string): boolean {
  return status === 'pass' || status === 'warning';
}

export function computeHealthStatus(
  lastRun: RunLike | null,
  previousRun: RunLike | null,
  openIncident: IncidentLike | null,
): HealthStatus {
  if (!lastRun) return 'unknown';
  if (!isPass(lastRun.status) || openIncident) return 'down';
  if (lastRun.status === 'warning') return 'degraded';
  if (previousRun && !isPass(previousRun.status)) return 'degraded';
  return 'healthy';
}
