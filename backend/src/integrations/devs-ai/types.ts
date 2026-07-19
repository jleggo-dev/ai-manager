/**
 * Shared types for the Devs.ai v1 HTTP client modules.
 */

import type { ChatCompletionChoice } from '../../types.ts';

export type DevsAiEntity = Record<string, unknown>;

export interface DevsAiRawCompletion {
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
}

export interface ChatFileRecord {
  id: string;
  source: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  status: string;
}

/** Minimal surface the per-API modules need from `DevsAiClient`. */
export interface DevsAiHttp {
  baseUrl: string;
  apiKey: string;
  _headers(extra?: Record<string, string>): Record<string, string>;
  _request<T = unknown>(method: string, path: string, body?: unknown, extra?: Record<string, unknown>): Promise<T>;
}
