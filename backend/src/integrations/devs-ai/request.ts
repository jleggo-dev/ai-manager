/**
 * Shared HTTP helpers for Devs.ai v1 — JSON requests + SSE stream opens.
 */

import type { PatchedResponse } from '../../types.ts';

/** Build the standard auth headers. */
export function buildAuthHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

/** Generic JSON/text request wrapper with error handling and optional timeout. */
export async function jsonRequest<T = unknown>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body: unknown = null,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const options: RequestInit = {
    method,
    headers: buildAuthHeaders(apiKey, (extra.headers as Record<string, string>) || {}),
  };

  if (body && extra.rawBody !== true) {
    options.body = JSON.stringify(body);
  }
  if (body && extra.rawBody === true) {
    options.body = body as BodyInit;
    delete (options.headers as Record<string, string>)['Content-Type'];
  }

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = extra.timeoutMs as number | undefined;
  if (timeoutMs && timeoutMs > 0) {
    controller = new AbortController();
    options.signal = controller.signal;
    timer = setTimeout(() => controller?.abort(), timeoutMs);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(url, options);
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Devs.ai API request timed out after ${timeoutMs}ms`, {
        cause: err,
      });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Devs.ai API error (${response.status}): ${errorText}`);
  }

  if (response.status === 204) return null as T;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json() as Promise<T>;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

export interface OpenSseStreamOptions {
  timeoutMs?: number;
  /** Used in AbortError message, e.g. "streaming completion" / "chat message". */
  timeoutLabel: string;
  /** Used in non-OK response message, e.g. "streaming completion" / "chat message". */
  errorLabel: string;
}

/**
 * POST JSON and return the raw Response for SSE consumption.
 * Attaches abort timer/controller on the response for caller cleanup.
 */
export async function openSseStream(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: OpenSseStreamOptions,
): Promise<globalThis.Response> {
  const { timeoutMs, timeoutLabel, errorLabel } = options;

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    controller = new AbortController();
    timer = setTimeout(() => controller?.abort(), timeoutMs);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (err: unknown) {
    if (timer) clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Devs.ai ${timeoutLabel} timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  }

  if (!response.ok) {
    if (timer) clearTimeout(timer);
    const errorText = await response.text();
    throw new Error(`Devs.ai ${errorLabel} error (${response.status}): ${errorText}`);
  }

  (response as PatchedResponse)._abortTimer = timer;
  (response as PatchedResponse)._abortController = controller;
  return response;
}
