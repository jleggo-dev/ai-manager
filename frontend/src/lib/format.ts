/**
 * Shared timestamp formatters for AI Admin UI.
 */

/** Full locale string (e.g. ManageLlmsModal last-refresh). */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/** Compact month/day + time with seconds (InvestigationPanel run/incident rows). */
export function formatTimestampShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
