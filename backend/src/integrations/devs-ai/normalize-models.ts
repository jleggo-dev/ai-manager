/**
 * Normalize heterogeneous Devs.ai / OpenAI-compat model-list payloads into string IDs.
 */

export function extractModelId(row: unknown): string | undefined {
  if (typeof row === 'string') return row;
  if (typeof row === 'object' && row !== null) {
    const r = row as Record<string, unknown>;
    const id = r.id ?? r.model ?? r.name;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

export function normalizeModelListPayload(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  if (typeof payload !== 'object' || payload === null) return [];
  const obj = payload as Record<string, unknown>;

  const data = Array.isArray(obj.data) ? (obj.data as unknown[]) : [];
  if (data.length > 0) {
    return data.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  const models = Array.isArray(obj.models) ? (obj.models as unknown[]) : [];
  if (models.length > 0) {
    return models.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  return [];
}
