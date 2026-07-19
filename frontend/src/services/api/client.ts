import { getAccessToken, getWorkspaceId, getSessionUser, handleAccountGateApiError } from '../../lib/auth-session';
import { resolveApiUrl } from '../../lib/api-url';

function devUserHeader(headers: Record<string, string>): void {
  const devKey = import.meta.env.VITE_DEV_API_KEY;
  const token = getAccessToken();
  if (devKey && token === devKey) {
    const user = getSessionUser();
    if (user?.id) headers['X-Forwarded-User-Id'] = user.id;
  }
}

export function getApiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const ws = getWorkspaceId();
  if (ws) headers['X-Workspace-Id'] = ws;
  devUserHeader(headers);
  return headers;
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  skipWorkspaceHeader?: boolean;
  headers?: Record<string, string>;
}

export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const { skipWorkspaceHeader, ...fetchOpts } = options;
  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...fetchOpts.headers };
  const token = getAccessToken();
  if (token) baseHeaders.Authorization = `Bearer ${token}`;
  const ws = getWorkspaceId();
  if (ws && !skipWorkspaceHeader) baseHeaders['X-Workspace-Id'] = ws;
  devUserHeader(baseHeaders);

  const res = await fetch(resolveApiUrl(url), {
    ...fetchOpts,
    headers: baseHeaders,
  });

  if (res.status === 204) return null as unknown as T;

  if (!res.ok) {
    let data: { error?: string; code?: string; details?: { path: string; message: string }[] };
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    handleAccountGateApiError({ data });
    const message = data.details?.length
      ? `${data.error || 'Validation failed'}: ${data.details.map((d) => d.message).join('; ')}`
      : data.error || `Request failed (${res.status})`;
    throw Object.assign(new Error(message), {
      status: res.status,
      data,
      details: data.details,
    });
  }
  return res.json();
}

/**
 * Extract field-level validation details from an API error, if present.
 */
export function getValidationDetails(err: unknown): { path: string; message: string }[] | undefined {
  return (err as { details?: { path: string; message: string }[] })?.details;
}
