/**
 * @ai-admin/edge
 * Reference Supabase Edge Function — copy docs/integration/ai-admin-supabase-edge-function.ts
 * into your Supabase functions/ai-admin/index.ts and deploy.
 */
export const EDGE_FUNCTION_REFERENCE_PATH = '../../../docs/integration/ai-admin-supabase-edge-function.ts';

export const EDGE_FUNCTION_MODES = [
  'ask-ai-profile',
  'run-processing-job',
  'open-chat-session',
  'resume-chat-session',
  'send-chat-message-stream',
  'list-chat-files',
  'list-chat-sessions',
  'get-chat-session',
  'submit-tool-outputs',
  'store-user-credential',
  'check-tool-auth',
  'initiate-tool-oauth',
] as const;

export type EdgeFunctionMode = (typeof EDGE_FUNCTION_MODES)[number];

/** Normalize AI Admin base URL for Vercel (append /_/backend). */
export function normalizeAiAdminBaseUrl(rawBase: string): string {
  const raw = rawBase.replace(/\/+$/, '');
  if (raw.includes('/_/backend') || raw.includes('localhost')) return raw;
  return `${raw}/_/backend`;
}
