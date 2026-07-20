import type { ChatMessage, DiagnosticLog } from '../../../types/api';

export interface StepExecution {
  stepKey: string;
  stepName: string;
  sortOrder: number;
  userMessage: ChatMessage | null;
  assistantMessage: ChatMessage | null;
  diagnostic: DiagnosticLog | null;
  variablesBefore: Record<string, unknown>;
  variablesAfter: Record<string, unknown>;
  addedVars: Record<string, unknown>;
}

export function statusColor(status: string): string {
  if (status === 'success') return 'green';
  if (status === 'error') return 'red';
  if (status === 'running') return 'blue';
  return 'gray';
}

export function formatMs(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
